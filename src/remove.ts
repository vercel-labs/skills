import * as p from '@clack/prompts';
import pc from 'picocolors';
import { readdir, rm, lstat } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import { agents, detectInstalledAgents } from './agents.ts';
import { track } from './telemetry.ts';
import { removeSkillFromLock, getSkillFromLock, readSkillLock } from './skill-lock.ts';
import type { AgentType } from './types.ts';
import { getInstallPath, getCanonicalPath, getCanonicalSkillsDir } from './installer.ts';

/** Shortens a path for display: replaces homedir with ~ and cwd with . */
function shortenPath(fullPath: string, cwd: string): string {
  const home = homedir();
  if (fullPath.startsWith(home)) {
    return fullPath.replace(home, '~');
  }
  if (fullPath.startsWith(cwd)) {
    return '.' + fullPath.slice(cwd.length);
  }
  return fullPath;
}

export interface RemoveOptions {
  global?: boolean;
  agent?: string[];
  yes?: boolean;
  all?: boolean;
}

export async function removeCommand(skillNames: string[], options: RemoveOptions) {
  const isGlobal = options.global ?? false;
  const cwd = process.cwd();

  const spinner = p.spinner();

  spinner.start('Scanning for installed skills...');
  const skillNamesSet = new Set<string>();

  // First, read from skill-lock.json to get registered skills
  try {
    const lock = await readSkillLock();
    if (lock && lock.skills) {
      for (const skillName of Object.keys(lock.skills)) {
        skillNamesSet.add(skillName);
      }
    }
  } catch (err) {
    // Ignore errors if lock file doesn't exist or is invalid
    // p.log.debug is not available, so we silently ignore this error
  }

  const scanDir = async (dir: string, prefix = '', recursive = true) => {
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const entryPath = join(dir, entry.name);
          const fullName = prefix ? `${prefix}/${entry.name}` : entry.name;

          // Check if this is a skill directory (contains SKILL.md)
          try {
            await lstat(join(entryPath, 'SKILL.md'));
            // This is a skill directory, add it
            skillNamesSet.add(fullName);
          } catch {
            // If recursive mode is enabled, this might be a namespace directory
            if (recursive) {
              await scanDir(entryPath, fullName, recursive);
            }
          }
        }
      }
    } catch (err) {
      if (err instanceof Error && (err as { code?: string }).code !== 'ENOENT') {
        p.log.warn(`Could not scan directory ${dir}: ${err.message}`);
      }
    }
  };

  if (isGlobal) {
    // For canonical skills directory, scan recursively for namespace support
    await scanDir(getCanonicalSkillsDir(true, cwd));

    // For agent-specific directories, scan only top-level (no recursion needed)
    for (const agent of Object.values(agents)) {
      if (agent.globalSkillsDir !== undefined) {
        await scanDir(agent.globalSkillsDir, '', false);
      }
    }
  } else {
    // For canonical skills directory, scan recursively for namespace support
    await scanDir(getCanonicalSkillsDir(false, cwd));

    // For agent-specific directories, scan only top-level (no recursion needed)
    for (const agent of Object.values(agents)) {
      await scanDir(join(cwd, agent.skillsDir), '', false);
    }
  }

  // Deduplicate: prefer namespaced versions over bare skill names
  const bareToNamespaced = new Map<string, string>();
  for (const skill of skillNamesSet) {
    const lastSlashIndex = Math.max(skill.lastIndexOf('/'), skill.lastIndexOf('\\'));
    if (lastSlashIndex > 0) {
      const bareName = skill.slice(lastSlashIndex + 1);
      // Store namespaced version, preferring the one with namespace
      bareToNamespaced.set(bareName.toLowerCase(), skill);
    } else {
      // Only store bare name if no namespaced version exists
      if (!bareToNamespaced.has(skill.toLowerCase())) {
        bareToNamespaced.set(skill.toLowerCase(), skill);
      }
    }
  }

  const installedSkills = Array.from(bareToNamespaced.values()).sort();
  spinner.stop(`Found ${installedSkills.length} unique installed skill(s)`);

  if (installedSkills.length === 0) {
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
    selectedSkills = installedSkills;
  } else if (skillNames.length > 0) {
    selectedSkills = installedSkills.filter((s) =>
      skillNames.some((name) => {
        const sLower = s.toLowerCase();
        const nameLower = name.toLowerCase();

        // Try exact match first (including namespace)
        if (sLower === nameLower) {
          return true;
        }

        // Try matching the skill name part (after last slash)
        const lastSlashIndex = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'));
        const skillNameOnly =
          lastSlashIndex > 0 ? s.slice(lastSlashIndex + 1).toLowerCase() : sLower;

        return skillNameOnly === nameLower;
      })
    );

    if (selectedSkills.length === 0) {
      p.log.error(`No matching skills found for: ${skillNames.join(', ')}`);
      return;
    }
  } else {
    // Detect installed agents for display
    spinner.start('Detecting installed agents...');
    const detectedAgents = await detectInstalledAgents();
    spinner.stop(`Targeting ${detectedAgents.length} installed agent(s)`);

    // Pre-check which skills are installed in which agents
    const skillAgentMap = new Map<string, string[]>();
    for (const s of installedSkills) {
      const lastSlashIndex = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'));
      const hasNamespace = lastSlashIndex > 0;
      const skillName = hasNamespace ? s.slice(lastSlashIndex + 1) : s;
      const namespace = hasNamespace ? s.slice(0, lastSlashIndex) : null;

      const installedAgentNames: string[] = [];
      for (const agentKey of detectedAgents) {
        const agent = agents[agentKey];
        const agentSkillsDir = isGlobal ? agent.globalSkillsDir : join(cwd, agent.skillsDir);
        if (agentSkillsDir) {
          const skillPath = join(agentSkillsDir, hasNamespace ? namespace! : '', skillName);
          try {
            await lstat(skillPath);
            installedAgentNames.push(agent.displayName);
          } catch {
            // Skill not installed for this agent
          }
        }
      }
      skillAgentMap.set(s, installedAgentNames);
    }

    const choices = installedSkills.map((s) => {
      // Parse namespace for display (support both / and \ for cross-platform)
      const lastSlashIndex = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'));
      const hasNamespace = lastSlashIndex > 0;
      const skillName = hasNamespace ? s.slice(lastSlashIndex + 1) : s;
      const namespace = hasNamespace ? s.slice(0, lastSlashIndex) : null;

      // Build canonical path for display
      const canonicalPath = getCanonicalPath(skillName, {
        global: isGlobal,
        cwd,
        namespace: namespace || undefined,
      });
      const shortPath = shortenPath(canonicalPath, cwd);
      const nsInfo = hasNamespace ? ` ${pc.dim(`[${namespace}]`)}` : '';

      const agentNames = skillAgentMap.get(s) || [];
      const agentInfo = agentNames.length > 0 ? `Agents: ${agentNames.join(', ')}` : 'not linked';

      return {
        value: s,
        label: `${pc.cyan(skillName)}${nsInfo} ${pc.dim(shortPath)}\n  ${pc.dim(agentInfo)}`,
      };
    });

    // Show header like list command
    const scopeLabel = isGlobal ? 'Global' : 'Project';
    console.log();
    p.log.step(`${scopeLabel} Skills`);

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
    spinner.start('Detecting installed agents...');
    targetAgents = await detectInstalledAgents();
    if (targetAgents.length === 0) {
      // Fallback to all agents if none detected, to ensure we can at least try to remove from defaults
      targetAgents = Object.keys(agents) as AgentType[];
    }
    spinner.stop(`Targeting ${targetAgents.length} installed agent(s)`);
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
      // Parse namespace from skill name (format: "namespace/skill-name")
      const [namespace, actualSkillName] = skillName.includes('/')
        ? skillName.split('/', 2)
        : [undefined, skillName];

      for (const agentKey of targetAgents) {
        const agent = agents[agentKey];
        const skillPath = getInstallPath(actualSkillName, agentKey, {
          global: isGlobal,
          cwd,
          namespace,
        });

        try {
          const stats = await lstat(skillPath).catch(() => null);
          if (stats) {
            await rm(skillPath, { recursive: true, force: true });
          }
        } catch (err) {
          p.log.warn(
            `Could not remove skill from ${agent.displayName}: ${
              err instanceof Error ? err.message : String(err)
            }`
          );
        }
      }

      const canonicalPath = getCanonicalPath(actualSkillName, {
        global: isGlobal,
        cwd,
        namespace,
      });
      await rm(canonicalPath, { recursive: true, force: true });

      const lockEntry = isGlobal ? await getSkillFromLock(skillName) : null;
      const effectiveSource = lockEntry?.source || 'local';
      const effectiveSourceType = lockEntry?.sourceType || 'local';

      if (isGlobal) {
        await removeSkillFromLock(skillName);
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
