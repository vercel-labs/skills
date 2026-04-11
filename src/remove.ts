import * as p from '@clack/prompts';
import pc from 'picocolors';
import { readdir, rm, lstat } from 'fs/promises';
import { dirname, join } from 'path';
import { agents, detectInstalledAgents } from './agents.ts';
import { track } from './telemetry.ts';
import {
  removeSkillFromLock,
  getSkillFromLock,
  readSkillLock,
  scrubSkillFromGlobalManagement,
  type SkillLockEntry,
} from './skill-lock.ts';
import {
  readLocalLock,
  removeSkillFromLocalLock,
  scrubSkillFromLocalManagement,
  type LocalSkillLockEntry,
} from './local-lock.ts';
import type { ManagementState } from './management-state.ts';
import type { AgentType } from './types.ts';
import {
  getInstallPath,
  getCanonicalPath,
  getCanonicalSkillsDir,
  sanitizeName,
} from './installer.ts';

export interface RemoveOptions {
  global?: boolean;
  agent?: string[];
  yes?: boolean;
  all?: boolean;
}

export async function removeCommand(skillNames: string[], options: RemoveOptions) {
  const isGlobal = options.global ?? false;
  const cwd = process.cwd();
  const localLock = isGlobal ? null : await readLocalLock(cwd);
  const globalLock = isGlobal ? await readSkillLock() : null;

  const spinner = p.spinner();

  spinner.start('Scanning for installed skills...');
  const skillNamesSet = new Set<string>();

  const scanDir = async (dir: string) => {
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          skillNamesSet.add(entry.name);
        }
      }
    } catch (err) {
      if (err instanceof Error && (err as { code?: string }).code !== 'ENOENT') {
        p.log.warn(`Could not scan directory ${dir}: ${err.message}`);
      }
    }
  };

  const scanSkillRoot = async (skillsRoot: string) => {
    await scanDir(skillsRoot);
    await scanDir(getDisabledSkillsDir(skillsRoot));
  };

  if (isGlobal) {
    await scanSkillRoot(getCanonicalSkillsDir(true, cwd));
    for (const agent of Object.values(agents)) {
      if (agent.globalSkillsDir !== undefined) {
        await scanSkillRoot(agent.globalSkillsDir);
      }
    }
  } else {
    await scanSkillRoot(getCanonicalSkillsDir(false, cwd));
    for (const agent of Object.values(agents)) {
      await scanSkillRoot(join(cwd, agent.skillsDir));
    }
  }

  const installedSkills = Array.from(skillNamesSet).sort();
  const trackedSkills = Object.keys(
    isGlobal ? (globalLock?.skills ?? {}) : (localLock?.skills ?? {})
  );
  const management = isGlobal ? globalLock?.management : localLock?.management;
  const knownSkills = Array.from(
    new Set([...installedSkills, ...trackedSkills, ...collectManagementSkillNames(management)])
  ).sort();
  spinner.stop(`Found ${installedSkills.length} unique installed skill(s)`);

  // Validate agent options BEFORE prompting for skill selection
  if (options.agent && options.agent.length > 0) {
    const validAgents = Object.keys(agents);
    const invalidAgents = options.agent.filter((a) => !validAgents.includes(a));

    if (invalidAgents.length > 0) {
      p.log.error(`Invalid agents: ${invalidAgents.join(', ')}`);
      p.log.info(`Valid agents: ${validAgents.join(', ')}`);
      process.exit(1);
    }
  }

  let selectedSkills: string[] = [];

  if (options.all) {
    if (knownSkills.length === 0) {
      p.outro(pc.yellow('No skills found to remove.'));
      return;
    }
    selectedSkills = knownSkills;
  } else if (skillNames.length > 0) {
    if (knownSkills.length === 0) {
      p.outro(pc.yellow('No skills found to remove.'));
      return;
    }

    const byLowerName = new Map(knownSkills.map((name) => [name.toLowerCase(), name] as const));
    selectedSkills = Array.from(
      new Set(
        skillNames
          .map((name) => byLowerName.get(name.toLowerCase()))
          .filter((name): name is string => Boolean(name))
      )
    );

    if (selectedSkills.length === 0) {
      p.log.error(`No matching skills found for: ${skillNames.join(', ')}`);
      return;
    }
  } else {
    if (installedSkills.length === 0) {
      p.outro(pc.yellow('No skills found to remove.'));
      return;
    }

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

    selectedSkills = selected as string[];
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

  spinner.start('Removing skills...');

  const results: {
    skill: string;
    success: boolean;
    source?: string;
    sourceType?: string;
    error?: string;
  }[] = [];

  for (const skillName of selectedSkills) {
    try {
      const sanitizedName = sanitizeName(skillName);
      const canonicalPath = getCanonicalPath(skillName, { global: isGlobal, cwd });
      const disabledCanonicalPath = join(
        getDisabledSkillsDir(dirname(canonicalPath)),
        sanitizedName
      );

      for (const agentKey of targetAgents) {
        const agent = agents[agentKey];
        const activeSkillPath = getInstallPath(skillName, agentKey, { global: isGlobal, cwd });
        const disabledSkillPath = join(
          getDisabledSkillsDir(dirname(activeSkillPath)),
          sanitizedName
        );

        // Determine potential paths to cleanup. For universal agents, getInstallPath
        // now returns the canonical path, so we also need to check their 'native'
        // directory to clean up any legacy symlinks.
        const pathsToCleanup = new Set([activeSkillPath, disabledSkillPath]);
        if (isGlobal && agent.globalSkillsDir) {
          pathsToCleanup.add(join(agent.globalSkillsDir, sanitizedName));
          pathsToCleanup.add(join(getDisabledSkillsDir(agent.globalSkillsDir), sanitizedName));
        } else {
          pathsToCleanup.add(join(cwd, agent.skillsDir, sanitizedName));
          pathsToCleanup.add(join(getDisabledSkillsDir(join(cwd, agent.skillsDir)), sanitizedName));
        }

        for (const pathToCleanup of pathsToCleanup) {
          // Skip if this is a canonical path - we'll handle that after checking all agents
          if (pathToCleanup === canonicalPath || pathToCleanup === disabledCanonicalPath) {
            continue;
          }

          try {
            await rm(pathToCleanup, { recursive: true, force: true });
          } catch (err) {
            p.log.warn(
              `Could not remove skill from ${agent.displayName}: ${
                err instanceof Error ? err.message : String(err)
              }`
            );
          }
        }
      }

      // Only remove the canonical path if no other installed agents are using it.
      // This prevents breaking other agents when uninstalling from a specific agent (#287).
      const installedAgents = await detectInstalledAgents();
      const remainingAgents = installedAgents.filter((a) => !targetAgents.includes(a));

      let isStillUsed = false;
      for (const agentKey of remainingAgents) {
        const activePath = getInstallPath(skillName, agentKey, { global: isGlobal, cwd });
        const disabledPath = join(getDisabledSkillsDir(dirname(activePath)), sanitizedName);
        const activeExists = await lstat(activePath).catch(() => null);
        const disabledExists = await lstat(disabledPath).catch(() => null);
        if (activeExists || disabledExists) {
          isStillUsed = true;
          break;
        }
      }

      if (!isStillUsed) {
        await rm(canonicalPath, { recursive: true, force: true });
        await rm(disabledCanonicalPath, { recursive: true, force: true });
      }

      const localEntry = localLock?.skills[skillName];
      const globalEntry = isGlobal ? await getSkillFromLock(skillName) : null;
      const effectiveSource = globalEntry?.source || localEntry?.source || 'local';
      const effectiveSourceType = globalEntry?.sourceType || localEntry?.sourceType || 'local';

      if (isGlobal) {
        const removedFromLock = await removeSkillFromLock(skillName);
        if (!removedFromLock && isSkillReferencedInManagement(globalLock?.management, skillName)) {
          await scrubSkillFromGlobalManagement(skillName);
        }
      } else {
        const removedFromLock = await removeSkillFromLocalLock(skillName, cwd);
        if (!removedFromLock && isSkillReferencedInManagement(localLock?.management, skillName)) {
          await scrubSkillFromLocalManagement(skillName, cwd);
        }
      }

      results.push({
        skill: skillName,
        success: true,
        source: effectiveSource,
        sourceType: effectiveSourceType,
      });
    } catch (err) {
      results.push({
        skill: skillName,
        success: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  spinner.stop('Removal process complete');

  const successful = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);

  // Track removal (grouped by source)
  if (successful.length > 0) {
    const bySource = new Map<string, { skills: string[]; sourceType?: string }>();

    for (const r of successful) {
      const source = r.source || 'local';
      const existing = bySource.get(source) || { skills: [] };
      existing.skills.push(r.skill);
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

/**
 * Parse command line options for the remove command.
 * Separates skill names from options flags.
 */
export function parseRemoveOptions(args: string[]): { skills: string[]; options: RemoveOptions } {
  const options: RemoveOptions = {};
  const skills: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '-g' || arg === '--global') {
      options.global = true;
    } else if (arg === '-y' || arg === '--yes') {
      options.yes = true;
    } else if (arg === '--all') {
      options.all = true;
    } else if (arg === '-a' || arg === '--agent') {
      options.agent = options.agent || [];
      i++;
      let nextArg = args[i];
      while (i < args.length && nextArg && !nextArg.startsWith('-')) {
        options.agent.push(nextArg);
        i++;
        nextArg = args[i];
      }
      i--; // Back up one since the loop will increment
    } else if (arg && !arg.startsWith('-')) {
      skills.push(arg);
    }
  }

  return { skills, options };
}

function getDisabledSkillsDir(skillsRoot: string): string {
  return join(dirname(skillsRoot), 'disabled_skills');
}

function collectManagementSkillNames(management?: ManagementState): string[] {
  if (!management) {
    return [];
  }

  const groupMembers = Object.values(management.groups ?? {}).flat();
  return management.managerSkill
    ? Array.from(new Set([...groupMembers, management.managerSkill]))
    : Array.from(new Set(groupMembers));
}

function isSkillReferencedInManagement(
  management: ManagementState | undefined,
  skillName: string
): boolean {
  if (!management) {
    return false;
  }

  if (management.managerSkill === skillName) {
    return true;
  }

  return Object.values(management.groups ?? {}).some((members) => members.includes(skillName));
}
