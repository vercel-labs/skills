import * as p from '@clack/prompts';
import pc from 'picocolors';
import { readLocalLock } from './local-lock.ts';
import { runAdd } from './add.ts';
import { runSync, parseSyncOptions } from './sync.ts';
import { getUniversalTargets } from './targets.ts';

/**
 * Install all agents from the local agents-lock.json.
 * Groups agents by source and calls `runAdd` for each group.
 *
 * Only installs to .agents/agents/ (universal agents) -- the canonical
 * project-level location. Does not install to agent-specific directories.
 *
 * node_modules agents are handled via experimental_sync.
 */
export async function runInstallFromLock(args: string[]): Promise<void> {
  const cwd = process.cwd();
  const lock = await readLocalLock(cwd);
  const skillEntries = Object.entries(lock.agents);

  if (skillEntries.length === 0) {
    p.log.warn('No project agents found in agents-lock.json');
    p.log.info(
      `Add project-level agents with ${pc.cyan('npx agents add <package>')} (without ${pc.cyan('-g')})`
    );
    return;
  }

  // Only install to .agents/agents/ (universal agents)
  const universalAgentNames = getUniversalTargets();

  // Separate node_modules agents from remote agents
  const nodeModuleSkills: string[] = [];
  const bySource = new Map<string, { sourceType: string; agents: string[] }>();

  for (const [agentName, entry] of skillEntries) {
    if (entry.sourceType === 'node_modules') {
      nodeModuleSkills.push(agentName);
      continue;
    }

    const existing = bySource.get(entry.source);
    if (existing) {
      existing.agents.push(agentName);
    } else {
      bySource.set(entry.source, {
        sourceType: entry.sourceType,
        agents: [agentName],
      });
    }
  }

  const remoteCount = skillEntries.length - nodeModuleSkills.length;
  if (remoteCount > 0) {
    p.log.info(
      `Restoring ${pc.cyan(String(remoteCount))} agent${remoteCount !== 1 ? 's' : ''} from agents-lock.json into ${pc.dim('.agents/agents/')}`
    );
  }

  // Install remote agents grouped by source
  for (const [source, { agents }] of bySource) {
    try {
      await runAdd([source], {
        agent: agents,
        target: universalAgentNames,
        yes: true,
      });
    } catch (error) {
      p.log.error(
        `Failed to install from ${pc.cyan(source)}: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  // Handle node_modules agents via sync
  if (nodeModuleSkills.length > 0) {
    p.log.info(
      `${pc.cyan(String(nodeModuleSkills.length))} agent${nodeModuleSkills.length !== 1 ? 's' : ''} from node_modules`
    );
    try {
      const { options: syncOptions } = parseSyncOptions(args);
      await runSync(args, { ...syncOptions, yes: true, target: universalAgentNames });
    } catch (error) {
      p.log.error(
        `Failed to sync node_modules agents: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }
}
