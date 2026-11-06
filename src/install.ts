import { existsSync } from 'fs';
import * as p from '@clack/prompts';
import pc from 'picocolors';
import { getLockedSkillState, readLocalLock } from './local-lock.ts';
import { fetchSources, installFromSource } from './add.ts';
import { runSync, parseSyncOptions } from './sync.ts';
import { agents, detectInstalledAgents, getUniversalAgents, isUniversalAgent } from './agents.ts';
import { diagnostics, formatError } from './diagnostics.ts';
import { buildLocalUpdateSource } from './update-source.ts';
import { parseSource } from './source-parser.ts';
import { isCI } from './ci.ts';
import { getCanonicalPath, getInstallPath, installSkillForAgent } from './installer.ts';
import { getLastSelectedAgents } from './skill-lock.ts';
import type { AgentType } from './types.ts';

/**
 * The agents a restore installs to, without prompting: `--agent` when given,
 * else the last selection saved by `skills add`, else the agents detected on
 * this machine. Universal agents are always included, so with nothing else the
 * restore only fills `.agents/skills/`.
 */
export async function resolveRestoreAgents(
  requested: string[] | undefined,
  cwd: string
): Promise<AgentType[]> {
  const valid = Object.keys(agents) as AgentType[];
  if (requested?.includes('*')) return valid;
  let chosen: AgentType[];
  if (requested && requested.length > 0) {
    const invalid = requested.filter((a) => !valid.includes(a as AgentType));
    if (invalid.length > 0) throw diagnostics.SKILLS_INVALID_AGENTS({ invalid, valid });
    chosen = requested as AgentType[];
  } else {
    const last = (await getLastSelectedAgents().catch(() => undefined))?.filter((a) =>
      valid.includes(a as AgentType)
    ) as AgentType[] | undefined;
    chosen = last && last.length > 0 ? last : await detectInstalledAgents(cwd);
  }
  return [...new Set([...chosen, ...getUniversalAgents()])];
}

/**
 * Install the skills from the local skills-lock.json that are not already in
 * .agents/skills/ (all of them with --force) into the agents picked by
 * `resolveRestoreAgents`, honouring each entry's recorded `installMode`.
 * Skills already installed only get the agent links they are missing.
 * Groups skills by source and installs each group. A source that cannot be
 * fetched, or no longer has a locked skill, fails only its own entries: the
 * rest are restored, failed entries keep their lock entries unchanged, and the
 * command ends with a summary and exit code 1.
 *
 * node_modules skills are handled via sync.
 */
export async function runInstallFromLock(args: string[]): Promise<void> {
  const cwd = process.cwd();
  const { options: syncOptions } = parseSyncOptions(args);
  const frozen = syncOptions.frozenLockfile ?? isCI();
  const force = args.includes('--force');
  // A v1 lock is rewritten as v2 unless this run must not write the lock
  const lock = await readLocalLock(cwd, { persistMigration: !frozen && !syncOptions.dryRun });
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

  let targetAgents: AgentType[];
  try {
    targetAgents = await resolveRestoreAgents(syncOptions.agent, cwd);
  } catch (error) {
    p.log.error(formatError(error));
    process.exitCode = 1;
    return;
  }
  const linkedAgents = targetAgents.filter((agent) => !isUniversalAgent(agent));

  // Separate node_modules skills from remote skills
  const nodeModuleSkills: string[] = [];
  const alreadyInstalled: string[] = [];
  // Installed, but the files no longer match the lock; restored over
  const modifiedSkills: string[] = [];
  // Lock entries that could not be restored; their lock entries are left untouched
  const failedSkills: string[] = [];
  // Keyed by source, install mode, and download, so copied skills stay copies
  const bySource = new Map<
    string,
    { source: string; copy: boolean; download: boolean; skills: string[] }
  >();

  for (const [skillName, entry] of skillEntries) {
    if (entry.sourceType === 'node_modules') {
      nodeModuleSkills.push(skillName);
      continue;
    }

    if (!force) {
      const state = await getLockedSkillState(skillName, entry, cwd);
      if (state === 'tracked') {
        alreadyInstalled.push(skillName);
        continue;
      }
      if (state === 'modified') modifiedSkills.push(skillName);
    }

    // A download is fetched again from its URL as-is; it has no folder or ref to append.
    const installSource =
      entry.sourceType === 'download' ? (entry.sourceUrl ?? null) : buildLocalUpdateSource(entry);
    if (!installSource) {
      p.log.error(
        formatError(diagnostics.SKILLS_LOCK_MISSING_SOURCE_URL({ skill: pc.cyan(skillName) }))
      );
      failedSkills.push(skillName);
      continue;
    }
    const copy = entry.installMode === 'copy';
    const download = entry.sourceType === 'download';
    const key = `${copy ? 'copy' : 'symlink'}:${download ? 'download' : 'source'}:${installSource}`;
    const group = bySource.get(key) ?? { source: installSource, copy, download, skills: [] };
    group.skills.push(skillName);
    bySource.set(key, group);
  }

  if (alreadyInstalled.length > 0) {
    p.log.info(
      `${pc.cyan(String(alreadyInstalled.length))} skill${alreadyInstalled.length !== 1 ? 's' : ''} already installed ${pc.dim('(use --force to reinstall)')}`
    );
  }

  if (modifiedSkills.length > 0) {
    p.log.warn(
      `${modifiedSkills.map((name) => pc.cyan(name)).join(', ')} ${modifiedSkills.length === 1 ? 'does' : 'do'} not match skills-lock.json; ${syncOptions.dryRun ? 'would restore' : 'restoring'} the locked version`
    );
  }

  const remoteCount = skillEntries.length - nodeModuleSkills.length - alreadyInstalled.length;
  if (remoteCount > 0) {
    p.log.info(
      `${syncOptions.dryRun ? 'Would restore' : 'Restoring'} ${pc.cyan(String(remoteCount))} skill${remoteCount !== 1 ? 's' : ''} from skills-lock.json into ${pc.dim('.agents/skills/')}`
    );
  }
  if (linkedAgents.length > 0 && (remoteCount > 0 || alreadyInstalled.length > 0)) {
    p.log.info(
      `${syncOptions.dryRun ? 'Would link' : 'Linking'} to ${linkedAgents.map((a) => agents[a].displayName).join(', ')}`
    );
  }
  if (syncOptions.dryRun) {
    for (const { source, copy, skills } of bySource.values()) {
      p.log.message(
        `${skills.map((name) => pc.cyan(name)).join(', ')} ${pc.dim(`from ${source}${copy ? ' (copy)' : ''}`)}`
      );
    }
    // Nothing is fetched or installed; node_modules entries below are reported by sync's own dry run.
    bySource.clear();
  } else {
    await linkInstalledSkills(alreadyInstalled, lock, linkedAgents, cwd);
  }

  // Download every source at once, then install them in order
  const requests = [...bySource.values()].map(({ source, copy, download, skills }) => ({
    source,
    copy,
    parsed: download ? { type: 'download' as const, url: source } : parseSource(source),
    skills,
    // A pack or archive can hold its skills at any depth.
    ...(download && { fullDepth: true }),
  }));
  const fetched = await fetchSources(requests);
  let restoredCount = 0;
  for (const [index, { source, copy, skills }] of requests.entries()) {
    const result = await installFromSource(fetched[index]!, {
      skills,
      agents: targetAgents,
      ...(copy && { installMode: 'copy' as const }),
      ...(frozen && { frozenLock: lock }),
    });
    if (result.error) {
      p.log.error(
        `Failed to restore ${skills.map((name) => pc.cyan(name)).join(', ')} from ${pc.cyan(source)}: ${result.error}`
      );
      failedSkills.push(...skills);
      continue;
    }
    restoredCount += result.installed.length;
    p.log.success(`Restored ${result.installed.map((name) => pc.cyan(name)).join(', ')}`);
    // A skill renamed or removed upstream is missing from the source
    const installedNames = new Set(result.installed.map((name) => name.toLowerCase()));
    const notFound = skills.filter((name) => !installedNames.has(name.toLowerCase()));
    if (notFound.length > 0) {
      p.log.error(
        `${notFound.map((name) => pc.cyan(name)).join(', ')} not found in ${pc.cyan(source)}`
      );
      failedSkills.push(...notFound);
    }
    for (const failure of result.failed) p.log.error(failure);
    if (result.failed.length > 0) process.exitCode = 1;
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
        agent: targetAgents,
      });
    } catch (error) {
      p.log.error(
        `Failed to sync node_modules skills: ${error instanceof Error ? formatError(error) : 'Unknown error'}`
      );
      failedSkills.push(...nodeModuleSkills);
    }
  }

  if (failedSkills.length > 0) {
    const restored =
      restoredCount > 0
        ? `Restored ${restoredCount} skill${restoredCount !== 1 ? 's' : ''}; failed`
        : 'Failed';
    p.log.error(
      `${restored} to restore ${failedSkills.length} skill${failedSkills.length !== 1 ? 's' : ''} from skills-lock.json: ${failedSkills.map((name) => pc.cyan(name)).join(', ')}`
    );
    process.exitCode = 1;
  }
}

/**
 * Give already installed skills the agent links they lack: a symlink to the
 * canonical copy, or a copy when the entry was installed with `--copy`. Agent
 * dirs that already hold the skill are left as they are.
 */
async function linkInstalledSkills(
  skillNames: string[],
  lock: Awaited<ReturnType<typeof readLocalLock>>,
  targetAgents: AgentType[],
  cwd: string
): Promise<void> {
  for (const name of skillNames) {
    const path = getCanonicalPath(name, { cwd });
    const mode = lock.skills[name]?.installMode === 'copy' ? 'copy' : 'symlink';
    for (const agent of targetAgents) {
      if (existsSync(getInstallPath(name, agent, { cwd }))) continue;
      const result = await installSkillForAgent({ name, description: '', path }, agent, {
        cwd,
        mode,
        createMissingAgentRoot: true,
      });
      if (!result.success) {
        p.log.error(
          `Failed to link ${pc.cyan(name)} to ${agents[agent].displayName}: ${result.error}`
        );
        process.exitCode = 1;
      }
    }
  }
}
