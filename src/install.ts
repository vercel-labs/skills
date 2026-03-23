import * as p from '@clack/prompts';
import pc from 'picocolors';
import { runAdd } from './add.ts';
import { readLocalLock } from './local-lock.ts';
import { agents, detectInstalledAgents, getUniversalAgents } from './agents.ts';
import { readSkillLock } from './skill-lock.ts';
import { runSync, parseSyncOptions } from './sync.ts';
import type { AgentType } from './types.ts';

interface InstallFromLockOptions {
  global?: boolean;
  agent?: string[];
}

interface RestoreEntry {
  source: string;
  sourceType: string;
}

export function parseInstallFromLockOptions(args: string[]): InstallFromLockOptions {
  const options: InstallFromLockOptions = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '-g' || arg === '--global') {
      options.global = true;
    } else if (arg === '-a' || arg === '--agent') {
      options.agent = options.agent || [];
      i++;
      let nextArg = args[i];
      while (i < args.length && nextArg && !nextArg.startsWith('-')) {
        options.agent.push(nextArg);
        i++;
        nextArg = args[i];
      }
      i--;
    }
  }

  return options;
}

function validateAgents(agentNames: string[], global: boolean): AgentType[] {
  const validAgents = Object.keys(agents) as AgentType[];
  if (agentNames.includes('*')) {
    return global
      ? validAgents.filter((agent) => agents[agent].globalSkillsDir !== undefined)
      : validAgents;
  }
  const invalidAgents = agentNames.filter((agent) => !validAgents.includes(agent as AgentType));

  if (invalidAgents.length > 0) {
    p.log.error(`Invalid agents: ${invalidAgents.join(', ')}`);
    p.log.info(`Valid agents: ${validAgents.join(', ')}`);
    process.exit(1);
    throw new Error('Unreachable');
  }

  const targetAgents = agentNames as AgentType[];

  if (global) {
    const unsupported = targetAgents.filter((agent) => agents[agent].globalSkillsDir === undefined);
    if (unsupported.length > 0) {
      p.log.error(`Agents do not support global installs: ${unsupported.join(', ')}`);
      process.exit(1);
      throw new Error('Unreachable');
    }
  }

  return targetAgents;
}

async function resolveGlobalRestoreAgents(explicitAgents?: string[]): Promise<AgentType[]> {
  if (explicitAgents && explicitAgents.length > 0) {
    return validateAgents(explicitAgents, true);
  }

  const installedAgents = await detectInstalledAgents();
  const globalCapableAgents = installedAgents.filter((agent) => agents[agent].globalSkillsDir);
  const lock = await readSkillLock();
  const savedAgents = (lock.lastSelectedGlobalAgents || []).filter(
    (agent): agent is AgentType => agents[agent as AgentType]?.globalSkillsDir !== undefined
  );

  if (globalCapableAgents.length > 0) {
    return globalCapableAgents;
  }

  if (savedAgents.length > 0) {
    return savedAgents;
  }

  p.log.warn('No global-capable installed agents detected.');
  p.log.info(`Re-run with ${pc.cyan('skills experimental_install -g --agent <agent>')}`);
  process.exit(1);
  throw new Error('Unreachable');
}

function groupRestoreEntries(
  entries: Array<[string, { source: string; sourceType: string; sourceUrl?: string }]>
): Map<string, { sourceType: string; skills: string[] }> {
  const grouped = new Map<string, { sourceType: string; skills: string[] }>();

  for (const [skillName, entry] of entries) {
    const replaySource = entry.sourceUrl || entry.source;
    const existing = grouped.get(replaySource);

    if (existing) {
      existing.skills.push(skillName);
      continue;
    }

    grouped.set(replaySource, {
      sourceType: entry.sourceType,
      skills: [skillName],
    });
  }

  return grouped;
}

/**
 * Install all skills from the appropriate lock file.
 * Project scope restores from skills-lock.json into project canonical targets.
 * Global scope restores from the global lock and recreates agent links/copies.
 *
 * node_modules skills are handled via experimental_sync for project restores.
 */
export async function runInstallFromLock(args: string[]): Promise<void> {
  const cwd = process.cwd();
  const options = parseInstallFromLockOptions(args);
  const isGlobal = options.global === true;

  if (!isGlobal) {
    const lock = await readLocalLock(cwd);
    const skillEntries = Object.entries(lock.skills);

    if (skillEntries.length === 0) {
      p.log.warn('No project skills found in skills-lock.json');
      p.log.info(
        `Add project-level skills with ${pc.cyan('npx skills add <package>')} (without ${pc.cyan('-g')})`
      );
      return;
    }

    const universalAgentNames = getUniversalAgents();
    const nodeModuleSkills: string[] = [];
    const bySource = new Map<string, { sourceType: string; skills: string[] }>();

    for (const [skillName, entry] of skillEntries) {
      if (entry.sourceType === 'node_modules') {
        nodeModuleSkills.push(skillName);
        continue;
      }

      const existing = bySource.get(entry.source);
      if (existing) {
        existing.skills.push(skillName);
      } else {
        bySource.set(entry.source, {
          sourceType: entry.sourceType,
          skills: [skillName],
        });
      }
    }

    const remoteCount = skillEntries.length - nodeModuleSkills.length;
    if (remoteCount > 0) {
      p.log.info(
        `Restoring ${pc.cyan(String(remoteCount))} skill${remoteCount !== 1 ? 's' : ''} from skills-lock.json into ${pc.dim('.agents/skills/')}`
      );
    }

    for (const [source, { skills }] of bySource) {
      try {
        await runAdd([source], {
          skill: skills,
          agent: universalAgentNames,
          yes: true,
        });
      } catch (error) {
        p.log.error(
          `Failed to install from ${pc.cyan(source)}: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }
    }

    if (nodeModuleSkills.length > 0) {
      p.log.info(
        `${pc.cyan(String(nodeModuleSkills.length))} skill${nodeModuleSkills.length !== 1 ? 's' : ''} from node_modules`
      );
      try {
        const { options: syncOptions } = parseSyncOptions(args);
        await runSync(args, { ...syncOptions, yes: true, agent: universalAgentNames });
      } catch (error) {
        p.log.error(
          `Failed to sync node_modules skills: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }
    }

    return;
  }

  const lock = await readSkillLock();
  const skillEntries = Object.entries(lock.skills);

  if (skillEntries.length === 0) {
    p.log.warn('No global skills found in the global skill lock.');
    p.log.info(`Add global skills with ${pc.cyan('npx skills add <package> -g')}`);
    return;
  }

  const targetAgents = await resolveGlobalRestoreAgents(options.agent);
  const bySource = groupRestoreEntries(skillEntries);

  p.log.info(
    `Restoring ${pc.cyan(String(skillEntries.length))} skill${skillEntries.length !== 1 ? 's' : ''} from the global skill lock`
  );
  p.log.info(
    `Relinking for: ${targetAgents.map((agent) => pc.cyan(agents[agent].displayName)).join(', ')}`
  );

  for (const [source, { skills }] of bySource) {
    try {
      await runAdd([source], {
        global: true,
        skill: skills,
        agent: targetAgents,
        yes: true,
      });
    } catch (error) {
      p.log.error(
        `Failed to install from ${pc.cyan(source)}: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }
}
