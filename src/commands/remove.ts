import * as p from '@clack/prompts';
import pc from 'picocolors';
import { readdir, rm, lstat } from 'fs/promises';
import { join } from 'path';
import { logger, type Ora } from '../utils/logger.ts';
import { agents, detectInstalledAgents } from '../services/registry/index.ts';
import { track } from '../services/telemetry/index.ts';
import { removeCognitiveFromLock, getCognitiveFromLock } from '../services/lock/lock-file.ts';
import type { AgentType, CognitiveType } from '../core/types.ts';
import { COGNITIVE_FILE_NAMES } from '../core/types.ts';
import { getInstallPath, getCanonicalPath, getCanonicalDir } from '../services/installer/index.ts';

export interface RemoveOptions {
  global?: boolean;
  agent?: string[];
  yes?: boolean;
  all?: boolean;
  type?: CognitiveType;
}

export async function removeCommand(skillNames: string[], options: RemoveOptions) {
  const isGlobal = options.global ?? false;
  const cwd = process.cwd();

  const spinner = logger.spinner('Scanning for installed cognitives...');
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
        logger.warning(`Could not scan directory ${dir}: ${err.message}`);
      }
    }
  };

  // Determine which cognitive types to scan
  const typesToScan: CognitiveType[] = options.type
    ? [options.type]
    : (Object.keys(COGNITIVE_FILE_NAMES) as CognitiveType[]);

  for (const cogType of typesToScan) {
    if (isGlobal) {
      await scanDir(getCanonicalDir(cogType, true, cwd));
      for (const agent of Object.values(agents)) {
        const dir = agent.dirs[cogType]!.global;
        if (dir !== undefined) {
          await scanDir(dir);
        }
      }
    } else {
      await scanDir(getCanonicalDir(cogType, false, cwd));
      for (const agent of Object.values(agents)) {
        const dir = agent.dirs[cogType]!.local;
        await scanDir(join(cwd, dir));
      }
    }
  }

  const installedSkills = Array.from(skillNamesSet).sort();
  spinner.succeed(`Found ${installedSkills.length} unique installed cognitive(s)`);

  if (installedSkills.length === 0) {
    logger.outro(pc.yellow('No cognitives found to remove.'));
    return;
  }

  // Validate agent options BEFORE prompting for skill selection
  if (options.agent && options.agent.length > 0) {
    const validAgents = Object.keys(agents);
    const invalidAgents = options.agent.filter((a) => !validAgents.includes(a));

    if (invalidAgents.length > 0) {
      logger.error(`Invalid agents: ${invalidAgents.join(', ')}`);
      logger.info(`Valid agents: ${validAgents.join(', ')}`);
      process.exit(1);
    }
  }

  let selectedSkills: string[] = [];

  if (options.all) {
    selectedSkills = installedSkills;
  } else if (skillNames.length > 0) {
    selectedSkills = installedSkills.filter((s) =>
      skillNames.some((name) => name.toLowerCase() === s.toLowerCase())
    );

    if (selectedSkills.length === 0) {
      logger.error(`No matching skills found for: ${skillNames.join(', ')}`);
      return;
    }
  } else {
    const choices = installedSkills.map((s) => ({
      value: s,
      label: s,
    }));

    const selected = await p.multiselect({
      message: `Select cognitives to remove ${pc.dim('(space to toggle)')}`,
      options: choices,
      required: true,
    });

    if (p.isCancel(selected)) {
      logger.cancel('Removal cancelled');
      process.exit(0);
    }

    selectedSkills = selected as string[];
  }

  let targetAgents: AgentType[];
  if (options.agent && options.agent.length > 0) {
    targetAgents = options.agent as AgentType[];
  } else {
    spinner.start('Detecting installed agents...');
    targetAgents = await detectInstalledAgents();
    if (targetAgents.length === 0) {
      // Fallback to all agents if none detected, to ensure we can at least try to remove from defaults
      targetAgents = Object.keys(agents) as AgentType[];
    }
    spinner.succeed(`Targeting ${targetAgents.length} installed agent(s)`);
  }

  if (!options.yes) {
    logger.line();
    logger.info('Cognitives to remove:');
    for (const skill of selectedSkills) {
      logger.message(`${pc.red('\u2022')} ${skill}`);
    }
    logger.line();

    const confirmed = await p.confirm({
      message: `Are you sure you want to uninstall ${selectedSkills.length} cognitive(s)?`,
    });

    if (p.isCancel(confirmed) || !confirmed) {
      logger.cancel('Removal cancelled');
      process.exit(0);
    }
  }

  spinner.start('Removing cognitives...');

  const results: {
    skill: string;
    success: boolean;
    source?: string;
    sourceType?: string;
    error?: string;
  }[] = [];

  for (const skillName of selectedSkills) {
    try {
      for (const agentKey of targetAgents) {
        const agent = agents[agentKey];
        const skillPath = getInstallPath(skillName, agentKey, { global: isGlobal, cwd });

        try {
          const stats = await lstat(skillPath).catch(() => null);
          if (stats) {
            await rm(skillPath, { recursive: true, force: true });
          }
        } catch (err) {
          logger.warning(
            `Could not remove skill from ${agent.displayName}: ${
              err instanceof Error ? err.message : String(err)
            }`
          );
        }
      }

      // Remove from all cognitive type canonical dirs
      for (const cogType of typesToScan) {
        const canonicalPath = getCanonicalPath(skillName, {
          global: isGlobal,
          cwd,
          cognitiveType: cogType,
        });
        await rm(canonicalPath, { recursive: true, force: true });
      }

      const lockEntry = isGlobal ? await getCognitiveFromLock(skillName) : null;
      const effectiveSource = lockEntry?.source || 'local';
      const effectiveSourceType = lockEntry?.sourceType || 'local';

      if (isGlobal) {
        await removeCognitiveFromLock(skillName);
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

  spinner.succeed('Removal process complete');

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
    logger.success(pc.green(`Successfully removed ${successful.length} cognitive(s)`));
  }

  if (failed.length > 0) {
    logger.error(pc.red(`Failed to remove ${failed.length} cognitive(s)`));
    for (const r of failed) {
      logger.message(`${pc.red('\u2717')} ${r.skill}: ${r.error}`);
    }
  }

  logger.line();
  logger.outro(pc.green('Done!'));
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
    } else if (arg === '-t' || arg === '--type') {
      i++;
      const typeVal = args[i];
      if (typeVal && (Object.keys(COGNITIVE_FILE_NAMES) as string[]).includes(typeVal)) {
        options.type = typeVal as CognitiveType;
      }
    } else if (arg && !arg.startsWith('-')) {
      skills.push(arg);
    }
  }

  return { skills, options };
}
