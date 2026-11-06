import { existsSync } from 'fs';
import { join } from 'path';
import * as p from '@clack/prompts';
import pc from 'picocolors';
import { readLocalLock } from './local-lock.ts';
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
 * Groups skills by source and installs each group; a failing source does not
 * stop the others.
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
  // Keyed by source and install mode, so copied skills stay copies
  const bySource = new Map<string, { source: string; copy: boolean; skills: string[] }>();

  for (const [skillName, entry] of skillEntries) {
    if (entry.sourceType === 'node_modules') {
      nodeModuleSkills.push(skillName);
      continue;
    }

    if (!force && existsSync(join(getCanonicalPath(skillName, { cwd }), 'SKILL.md'))) {
      alreadyInstalled.push(skillName);
      continue;
    }

    const installSource = buildLocalUpdateSource(entry);
    if (!installSource) {
      p.log.error(
        formatError(diagnostics.SKILLS_LOCK_MISSING_SOURCE_URL({ skill: pc.cyan(skillName) }))
      );
      continue;
    }
    const copy = entry.installMode === 'copy';
    const key = `${copy ? 'copy' : 'symlink'}:${installSource}`;
    const group = bySource.get(key) ?? { source: installSource, copy, skills: [] };
    group.skills.push(skillName);
    bySource.set(key, group);
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
  const requests = [...bySource.values()].map(({ source, copy, skills }) => ({
    source,
    copy,
    parsed: parseSource(source),
    skills,
  }));
  const fetched = await fetchSources(requests);
  for (const [index, { source, copy, skills }] of requests.entries()) {
    const result = await installFromSource(fetched[index]!, {
      skills,
      agents: targetAgents,
      ...(copy && { installMode: 'copy' as const }),
      ...(frozen && { frozenLock: lock }),
    });
    if (result.error) {
      p.log.error(`Failed to install from ${pc.cyan(source)}: ${result.error}`);
      process.exitCode = 1;
      continue;
    }
    p.log.success(`Restored ${result.installed.map((name) => pc.cyan(name)).join(', ')}`);
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
    }
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
