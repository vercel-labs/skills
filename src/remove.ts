import * as p from '@clack/prompts';
import { pc } from './color.ts';
import { realpathSync } from 'fs';
import { readdir, rm, lstat } from 'fs/promises';
import { join, relative, sep } from 'path';
import { agents, detectInstalledAgents, getEveSubagents } from './agents.ts';
import { diagnostics, formatError } from './diagnostics.ts';
import { parseCliArgs, throwFirstError } from './cli-args.ts';
import { track } from './telemetry.ts';
import { warn } from './warnings.ts';
import { detectAgent } from './detect-agent.ts';
import { removeSkillFromLock, getSkillFromLock, readSkillLock } from './skill-lock.ts';
import {
  computeSkillFolderHash,
  readLocalLock,
  removeSkillFromLocalLock,
  type LocalSkillLockEntry,
} from './local-lock.ts';
import { hasSkillMd } from './skills.ts';
import type { AgentType } from './types.ts';
import {
  getInstallPath,
  getCanonicalPath,
  getCanonicalSkillsDir,
  getEveSubagentSkillsDir,
  isDirEntryOrSymlinkToDir,
  pathsOverlap,
  sanitizeName,
} from './installer.ts';

export interface RemoveOptions {
  global?: boolean;
  agent?: string[];
  yes?: boolean;
  all?: boolean;
}

/**
 * Resolve requested skill names to canonical removal targets.
 *
 * On-disk folder names are the result of sanitizeName() at install time, but
 * lock-file keys keep the original name, which may contain characters
 * sanitizeName() rewrites — e.g. the ':' in plugin skills such as "ce:review"
 * maps to the folder "ce-review". Matching purely on folder names therefore
 * misses lock-only or name-mismatched skills (and stale lock entries whose
 * folder is already gone). Every candidate is canonicalized by its sanitized
 * name, preferring the lock key, so downstream disk cleanup (which
 * re-sanitizes) and lock removal (which needs the exact key) both target the
 * right thing.
 */
export function resolveSkillsToRemove(
  requested: string[],
  folderNames: string[],
  lockKeys: string[] = [],
  sourceByKey: Record<string, string | undefined> = {}
): string[] {
  const identityBySanitized = new Map<string, string>();
  for (const folder of folderNames) {
    identityBySanitized.set(sanitizeName(folder), folder);
  }
  // Lock keys win: they carry the exact key needed for lock removal.
  for (const key of lockKeys) {
    identityBySanitized.set(sanitizeName(key), key);
  }

  const matched = new Set<string>();
  for (const name of requested) {
    const hit = identityBySanitized.get(sanitizeName(name));
    if (hit) {
      matched.add(hit);
      continue;
    }
    // Not a skill name: treat it as an exact lock source and take every skill from it.
    for (const key of lockKeys) {
      if (sourceByKey[key] === name) matched.add(key);
    }
  }
  return Array.from(matched);
}

/**
 * Installed skill folders no lock key maps to. `remove --all` only removes what
 * the lock tracks; these are user-authored and are reported as skipped (#604).
 */
export function findUntrackedSkills(folderNames: string[], lockKeys: string[]): string[] {
  const tracked = new Set(lockKeys.map(sanitizeName));
  return folderNames.filter((folder) => !tracked.has(sanitizeName(folder)));
}

function isSameDir(a: string, b: string): boolean {
  try {
    return realpathSync(a) === realpathSync(b);
  } catch {
    return false;
  }
}

export async function removeCommand(skillNames: string[], options: RemoveOptions) {
  // Auto-enable non-interactive mode when running inside an AI agent
  const agentResult = await detectAgent();
  if (agentResult.isAgent) {
    options.yes = true;
    p.log.info(
      pc.bgCyan(pc.black(pc.bold(` ${agentResult.agent.name} `))) +
        ' ' +
        'Agent detected — removing non-interactively'
    );
  }

  // `--skill '*'` is the documented synonym for selecting every skill.
  if (skillNames.includes('*')) {
    options.all = true;
    skillNames = skillNames.filter((name) => name !== '*');
  }

  // Footgun: `remove --skill foo --all` used to ignore `foo` and wipe everything,
  // because `--all` replaced the requested list with every installed skill.
  // Refuse the combination so agents/scripts cannot accidentally mass-delete.
  const namedSkills = skillNames.filter((name) => name !== '*');
  if (options.all && namedSkills.length > 0) {
    p.log.error(
      formatError(diagnostics.SKILLS_REMOVE_ALL_WITH_NAMES({ example: namedSkills[0]! }))
    );
    process.exit(1);
  }

  const isGlobal = options.global ?? false;
  const cwd = process.cwd();

  const spinner = p.spinner();

  spinner.start('Scanning for installed skills…');
  const installedSkills = await scanInstalledSkillNames(isGlobal, cwd, (message) =>
    p.log.warn(message)
  );
  spinner.stop(`Found ${installedSkills.length} unique installed skill(s)`);

  // Read lock file keys up front. These are needed both to decide whether there is
  // anything to remove (a skill may be missing from disk but still leave a stale lock
  // entry) and to clean up those stale entries below.
  const lockEntries = isGlobal ? (await readSkillLock()).skills : (await readLocalLock(cwd)).skills;
  const lockSkillsKeys = Object.keys(lockEntries);
  const sourceByKey = Object.fromEntries(
    lockSkillsKeys.map((key) => [key, lockEntries[key]?.source])
  );

  // `--all` only removes skills this tool manages (tracked in the lock); skills
  // dirs may also hold user-authored skills, which must survive (#604).
  const requestedSkills = options.all ? lockSkillsKeys : skillNames;
  const resolvedRequestedSkills =
    options.all || skillNames.length > 0
      ? resolveSkillsToRemove(requestedSkills, installedSkills, lockSkillsKeys, sourceByKey)
      : [];

  if (installedSkills.length === 0 && resolvedRequestedSkills.length === 0) {
    p.outro(pc.yellow('No skills found to remove.'));
    return;
  }

  // Validate agent options BEFORE prompting for skill selection
  if (options.agent && options.agent.length > 0) {
    const validAgents = Object.keys(agents);
    const invalidAgents = options.agent.filter((a) => !validAgents.includes(a));

    if (invalidAgents.length > 0) {
      p.log.error(
        formatError(
          diagnostics.SKILLS_INVALID_AGENTS({ invalid: invalidAgents, valid: validAgents })
        )
      );
      process.exit(1);
    }
  }

  let selectedSkills: string[] = [];

  if (options.all) {
    selectedSkills = resolvedRequestedSkills;
    const untracked = findUntrackedSkills(installedSkills, lockSkillsKeys);
    if (untracked.length > 0) {
      p.log.warn(formatError(diagnostics.SKILLS_REMOVE_UNTRACKED_SKIPPED({ skills: untracked })));
    }
  } else if (skillNames.length > 0) {
    selectedSkills = resolvedRequestedSkills;

    if (selectedSkills.length === 0) {
      p.log.error(
        formatError(
          diagnostics.SKILLS_NO_MATCHING_SKILLS({
            requested: skillNames,
            available: [],
          })
        )
      );
      return;
    }
  } else {
    const choices = installedSkills.map((s) => ({
      value: s,
      label: s,
    }));

    const selected = await p.multiselect({
      message: `Select skills to remove ${pc.dim('(space to toggle)')}`,
      options: choices,
      required: true,
    });

    if (p.isCancel(selected)) {
      p.cancel('Removal cancelled');
      process.exit(0);
    }

    selectedSkills = resolveSkillsToRemove(selected as string[], installedSkills, lockSkillsKeys);
  }

  // When the project skills dir is the global one (cwd is home), a project-scoped
  // remove would delete a globally tracked skill and leave its global lock entry (#2469).
  if (!isGlobal) {
    const globallyTracked = await findGloballyTrackedSkills(selectedSkills, cwd);
    if (globallyTracked.length > 0) {
      p.log.error(
        formatError(diagnostics.SKILLS_REMOVE_GLOBALLY_TRACKED({ skills: globallyTracked }))
      );
      process.exit(1);
    }
  }

  if (selectedSkills.length === 0) {
    if (options.all) {
      p.outro(
        pc.yellow(`No ${isGlobal ? 'globally managed' : 'lock-tracked'} skills found to remove.`)
      );
    } else {
      p.outro(pc.yellow('No skills found to remove.'));
    }
    return;
  }

  let targetAgents: AgentType[];
  if (options.agent && options.agent.length > 0) {
    targetAgents = options.agent as AgentType[];
  } else {
    // When removing, we should target all known agents to ensure
    // ghost symlinks are cleaned up, even if the agent is not detected.
    targetAgents = Object.keys(agents) as AgentType[];
    spinner.stop(`Targeting ${targetAgents.length} potential agent(s)`);
  }

  if (!options.yes) {
    console.log();
    p.log.info('Skills to remove:');
    for (const skill of selectedSkills) {
      p.log.message(`  ${pc.red('•')} ${skill}`);
    }
    console.log();

    const confirmed = await p.confirm({
      message: `Are you sure you want to uninstall ${selectedSkills.length} skill(s)?`,
    });

    if (p.isCancel(confirmed) || !confirmed) {
      p.cancel('Removal cancelled');
      process.exit(0);
    }
  }

  spinner.start('Removing skills…');

  const results = await removeInstalledSkills(selectedSkills, {
    global: isGlobal,
    cwd,
    targetAgents,
    onWarn: (message) => p.log.warn(message),
  });

  spinner.stop('Removal process complete');

  const successful = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);

  trackRemovals(results, targetAgents, isGlobal);

  if (successful.length > 0) {
    p.log.success(pc.green(`Successfully removed ${successful.length} skill(s)`));
  }

  if (failed.length > 0) {
    p.log.error(pc.red(`Failed to remove ${failed.length} skill(s)`));
    for (const r of failed) {
      p.log.message(`  ${pc.red('✗')} ${r.skill}: ${r.error}`);
    }
  }

  console.log();
  p.outro(pc.green('Done!'));
}

/** Names of skill folders (holding a SKILL.md) installed in `cwd` or globally. */
export async function scanInstalledSkillNames(
  isGlobal: boolean,
  cwd: string,
  onWarn?: (message: string) => void
): Promise<string[]> {
  const skillNamesSet = new Set<string>();

  const scanDir = async (dir: string) => {
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        // Dot-directories belong to the agent, not to us: sanitizeName() strips
        // leading dots, so a skill can never be installed under such a name and
        // removal could never address one either. Offering Codex's bundled
        // `$CODEX_HOME/skills/.system` was always a dead entry.
        if (entry.name.startsWith('.')) continue;

        // A skill dir may be a symlink to a real directory, e.g. a skill linked
        // into .agents/skills by hand. listInstalledSkills() follows those, so
        // removal must scan them the same way or the two commands disagree.
        if (!(await isDirEntryOrSymlinkToDir(entry, join(dir, entry.name)))) continue;

        // A directory is only a skill if it holds a SKILL.md, which is what
        // listInstalledSkills() already requires. Without this, any directory
        // in a scanned path counted as installed — including the contents of a
        // source repo's `skills/` folder, which is also OpenClaw's project
        // install dir and so is always scanned.
        if (!(await hasSkillMd(join(dir, entry.name)))) continue;

        skillNamesSet.add(entry.name);
      }
    } catch (err) {
      if (err instanceof Error && (err as { code?: string }).code !== 'ENOENT') {
        onWarn?.(`Could not scan directory ${dir}: ${err.message}`);
      }
    }
  };

  if (isGlobal) {
    await scanDir(getCanonicalSkillsDir(true, cwd));
    for (const agent of Object.values(agents)) {
      if (agent.globalSkillsDir !== undefined) {
        await scanDir(agent.globalSkillsDir);
      }
    }
  } else {
    await scanDir(getCanonicalSkillsDir(false, cwd));
    for (const agent of Object.values(agents)) {
      await scanDir(join(cwd, agent.skillsDir));
    }
    // Eve subagents keep their skills under agent/subagents/<name>/skills.
    for (const subagent of getEveSubagents(cwd)) {
      await scanDir(getEveSubagentSkillsDir(subagent, cwd));
    }
  }

  return Array.from(skillNamesSet).sort();
}

/**
 * Skills in `selected` a project-scoped remove must refuse: when the project
 * skills dir is the global one (cwd is home), removing would delete a globally
 * tracked skill and leave its global lock entry (#2469).
 */
export async function findGloballyTrackedSkills(
  selected: string[],
  cwd: string
): Promise<string[]> {
  if (!isSameDir(getCanonicalSkillsDir(false, cwd), getCanonicalSkillsDir(true))) return [];
  const lockEntries = (await readLocalLock(cwd)).skills;
  const globalNames = new Set(Object.keys((await readSkillLock()).skills).map(sanitizeName));
  return selected.filter((s) => !lockEntries[s] && globalNames.has(sanitizeName(s)));
}

/**
 * Whether the real (non-symlink) directory `path` must survive a project-scoped
 * remove. Agent dirs outside a dot-directory (OpenClaw's `skills`, `data/skills`,
 * `agent/skills`) are also ordinary repo folders, often holding the very sources
 * a skill was installed from, so a matching name proves nothing (#1771). Only an
 * unmodified copy of a lock-tracked skill, from outside its own source, goes.
 */
async function isUnmanagedProjectDir(
  path: string,
  cwd: string,
  entry: LocalSkillLockEntry | undefined
): Promise<boolean> {
  const firstSegment = relative(cwd, path).split(sep)[0] ?? '';
  if (firstSegment.startsWith('.')) return false;
  if (!entry) return true;
  if (entry.sourceType === 'local' && pathsOverlap(entry.source, path)) return true;
  const hash = await computeSkillFolderHash(path).catch(() => undefined);
  return hash !== entry.computedHash;
}

export interface RemoveSkillResult {
  skill: string;
  success: boolean;
  source?: string;
  sourceType?: string;
  /** Name of the skill in its source, when it was installed with `--rename`. */
  skillName?: string;
  error?: string;
}

/**
 * Remove `skills` from `targetAgents` without prompting or exiting. The
 * canonical copy and lock entry go only when no other installed agent uses them.
 */
export async function removeInstalledSkills(
  skills: string[],
  options: {
    global: boolean;
    cwd: string;
    targetAgents: AgentType[];
    /** Update the lock file; defaults to true. */
    lockfile?: boolean;
    onWarn?: (message: string) => void;
  }
): Promise<RemoveSkillResult[]> {
  const { global: isGlobal, cwd, targetAgents } = options;
  const results: RemoveSkillResult[] = [];
  const projectLock = isGlobal ? undefined : (await readLocalLock(cwd)).skills;

  for (const skillName of skills) {
    try {
      const canonicalPath = getCanonicalPath(skillName, { global: isGlobal, cwd });

      for (const agentKey of targetAgents) {
        const agent = agents[agentKey];
        const skillPath = getInstallPath(skillName, agentKey, { global: isGlobal, cwd });

        // Determine potential paths to cleanup. For universal agents, getInstallPath
        // now returns the canonical path, so we also need to check their 'native'
        // directory to clean up any legacy symlinks.
        const pathsToCleanup = new Set([skillPath]);
        const sanitizedName = sanitizeName(skillName);
        if (isGlobal && agent.globalSkillsDir) {
          pathsToCleanup.add(join(agent.globalSkillsDir, sanitizedName));
        } else {
          pathsToCleanup.add(join(cwd, agent.skillsDir, sanitizedName));
          // Eve skills may also live in subagent directories.
          if (agentKey === 'eve') {
            for (const subagent of getEveSubagents(cwd)) {
              pathsToCleanup.add(join(getEveSubagentSkillsDir(subagent, cwd), sanitizedName));
            }
          }
        }

        for (const pathToCleanup of pathsToCleanup) {
          // Skip if this is the canonical path - we'll handle that after checking all agents
          if (pathToCleanup === canonicalPath) {
            continue;
          }

          try {
            const stats = await lstat(pathToCleanup).catch(() => null);
            if (!stats) continue;
            if (
              projectLock &&
              !stats.isSymbolicLink() &&
              (await isUnmanagedProjectDir(pathToCleanup, cwd, projectLock[skillName]))
            ) {
              warn(diagnostics.SKILLS_REMOVE_UNMANAGED_DIR_KEPT({ path: pathToCleanup }));
              continue;
            }
            await rm(pathToCleanup, { recursive: true, force: true });
          } catch (err) {
            options.onWarn?.(
              `Could not remove skill from ${agent.displayName}: ${
                err instanceof Error ? err.message : String(err)
              }`
            );
          }
        }
      }

      // Only remove the canonical path if no other installed agents are using it.
      // This prevents breaking other agents when uninstalling from a specific agent (#287).
      const installedAgents = await detectInstalledAgents(cwd);
      const remainingAgents = installedAgents.filter((a) => !targetAgents.includes(a));

      let isStillUsed = false;
      for (const agentKey of remainingAgents) {
        const path = getInstallPath(skillName, agentKey, { global: isGlobal, cwd });
        const exists = await lstat(path).catch(() => null);
        if (exists) {
          isStillUsed = true;
          break;
        }
      }

      if (!isStillUsed) {
        await rm(canonicalPath, { recursive: true, force: true });
      }

      let effectiveSource = 'local';
      let effectiveSourceType = 'local';
      let sourceSkillName: string | undefined;
      const updateLock = options.lockfile !== false && !isStillUsed;

      // The lock entry tracks the canonical path, so it survives for as long as
      // that path does. Dropping it while another installed agent still links
      // the skill leaves the skill in place but no longer updatable (#1718).
      if (isGlobal) {
        const lockEntry = await getSkillFromLock(skillName);
        effectiveSource = lockEntry?.source || 'local';
        effectiveSourceType = lockEntry?.sourceType || 'local';
        sourceSkillName = lockEntry?.skillName;
        if (updateLock) {
          await removeSkillFromLock(skillName);
        }
      } else {
        const localLock = await readLocalLock(cwd);
        const lockEntry = localLock.skills[skillName];
        effectiveSource = lockEntry?.source || 'local';
        effectiveSourceType = lockEntry?.sourceType || 'local';
        sourceSkillName = lockEntry?.skillName;
        if (updateLock) {
          await removeSkillFromLocalLock(skillName, cwd);
        }
      }

      results.push({
        skill: skillName,
        success: true,
        source: effectiveSource,
        sourceType: effectiveSourceType,
        ...(sourceSkillName && { skillName: sourceSkillName }),
      });
    } catch (err) {
      results.push({
        skill: skillName,
        success: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return results;
}

/** Send one remove telemetry event per source of the successful removals. */
export function trackRemovals(
  results: RemoveSkillResult[],
  targetAgents: AgentType[],
  isGlobal: boolean
): void {
  const successful = results.filter((r) => r.success);
  if (successful.length === 0) return;
  const bySource = new Map<string, { skills: string[]; sourceType?: string }>();

  for (const r of successful) {
    // A local lock entry's source is an absolute path on the user's machine, and a download's
    // is a URL that may be private; telemetry only ever receives the generic source type.
    const source =
      r.sourceType === 'local' || r.sourceType === 'download' ? r.sourceType : r.source || 'local';
    const existing = bySource.get(source) || { skills: [] };
    // A --rename alias is a local name; telemetry only receives the source's name.
    existing.skills.push(r.skillName ?? r.skill);
    existing.sourceType = r.sourceType;
    bySource.set(source, existing);
  }

  for (const [source, data] of bySource) {
    track({
      event: 'remove',
      source,
      skills: data.skills.join(','),
      agents: targetAgents.join(','),
      ...(isGlobal && { global: '1' }),
      sourceType: data.sourceType,
    });
  }
}

/**
 * Parse command line options for the remove command.
 * Separates skill names from options flags.
 *
 * Supports both positional names (`skills remove foo`) and `-s/--skill`
 * (documented in the CLI help). Unknown options are ignored.
 */
export function parseRemoveOptions(args: string[]): { skills: string[]; options: RemoveOptions } {
  const { values, positionals, errors } = parseCliArgs(args, {
    global: { type: 'boolean', short: 'g' },
    yes: { type: 'boolean', short: 'y' },
    all: { type: 'boolean' },
    skill: { type: 'list', short: 's', value: 'a skill name' },
    agent: { type: 'list', short: 'a', value: 'an agent name' },
  });
  throwFirstError(errors);
  const options: RemoveOptions = {};
  if (values.global) options.global = true;
  if (values.yes || values.all) options.yes = true;
  if (values.all) options.all = true;
  if (values.agent) options.agent = values.agent;
  return { skills: [...(values.skill ?? []), ...positionals], options };
}
