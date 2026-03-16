import * as p from '@clack/prompts';
import pc from 'picocolors';
import { readdir, stat } from 'fs/promises';
import { join, sep } from 'path';
import { homedir } from 'os';
import { parseAgentMd } from './agents.ts';
import { installAgentForTarget, getCanonicalPath } from './installer.ts';
import {
  detectInstalledTargets,
  targets,
  getUniversalTargets,
  getNonUniversalTargets,
} from './targets.ts';
import { searchMultiselect } from './prompts/search-multiselect.ts';
import { addAgentToLocalLock, computeAgentFolderHash, readLocalLock } from './local-lock.ts';
import type { Agent, TargetType } from './types.ts';
import { track } from './telemetry.ts';

const isCancelled = (value: unknown): value is symbol => typeof value === 'symbol';

export interface SyncOptions {
  target?: string[];
  yes?: boolean;
  force?: boolean;
}

/**
 * Shortens a path for display: replaces homedir with ~ and cwd with .
 */
function shortenPath(fullPath: string, cwd: string): string {
  const home = homedir();
  if (fullPath === home || fullPath.startsWith(home + sep)) {
    return '~' + fullPath.slice(home.length);
  }
  if (fullPath === cwd || fullPath.startsWith(cwd + sep)) {
    return '.' + fullPath.slice(cwd.length);
  }
  return fullPath;
}

/**
 * Crawl node_modules for AGENT.md files.
 * Searches both top-level packages and scoped packages (@org/pkg).
 * Returns discovered agents with their source package name.
 */
async function discoverNodeModuleAgents(
  cwd: string
): Promise<Array<Agent & { packageName: string }>> {
  const nodeModulesDir = join(cwd, 'node_modules');
  const agents: Array<Agent & { packageName: string }> = [];

  let topNames: string[];
  try {
    topNames = await readdir(nodeModulesDir);
  } catch {
    return agents;
  }

  const processPackageDir = async (pkgDir: string, packageName: string) => {
    // Check for AGENT.md at package root
    const rootAgent = await parseAgentMd(join(pkgDir, 'AGENT.md'));
    if (rootAgent) {
      agents.push({ ...rootAgent, packageName });
      return;
    }

    // Check common agent locations within the package
    const searchDirs = [pkgDir, join(pkgDir, 'agents'), join(pkgDir, '.agents', 'agents')];

    for (const searchDir of searchDirs) {
      try {
        const entries = await readdir(searchDir);
        for (const name of entries) {
          const agentDir = join(searchDir, name);
          try {
            const s = await stat(agentDir);
            if (!s.isDirectory()) continue;
          } catch {
            continue;
          }
          const agent = await parseAgentMd(join(agentDir, 'AGENT.md'));
          if (agent) {
            agents.push({ ...agent, packageName });
          }
        }
      } catch {
        // Directory doesn't exist
      }
    }
  };

  await Promise.all(
    topNames.map(async (name) => {
      if (name.startsWith('.')) return;

      const fullPath = join(nodeModulesDir, name);
      try {
        const s = await stat(fullPath);
        if (!s.isDirectory()) return;
      } catch {
        return;
      }

      if (name.startsWith('@')) {
        // Scoped package: read @org/* entries
        try {
          const scopeNames = await readdir(fullPath);
          await Promise.all(
            scopeNames.map(async (scopedName) => {
              const scopedPath = join(fullPath, scopedName);
              try {
                const s = await stat(scopedPath);
                if (!s.isDirectory()) return;
              } catch {
                return;
              }
              await processPackageDir(scopedPath, `${name}/${scopedName}`);
            })
          );
        } catch {
          // Scope directory not readable
        }
      } else {
        await processPackageDir(fullPath, name);
      }
    })
  );

  return agents;
}

export async function runSync(args: string[], options: SyncOptions = {}): Promise<void> {
  const cwd = process.cwd();

  console.log();
  p.intro(pc.bgCyan(pc.black(' agents experimental_sync ')));

  const spinner = p.spinner();

  // 1. Discover agents from node_modules
  spinner.start('Scanning node_modules for agents...');
  const discoveredAgents = await discoverNodeModuleAgents(cwd);

  if (discoveredAgents.length === 0) {
    spinner.stop(pc.yellow('No agents found'));
    p.outro(pc.dim('No AGENT.md files found in node_modules.'));
    return;
  }

  spinner.stop(
    `Found ${pc.green(String(discoveredAgents.length))} agent${discoveredAgents.length > 1 ? 's' : ''} in node_modules`
  );

  // Show discovered agents
  for (const agent of discoveredAgents) {
    p.log.info(`${pc.cyan(agent.name)} ${pc.dim(`from ${agent.packageName}`)}`);
    if (agent.description) {
      p.log.message(pc.dim(`  ${agent.description}`));
    }
  }

  // 2. Check which agents are already up-to-date via local lock
  const localLock = await readLocalLock(cwd);
  const toInstall: Array<Agent & { packageName: string }> = [];
  const upToDate: string[] = [];

  if (options.force) {
    toInstall.push(...discoveredAgents);
    p.log.info(pc.dim('Force mode: reinstalling all agents'));
  } else {
    for (const agent of discoveredAgents) {
      const existingEntry = localLock.agents[agent.name];
      if (existingEntry) {
        // Compute current hash and compare
        const currentHash = await computeAgentFolderHash(agent.path);
        if (currentHash === existingEntry.computedHash) {
          upToDate.push(agent.name);
          continue;
        }
      }
      toInstall.push(agent);
    }

    if (upToDate.length > 0) {
      p.log.info(
        pc.dim(`${upToDate.length} agent${upToDate.length !== 1 ? 's' : ''} already up to date`)
      );
    }

    if (toInstall.length === 0) {
      console.log();
      p.outro(pc.green('All agents are up to date.'));
      return;
    }
  }

  p.log.info(`${toInstall.length} agent${toInstall.length !== 1 ? 's' : ''} to install/update`);

  // 3. Select agents
  let targetAgents: TargetType[];
  const validAgents = Object.keys(targets);
  const universalAgents = getUniversalTargets();

  if (options.target?.includes('*')) {
    targetAgents = validAgents as TargetType[];
    p.log.info(`Installing to all ${targetAgents.length} agents`);
  } else if (options.target && options.target.length > 0) {
    const invalidAgents = options.target.filter((a) => !validAgents.includes(a));
    if (invalidAgents.length > 0) {
      p.log.error(`Invalid agents: ${invalidAgents.join(', ')}`);
      p.log.info(`Valid agents: ${validAgents.join(', ')}`);
      process.exit(1);
    }
    targetAgents = options.target as TargetType[];
  } else {
    spinner.start('Loading agents...');
    const installedTargets = await detectInstalledTargets();
    const totalAgents = Object.keys(targets).length;
    spinner.stop(`${totalAgents} agents`);

    if (installedTargets.length === 0) {
      if (options.yes) {
        targetAgents = universalAgents;
        p.log.info('Installing to universal agents');
      } else {
        const otherAgents = getNonUniversalTargets();

        const otherChoices = otherAgents.map((a) => ({
          value: a,
          label: targets[a].displayName,
          hint: targets[a].agentsDir,
        }));

        const selected = await searchMultiselect({
          message: 'Which agents do you want to install to?',
          items: otherChoices,
          initialSelected: [],
          lockedSection: {
            title: 'Universal (.agents/agents)',
            items: universalAgents.map((a) => ({
              value: a,
              label: targets[a].displayName,
            })),
          },
        });

        if (isCancelled(selected)) {
          p.cancel('Sync cancelled');
          process.exit(0);
        }

        targetAgents = selected as TargetType[];
      }
    } else if (installedTargets.length === 1 || options.yes) {
      // Ensure universal agents are included
      targetAgents = [...installedTargets];
      for (const ua of universalAgents) {
        if (!targetAgents.includes(ua)) {
          targetAgents.push(ua);
        }
      }
    } else {
      const otherAgents = getNonUniversalTargets().filter((a) => installedTargets.includes(a));

      const otherChoices = otherAgents.map((a) => ({
        value: a,
        label: targets[a].displayName,
        hint: targets[a].agentsDir,
      }));

      const selected = await searchMultiselect({
        message: 'Which agents do you want to install to?',
        items: otherChoices,
        initialSelected: installedTargets.filter((a) => !universalAgents.includes(a)),
        lockedSection: {
          title: 'Universal (.agents/agents)',
          items: universalAgents.map((a) => ({
            value: a,
            label: targets[a].displayName,
          })),
        },
      });

      if (isCancelled(selected)) {
        p.cancel('Sync cancelled');
        process.exit(0);
      }

      targetAgents = selected as TargetType[];
    }
  }

  // 4. Build summary
  const summaryLines: string[] = [];
  for (const agent of toInstall) {
    const canonicalPath = getCanonicalPath(agent.name, { global: false });
    const shortCanonical = shortenPath(canonicalPath, cwd);
    summaryLines.push(`${pc.cyan(agent.name)} ${pc.dim(`← ${agent.packageName}`)}`);
    summaryLines.push(`  ${pc.dim(shortCanonical)}`);
  }

  console.log();
  p.note(summaryLines.join('\n'), 'Sync Summary');

  if (!options.yes) {
    const confirmed = await p.confirm({ message: 'Proceed with sync?' });

    if (p.isCancel(confirmed) || !confirmed) {
      p.cancel('Sync cancelled');
      process.exit(0);
    }
  }

  // 5. Install agents (always project-scoped, always symlink)
  spinner.start('Syncing agents...');

  const results: Array<{
    agent: string;
    packageName: string;
    target: string;
    success: boolean;
    path: string;
    canonicalPath?: string;
    error?: string;
  }> = [];

  for (const ag of toInstall) {
    for (const tgt of targetAgents) {
      const result = await installAgentForTarget(ag, tgt, {
        global: false,
        cwd,
        mode: 'symlink',
      });
      results.push({
        agent: ag.name,
        packageName: ag.packageName,
        target: targets[tgt].displayName,
        success: result.success,
        path: result.path,
        canonicalPath: result.canonicalPath,
        error: result.error,
      });
    }
  }

  spinner.stop('Sync complete');

  // 6. Update local lock file
  const successful = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);
  const successfulAgentNames = new Set(successful.map((r) => r.agent));

  for (const agent of toInstall) {
    if (successfulAgentNames.has(agent.name)) {
      try {
        const computedHash = await computeAgentFolderHash(agent.path);
        await addAgentToLocalLock(
          agent.name,
          {
            source: agent.packageName,
            sourceType: 'node_modules',
            computedHash,
          },
          cwd
        );
      } catch {
        // Don't fail sync if lock file update fails
      }
    }
  }

  // 7. Display results
  console.log();

  if (successful.length > 0) {
    const byAgent = new Map<string, typeof results>();
    for (const r of successful) {
      const agentResults = byAgent.get(r.agent) || [];
      agentResults.push(r);
      byAgent.set(r.agent, agentResults);
    }

    const resultLines: string[] = [];
    for (const [agentName, agentResults] of byAgent) {
      const firstResult = agentResults[0]!;
      const pkg = toInstall.find((s) => s.name === agentName)?.packageName;
      if (firstResult.canonicalPath) {
        const shortPath = shortenPath(firstResult.canonicalPath, cwd);
        resultLines.push(`${pc.green('✓')} ${agentName} ${pc.dim(`← ${pkg}`)}`);
        resultLines.push(`  ${pc.dim(shortPath)}`);
      } else {
        resultLines.push(`${pc.green('✓')} ${agentName} ${pc.dim(`← ${pkg}`)}`);
      }
    }

    const agentCount = byAgent.size;
    const title = pc.green(`Synced ${agentCount} agent${agentCount !== 1 ? 's' : ''}`);
    p.note(resultLines.join('\n'), title);
  }

  if (failed.length > 0) {
    console.log();
    p.log.error(pc.red(`Failed to install ${failed.length}`));
    for (const r of failed) {
      p.log.message(`  ${pc.red('✗')} ${r.agent} → ${r.target}: ${pc.dim(r.error)}`);
    }
  }

  // Track telemetry
  track({
    event: 'experimental_sync',
    agentCount: String(toInstall.length),
    successCount: String(successfulAgentNames.size),
    targets: targetAgents.join(','),
  });

  console.log();
  p.outro(
    pc.green('Done!') + pc.dim('  Review agents before use; they run with full agent permissions.')
  );
}

export function parseSyncOptions(args: string[]): { options: SyncOptions } {
  const options: SyncOptions = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '-y' || arg === '--yes') {
      options.yes = true;
    } else if (arg === '-f' || arg === '--force') {
      options.force = true;
    } else if (arg === '-t' || arg === '--target') {
      options.target = options.target || [];
      i++;
      let nextArg = args[i];
      while (i < args.length && nextArg && !nextArg.startsWith('-')) {
        options.target.push(nextArg);
        i++;
        nextArg = args[i];
      }
      i--;
    }
  }

  return { options };
}
