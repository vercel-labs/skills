import { existsSync } from 'fs';
import { join } from 'path';
import * as p from '@clack/prompts';
import pc from 'picocolors';
import {
  readLocalLock,
  addSkillsToLocalLock,
  computeSkillFolderHash,
  frozenLockfileError,
  lockChangeReason,
  type LocalSkillLockEntry,
  type LocalSkillLockFile,
} from './local-lock.ts';
import {
  fetchSources,
  installFromSource,
  installWellKnownToAgents,
  type FetchedSource,
} from './add.ts';
import {
  wellKnownProvider,
  computeWellKnownSkillDigest,
  type WellKnownSkill,
} from './providers/index.ts';
import { runSync, parseSyncOptions } from './sync.ts';
import { getUniversalAgents } from './agents.ts';
import { buildLocalCloneSource, formatSourceInput } from './update-source.ts';
import { getPositiveIntegerEnv } from './download-source.ts';
import { parseSource } from './source-parser.ts';
import { isCI } from './ci.ts';
import { getCanonicalPath } from './installer.ts';
import { filterSkills } from './skills.ts';
import { normalizeSkillPath, resolveSkillLocations } from './skill-relocation.ts';
import type { AgentType, Skill } from './types.ts';

const DEFAULT_INSTALL_CONCURRENCY = 4;

interface LockedSourceGroup {
  /** Source shown in messages. */
  label: string;
  /** Value accepted by parseSource, including the ref. */
  installSource: string;
  entries: Record<string, LocalSkillLockEntry>;
}

interface RestoreOutcome {
  /** Lock entries for skills that installed successfully. */
  lockUpdates: Record<string, LocalSkillLockEntry>;
  missing: string[];
  ambiguous: string[];
  failed: string[];
  relocated: Array<{ name: string; from: string; to: string }>;
  error?: string;
}

type SkillResolution = Pick<RestoreOutcome, 'missing' | 'ambiguous' | 'relocated'>;

/**
 * Select the locked skills a source should install.
 *
 * An exact locked path wins; a skill that moved is found by its unique name;
 * a skill that is gone is reported instead of failing the whole restore.
 */
function selectLockedSkills(
  skills: Skill[],
  repoPaths: Record<string, string>,
  entries: Record<string, LocalSkillLockEntry>
): { selected: Skill[]; resolution: SkillResolution } {
  const discovered = Object.entries(repoPaths).map(([name, skillPath]) => ({ name, skillPath }));
  // Skills install straight from the checkout, so an exact locked path always identifies one.
  const locations = resolveSkillLocations(Object.keys(entries), entries, discovered, {
    exactPathDisambiguates: true,
  });

  const pathToSkill = new Map<string, Skill>();
  for (const skill of skills) {
    const skillPath = repoPaths[skill.name];
    if (skillPath) pathToSkill.set(normalizeSkillPath(skillPath), skill);
  }

  const selected: Skill[] = [];
  const missing = [...locations.deletedSkills];
  const relocated: RestoreOutcome['relocated'] = [];
  for (const [name, skillPath] of locations.resolvedPaths) {
    const skill = pathToSkill.get(normalizeSkillPath(skillPath));
    if (!skill) {
      missing.push(name);
      continue;
    }
    selected.push(skill);
    const from = entries[name]?.skillPath;
    if (from && normalizeSkillPath(from) !== normalizeSkillPath(skillPath)) {
      relocated.push({ name, from, to: skillPath });
    }
  }

  // Entries recorded before skillPath tracking reinstall by name.
  for (const [name, entry] of Object.entries(entries)) {
    if (entry.skillPath) continue;
    const match = filterSkills(skills, [name])[0];
    if (match) selected.push(match);
    else missing.push(name);
  }

  return { selected, resolution: { missing, ambiguous: locations.ambiguousSkills, relocated } };
}

/**
 * Locked SKILL.md paths to read instead of walking the repository. That avoids
 * parsing (and warning about) unrelated skills that happen to be broken.
 * Only usable when every entry knows its path.
 */
function lockedSkillPaths(group: LockedSourceGroup): string[] | undefined {
  const lockedPaths = Object.values(group.entries).map((entry) => entry.skillPath);
  return lockedPaths.every((path): path is string => Boolean(path)) ? lockedPaths : undefined;
}

/** Restore one already-fetched repository's locked skills from its single checkout. */
async function restoreSourceGroup(
  group: LockedSourceGroup,
  fetched: FetchedSource,
  agents: AgentType[],
  frozenLock?: LocalSkillLockFile
): Promise<RestoreOutcome> {
  let resolution: SkillResolution = { missing: [], ambiguous: [], relocated: [] };
  const details = await installFromSource(fetched, {
    skills: [],
    agents,
    recordLock: false,
    ...(frozenLock && { frozenLock }),
    select: async (skills, repoPaths) => {
      const selection = selectLockedSkills(skills, repoPaths, group.entries);
      resolution = selection.resolution;
      return selection.selected;
    },
  });

  const lockUpdates: Record<string, LocalSkillLockEntry> = {};
  for (const { skill, repoPath, hash } of details.installedSkills) {
    const entry = group.entries[skill.name];
    if (!entry) continue;
    lockUpdates[skill.name] = {
      ...entry,
      ...(repoPath && { skillPath: repoPath }),
      computedHash: hash,
    };
  }

  return { ...resolution, lockUpdates, failed: details.failed, error: details.error };
}

/**
 * Restore one well-known source from its published index. A skill that left
 * the index is reported as missing instead of exiting the CLI.
 */
export async function restoreWellKnownGroup(
  url: string,
  entries: Record<string, LocalSkillLockEntry>,
  agents: AgentType[],
  cwd = process.cwd(),
  frozenLock?: LocalSkillLockFile
): Promise<RestoreOutcome> {
  const outcome: RestoreOutcome = {
    lockUpdates: {},
    missing: [],
    ambiguous: [],
    failed: [],
    relocated: [],
  };
  let available: WellKnownSkill[];
  try {
    available = await wellKnownProvider.fetchAllSkills(url, { includeInternal: true });
  } catch (error) {
    return { ...outcome, error: error instanceof Error ? error.message : String(error) };
  }

  const changes: string[] = [];
  for (const [name, entry] of Object.entries(entries)) {
    const candidates = available.filter(
      (skill) => skill.installName === name || skill.name === name
    );
    if (candidates.length === 0) {
      outcome.missing.push(name);
      continue;
    }
    if (candidates.length > 1) {
      outcome.ambiguous.push(name);
      continue;
    }
    const skill = candidates[0]!;
    const results = await installWellKnownToAgents(skill, agents, { cwd, mode: 'symlink' });
    for (const r of results) {
      if (!r.success) outcome.failed.push(`${r.skill} → ${r.agent}: ${r.error}`);
    }
    const canonicalDir = results.find((r) => r.success)?.canonicalPath;
    if (!canonicalDir) continue;
    const computedHash = await computeSkillFolderHash(canonicalDir);
    if (frozenLock) {
      // A well-known skill can only be hashed once it is installed.
      const reason = lockChangeReason(frozenLock, name, { computedHash });
      if (reason) changes.push(reason);
      continue;
    }
    outcome.lockUpdates[name] = {
      ...entry,
      computedHash,
      wellKnownDigest: computeWellKnownSkillDigest(skill),
    };
  }
  if (changes.length > 0) outcome.error = frozenLockfileError(changes);
  return outcome;
}

function reportOutcome(label: string, outcome: RestoreOutcome): void {
  if (outcome.error) {
    p.log.error(`Failed to install from ${pc.cyan(label)}: ${outcome.error}`);
  }
  for (const item of outcome.relocated) {
    p.log.info(`${pc.cyan(item.name)} moved to ${pc.dim(item.to)}`);
  }
  const restored = Object.keys(outcome.lockUpdates);
  if (restored.length > 0) {
    p.log.success(`Restored ${restored.map((name) => pc.cyan(name)).join(', ')}`);
  }
  for (const name of outcome.missing) {
    p.log.error(
      `Missing upstream: ${pc.cyan(name)} (${label}) — run ${pc.cyan(`skills remove ${name}`)} to drop it from skills-lock.json`
    );
  }
  for (const name of outcome.ambiguous) {
    p.log.error(
      `Cannot restore ${pc.cyan(name)} (${label}): more than one skill in the source has that name`
    );
  }
  for (const failure of outcome.failed) {
    p.log.error(failure);
  }
  if (
    outcome.error ||
    outcome.missing.length > 0 ||
    outcome.ambiguous.length > 0 ||
    outcome.failed.length > 0
  ) {
    process.exitCode = 1;
  }
}

/** Run `worker` over `items` with at most `limit` in flight. */
async function forEachConcurrent<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    for (let item = queue.shift(); item !== undefined; item = queue.shift()) {
      await worker(item);
    }
  });
  await Promise.all(workers);
}

/**
 * Install the skills from the local skills-lock.json that are not already in
 * .agents/skills/ (all of them with --force).
 * Groups skills by source and installs each group; a failing source does not
 * stop the others.
 *
 * Only installs to .agents/skills/ (universal agents) -- the canonical
 * project-level location. Does not install to agent-specific directories.
 *
 * node_modules skills are handled via sync.
 */
export async function runInstallFromLock(args: string[]): Promise<void> {
  const cwd = process.cwd();
  const { options: syncOptions } = parseSyncOptions(args);
  const frozen = syncOptions.frozenLockfile ?? isCI();
  const force = args.includes('--force');
  const lock = await readLocalLock(cwd);
  const skillEntries = Object.entries(lock.skills);

  if (skillEntries.length === 0) {
    if (frozen) {
      p.log.error(
        'Cannot install with --frozen-lockfile because skills-lock.json is absent or has no skills'
      );
      process.exitCode = 1;
      return;
    }
    p.log.warn('No project skills found in skills-lock.json');
    p.log.info(
      `Add project-level skills with ${pc.cyan('npx skills add <package>')} (without ${pc.cyan('-g')})`
    );
    return;
  }

  // Only install to .agents/skills/ (universal agents)
  const universalAgentNames = getUniversalAgents();

  // Separate node_modules and well-known sources from Git-backed sources.
  const nodeModuleSkills: string[] = [];
  const alreadyInstalled: string[] = [];
  const wellKnownGroups = new Map<string, Record<string, LocalSkillLockEntry>>();
  const sourceGroups = new Map<string, LockedSourceGroup>();

  for (const [skillName, entry] of skillEntries) {
    if (entry.sourceType === 'node_modules') {
      nodeModuleSkills.push(skillName);
      continue;
    }

    if (!force && existsSync(join(getCanonicalPath(skillName, { cwd }), 'SKILL.md'))) {
      alreadyInstalled.push(skillName);
      continue;
    }

    if (entry.sourceType === 'well-known') {
      const url = entry.sourceUrl || entry.source;
      const entries = wellKnownGroups.get(url) ?? {};
      entries[skillName] = entry;
      wellKnownGroups.set(url, entries);
      continue;
    }

    // Group by repository so every skill from one repo shares a clone and discovery pass.
    const cloneSource = buildLocalCloneSource(entry);
    if (!cloneSource) {
      p.log.error(
        `Cannot restore ${pc.cyan(skillName)}: skills-lock.json is missing sourceUrl for this generic Git source`
      );
      process.exitCode = 1;
      continue;
    }

    const key = `${cloneSource}\n${entry.ref ?? ''}\n${entry.sourceType}`;
    const existing = sourceGroups.get(key);
    if (existing) {
      existing.entries[skillName] = entry;
    } else {
      sourceGroups.set(key, {
        label: cloneSource,
        installSource: formatSourceInput(cloneSource, entry.ref),
        entries: { [skillName]: entry },
      });
    }
  }

  if (alreadyInstalled.length > 0) {
    p.log.info(
      `${pc.cyan(String(alreadyInstalled.length))} skill${alreadyInstalled.length !== 1 ? 's' : ''} already installed ${pc.dim('(use --force to reinstall)')}`
    );
  }

  const remoteCount = skillEntries.length - nodeModuleSkills.length - alreadyInstalled.length;
  if (remoteCount > 0) {
    p.log.info(
      `${syncOptions.dryRun ? 'Would restore' : 'Restoring'} ${pc.cyan(String(remoteCount))} skill${remoteCount !== 1 ? 's' : ''} from skills-lock.json into ${pc.dim('.agents/skills/')}`
    );
  }

  const groups = [...sourceGroups.values()];
  const wellKnownList = [...wellKnownGroups];
  if (syncOptions.dryRun) {
    // Nothing is fetched or installed; node_modules entries below are reported by sync's own dry run.
    for (const { label, entries } of [
      ...groups,
      ...wellKnownList.map(([url, entries]) => ({ label: url, entries })),
    ]) {
      p.log.message(
        `${Object.keys(entries)
          .map((name) => pc.cyan(name))
          .join(', ')} ${pc.dim(`from ${label}`)}`
      );
    }
  } else {
    // Download every repository at once, then restore the sources concurrently.
    const fetched = await fetchSources(
      groups.map((group) => ({
        parsed: parseSource(group.installSource),
        skills: [],
        includeInternal: true,
        skillPaths: lockedSkillPaths(group),
      }))
    );
    const frozenLock = frozen ? lock : undefined;
    const tasks = [
      ...groups.map((group, index) => ({
        label: group.label,
        count: Object.keys(group.entries).length,
        run: () => restoreSourceGroup(group, fetched[index]!, universalAgentNames, frozenLock),
      })),
      ...wellKnownList.map(([url, entries]) => ({
        label: url,
        count: Object.keys(entries).length,
        run: () => restoreWellKnownGroup(url, entries, universalAgentNames, cwd, frozenLock),
      })),
    ];
    for (const task of tasks) {
      p.log.info(
        `Restoring ${task.count} skill${task.count !== 1 ? 's' : ''} from ${pc.cyan(task.label)}`
      );
    }

    const pendingLockUpdates: Record<string, LocalSkillLockEntry> = {};
    const concurrency = getPositiveIntegerEnv(
      'SKILLS_INSTALL_CONCURRENCY',
      DEFAULT_INSTALL_CONCURRENCY
    );
    await forEachConcurrent(tasks, concurrency, async (task) => {
      let outcome: RestoreOutcome;
      try {
        outcome = await task.run();
      } catch (error) {
        outcome = {
          lockUpdates: {},
          missing: [],
          ambiguous: [],
          failed: [],
          relocated: [],
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
      Object.assign(pendingLockUpdates, outcome.lockUpdates);
      reportOutcome(task.label, outcome);
    });

    // One lock write for the whole restore; a frozen lock is never touched.
    if (!frozen && Object.keys(pendingLockUpdates).length > 0) {
      await addSkillsToLocalLock(pendingLockUpdates, cwd);
    }
  }

  // Handle node_modules skills via sync
  if (nodeModuleSkills.length > 0) {
    p.log.info(
      `${pc.cyan(String(nodeModuleSkills.length))} skill${nodeModuleSkills.length !== 1 ? 's' : ''} from node_modules`
    );
    try {
      await runSync(args, {
        ...syncOptions,
        frozenLockfile: frozen,
        yes: true,
        agent: universalAgentNames,
      });
    } catch (error) {
      p.log.error(
        `Failed to sync node_modules skills: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }
}
