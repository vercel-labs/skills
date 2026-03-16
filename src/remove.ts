import * as p from '@clack/prompts';
import pc from 'picocolors';
import { readdir, rm, lstat } from 'fs/promises';
import { join } from 'path';
import { targets, detectInstalledTargets } from './targets.ts';
import { track } from './telemetry.ts';
import { removeAgentFromLock, getAgentFromLock } from './agent-lock.ts';
import type { TargetType } from './types.ts';
import {
  getInstallPath,
  getCanonicalPath,
  getCanonicalAgentsDir,
  sanitizeName,
} from './installer.ts';

export interface RemoveOptions {
  global?: boolean;
  target?: string[];
  yes?: boolean;
  all?: boolean;
}

export async function removeCommand(agentNames: string[], options: RemoveOptions) {
  const isGlobal = options.global ?? false;
  const cwd = process.cwd();

  const spinner = p.spinner();

  spinner.start('Scanning for installed agents...');
  const agentNamesSet = new Set<string>();

  const scanDir = async (dir: string) => {
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          agentNamesSet.add(entry.name);
        }
      }
    } catch (err) {
      if (err instanceof Error && (err as { code?: string }).code !== 'ENOENT') {
        p.log.warn(`Could not scan directory ${dir}: ${err.message}`);
      }
    }
  };

  if (isGlobal) {
    await scanDir(getCanonicalAgentsDir(true, cwd));
    for (const tgt of Object.values(targets)) {
      if (tgt.globalAgentsDir !== undefined) {
        await scanDir(tgt.globalAgentsDir);
      }
    }
  } else {
    await scanDir(getCanonicalAgentsDir(false, cwd));
    for (const tgt of Object.values(targets)) {
      await scanDir(join(cwd, tgt.agentsDir));
    }
  }

  const installedAgents = Array.from(agentNamesSet).sort();
  spinner.stop(`Found ${installedAgents.length} unique installed agent(s)`);

  if (installedAgents.length === 0) {
    p.outro(pc.yellow('No agents found to remove.'));
    return;
  }

  // Validate agent options BEFORE prompting for agent selection
  if (options.target && options.target.length > 0) {
    const validAgents = Object.keys(targets);
    const invalidAgents = options.target.filter((a) => !validAgents.includes(a));

    if (invalidAgents.length > 0) {
      p.log.error(`Invalid agents: ${invalidAgents.join(', ')}`);
      p.log.info(`Valid agents: ${validAgents.join(', ')}`);
      process.exit(1);
    }
  }

  let selectedAgents: string[] = [];

  if (options.all) {
    selectedAgents = installedAgents;
  } else if (agentNames.length > 0) {
    selectedAgents = installedAgents.filter((s) =>
      agentNames.some((name) => name.toLowerCase() === s.toLowerCase())
    );

    if (selectedAgents.length === 0) {
      p.log.error(`No matching agents found for: ${agentNames.join(', ')}`);
      return;
    }
  } else {
    const choices = installedAgents.map((s) => ({
      value: s,
      label: s,
    }));

    const selected = await p.multiselect({
      message: `Select agents to remove ${pc.dim('(space to toggle)')}`,
      options: choices,
      required: true,
    });

    if (p.isCancel(selected)) {
      p.cancel('Removal cancelled');
      process.exit(0);
    }

    selectedAgents = selected as string[];
  }

  let targetAgents: TargetType[];
  if (options.target && options.target.length > 0) {
    targetAgents = options.target as TargetType[];
  } else {
    // When removing, we should target all known agents to ensure
    // ghost symlinks are cleaned up, even if the agent is not detected.
    targetAgents = Object.keys(targets) as TargetType[];
    spinner.stop(`Targeting ${targetAgents.length} potential agent(s)`);
  }

  if (!options.yes) {
    console.log();
    p.log.info('Agents to remove:');
    for (const agent of selectedAgents) {
      p.log.message(`  ${pc.red('•')} ${agent}`);
    }
    console.log();

    const confirmed = await p.confirm({
      message: `Are you sure you want to uninstall ${selectedAgents.length} agent(s)?`,
    });

    if (p.isCancel(confirmed) || !confirmed) {
      p.cancel('Removal cancelled');
      process.exit(0);
    }
  }

  spinner.start('Removing agents...');

  const results: {
    agent: string;
    success: boolean;
    source?: string;
    sourceType?: string;
    error?: string;
  }[] = [];

  for (const agentName of selectedAgents) {
    try {
      const canonicalPath = getCanonicalPath(agentName, { global: isGlobal, cwd });

      for (const agentKey of targetAgents) {
        const agent = targets[agentKey];
        const agentPath = getInstallPath(agentName, agentKey, { global: isGlobal, cwd });

        // Determine potential paths to cleanup. For universal agents, getInstallPath
        // now returns the canonical path, so we also need to check their 'native'
        // directory to clean up any legacy symlinks.
        const pathsToCleanup = new Set([agentPath]);
        const sanitizedName = sanitizeName(agentName);
        if (isGlobal && agent.globalAgentsDir) {
          pathsToCleanup.add(join(agent.globalAgentsDir, sanitizedName));
        } else {
          pathsToCleanup.add(join(cwd, agent.agentsDir, sanitizedName));
        }

        for (const pathToCleanup of pathsToCleanup) {
          // Skip if this is the canonical path - we'll handle that after checking all agents
          if (pathToCleanup === canonicalPath) {
            continue;
          }

          try {
            const stats = await lstat(pathToCleanup).catch(() => null);
            if (stats) {
              await rm(pathToCleanup, { recursive: true, force: true });
            }
          } catch (err) {
            p.log.warn(
              `Could not remove agent from ${agent.displayName}: ${
                err instanceof Error ? err.message : String(err)
              }`
            );
          }
        }
      }

      // Only remove the canonical path if no other installed agents are using it.
      // This prevents breaking other agents when uninstalling from a specific agent (#287).
      const installedTargets = await detectInstalledTargets();
      const remainingAgents = installedTargets.filter((a) => !targetAgents.includes(a));

      let isStillUsed = false;
      for (const agentKey of remainingAgents) {
        const path = getInstallPath(agentName, agentKey, { global: isGlobal, cwd });
        const exists = await lstat(path).catch(() => null);
        if (exists) {
          isStillUsed = true;
          break;
        }
      }

      if (!isStillUsed) {
        await rm(canonicalPath, { recursive: true, force: true });
      }

      const lockEntry = isGlobal ? await getAgentFromLock(agentName) : null;
      const effectiveSource = lockEntry?.source || 'local';
      const effectiveSourceType = lockEntry?.sourceType || 'local';

      if (isGlobal) {
        await removeAgentFromLock(agentName);
      }

      results.push({
        agent: agentName,
        success: true,
        source: effectiveSource,
        sourceType: effectiveSourceType,
      });
    } catch (err) {
      results.push({
        agent: agentName,
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
    const bySource = new Map<string, { agents: string[]; sourceType?: string }>();

    for (const r of successful) {
      const source = r.source || 'local';
      const existing = bySource.get(source) || { agents: [] };
      existing.agents.push(r.agent);
      existing.sourceType = r.sourceType;
      bySource.set(source, existing);
    }

    for (const [source, data] of bySource) {
      track({
        event: 'remove',
        source,
        agents: data.agents.join(','),
        targets: targetAgents.join(','),
        ...(isGlobal && { global: '1' }),
        sourceType: data.sourceType,
      });
    }
  }

  if (successful.length > 0) {
    p.log.success(pc.green(`Successfully removed ${successful.length} agent(s)`));
  }

  if (failed.length > 0) {
    p.log.error(pc.red(`Failed to remove ${failed.length} agent(s)`));
    for (const r of failed) {
      p.log.message(`  ${pc.red('✗')} ${r.agent}: ${r.error}`);
    }
  }

  console.log();
  p.outro(pc.green('Done!'));
}

/**
 * Parse command line options for the remove command.
 * Separates agent names from options flags.
 */
export function parseRemoveOptions(args: string[]): { agents: string[]; options: RemoveOptions } {
  const options: RemoveOptions = {};
  const agents: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '-g' || arg === '--global') {
      options.global = true;
    } else if (arg === '-y' || arg === '--yes') {
      options.yes = true;
    } else if (arg === '--all') {
      options.all = true;
    } else if (arg === '-t' || arg === '--target') {
      options.target = options.target || [];
      i++;
      let nextArg = args[i];
      while (i < args.length && nextArg && !nextArg.startsWith('-')) {
        options.target.push(nextArg);
        i++;
        nextArg = args[i];
      }
      i--; // Back up one since the loop will increment
    } else if (arg && !arg.startsWith('-')) {
      agents.push(arg);
    }
  }

  return { agents, options };
}
