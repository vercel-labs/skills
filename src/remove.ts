import * as p from '@clack/prompts';
import pc from 'picocolors';
import { readdir, rm, lstat } from 'fs/promises';
import { join } from 'path';
import { agents, detectInstalledAgents, getEveSubagents } from './agents.ts';
import { track } from './telemetry.ts';
import { detectAgent } from './detect-agent.ts';
import { removeSkillFromLock, getSkillFromLock, readSkillLock } from './skill-lock.ts';
import { readLocalLock, removeSkillFromLocalLock } from './local-lock.ts';
import type { AgentType } from './types.ts';
import {
  getInstallPath,
  getCanonicalPath,
  getCanonicalSkillsDir,
  getEveSubagentSkillsDir,
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
  lockKeys: string[] = []
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
    if (hit) matched.add(hit);
  }
  return Array.from(matched);
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

  const isGlobal = options.global ?? false;
  const cwd = process.cwd();

  const spinner = p.spinner();

  spinner.start('Scanning for installed skills…');
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

  const installedSkills = Array.from(skillNamesSet).sort();
  spinner.stop(`Found ${installedSkills.length} unique installed skill(s)`);

  // Read lock file keys up front. These are needed both to decide whether there is
  // anything to remove (a skill may be missing from disk but still leave a stale lock
  // entry) and to clean up those stale entries below.
  const lockSkillsKeys = isGlobal
    ? Object.keys((await readSkillLock()).skills)
    : Object.keys((await readLocalLock(cwd)).skills);

  const requestedSkills = options.all ? [...installedSkills, ...lockSkillsKeys] : skillNames;
  const resolvedRequestedSkills =
    options.all || skillNames.length > 0
      ? resolveSkillsToRemove(requestedSkills, installedSkills, lockSkillsKeys)
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
      p.log.error(`Invalid agents: ${invalidAgents.join(', ')}`);
      p.log.info(`Valid agents: ${validAgents.join(', ')}`);
      process.exit(1);
    }
  }

  let selectedSkills: string[] = [];

  if (options.all) {
    selectedSkills = resolvedRequestedSkills;
  } else if (skillNames.length > 0) {
    selectedSkills = resolvedRequestedSkills;

    if (selectedSkills.length === 0) {
      p.log.error(`No matching skills found for: ${skillNames.join(', ')}`);
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

  const results: {
    skill: string;
    success: boolean;
    source?: string;
    sourceType?: string;
    error?: string;
  }[] = [];

  for (const skillName of selectedSkills) {
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
            if (stats) {
              await rm(pathToCleanup, { recursive: true, force: true });
            }
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

      if (isGlobal) {
        const lockEntry = await getSkillFromLock(skillName);
        effectiveSource = lockEntry?.source || 'local';
        effectiveSourceType = lockEntry?.sourceType || 'local';
        await removeSkillFromLock(skillName);
      } else {
        const localLock = await readLocalLock(cwd);
        const lockEntry = localLock.skills[skillName];
        effectiveSource = lockEntry?.source || 'local';
        effectiveSourceType = lockEntry?.sourceType || 'local';
        await removeSkillFromLocalLock(skillName, cwd);
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
