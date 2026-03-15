import * as p from '@clack/prompts';
import pc from 'picocolors';
import { lstat, rm, symlink, cp, readdir, mkdir } from 'fs/promises';
import { join, relative } from 'path';
import { platform } from 'os';
import { agents } from './agents.ts';
import {
  readSkillLock,
  setSkillEnabled,
  isSkillEnabled,
  type SkillLockEntry,
} from './skill-lock.ts';
import type { AgentType } from './types.ts';
import { getInstallPath, getCanonicalPath, sanitizeName } from './installer.ts';

export interface ToggleOptions {
  global?: boolean;
}

export function parseToggleOptions(args: string[]): { skills: string[]; options: ToggleOptions } {
  const options: ToggleOptions = {};
  const skills: string[] = [];

  for (const arg of args) {
    if (arg === '-g' || arg === '--global') {
      options.global = true;
    } else if (arg && !arg.startsWith('-')) {
      skills.push(arg);
    }
  }

  return { skills, options };
}

/**
 * Remove a skill from all agent directories without touching the canonical path.
 */
async function removeFromAgentDirs(
  skillName: string,
  isGlobal: boolean,
  cwd: string
): Promise<void> {
  const canonicalPath = getCanonicalPath(skillName, { global: isGlobal, cwd });

  for (const agentKey of Object.keys(agents) as AgentType[]) {
    const agent = agents[agentKey];
    const skillPath = getInstallPath(skillName, agentKey, { global: isGlobal, cwd });

    const pathsToCleanup = new Set([skillPath]);
    const sanitized = sanitizeName(skillName);
    if (isGlobal && agent.globalSkillsDir) {
      pathsToCleanup.add(join(agent.globalSkillsDir, sanitized));
    } else {
      pathsToCleanup.add(join(cwd, agent.skillsDir, sanitized));
    }

    for (const pathToCleanup of pathsToCleanup) {
      if (pathToCleanup === canonicalPath) continue;

      try {
        const stats = await lstat(pathToCleanup).catch(() => null);
        if (stats) {
          await rm(pathToCleanup, { recursive: true, force: true });
        }
      } catch {
        // Skip failures for individual agent cleanup
      }
    }
  }
}

/**
 * Restore a skill's symlinks/copies to agent directories from the canonical path.
 */
async function restoreToAgentDirs(
  skillName: string,
  _entry: SkillLockEntry,
  isGlobal: boolean,
  cwd: string
): Promise<void> {
  const canonicalPath = getCanonicalPath(skillName, { global: isGlobal, cwd });
  const canonicalExists = await lstat(canonicalPath).catch(() => null);
  if (!canonicalExists) {
    throw new Error(`Canonical skill path does not exist: ${canonicalPath}`);
  }

  // Detect which agents are installed and create symlinks to them
  for (const agentKey of Object.keys(agents) as AgentType[]) {
    const agent = agents[agentKey];
    const skillPath = getInstallPath(skillName, agentKey, { global: isGlobal, cwd });

    // Skip if this IS the canonical path (no symlink needed)
    if (skillPath === canonicalPath) continue;

    // Check if the target directory exists
    const targetDir = isGlobal ? agent.globalSkillsDir : join(cwd, agent.skillsDir);
    if (!targetDir) continue;

    const targetDirExists = await lstat(targetDir).catch(() => null);
    if (!targetDirExists) continue;

    try {
      // Create parent dir if needed
      await mkdir(join(targetDir), { recursive: true });

      // Create a relative symlink
      const linkPath = join(targetDir, sanitizeName(skillName));
      const relTarget = relative(targetDir, canonicalPath);
      const symlinkType = platform() === 'win32' ? 'junction' : undefined;
      await symlink(relTarget, linkPath, symlinkType);
    } catch {
      // If symlink fails, try copy
      try {
        const destPath = join(targetDir, sanitizeName(skillName));
        await cp(canonicalPath, destPath, { recursive: true });
      } catch {
        // Skip this agent
      }
    }
  }
}

export async function runDisable(args: string[]): Promise<void> {
  const { skills, options } = parseToggleOptions(args);
  const isGlobal = options.global ?? true; // Default to global for disable
  const cwd = process.cwd();

  if (skills.length === 0) {
    // Interactive selection from enabled skills
    const lock = await readSkillLock();
    const enabledSkills = Object.entries(lock.skills)
      .filter(([_, entry]) => isSkillEnabled(entry))
      .map(([name]) => name)
      .sort();

    if (enabledSkills.length === 0) {
      p.log.info(pc.dim('No enabled skills found.'));
      return;
    }

    const selected = await p.multiselect({
      message: `Select skills to disable ${pc.dim('(space to toggle)')}`,
      options: enabledSkills.map((name) => ({ value: name, label: name })),
      required: true,
    });

    if (p.isCancel(selected)) {
      p.cancel('Cancelled');
      return;
    }

    skills.push(...(selected as string[]));
  }

  const spinner = p.spinner();
  spinner.start('Disabling skills...');

  let successCount = 0;

  for (const skillName of skills) {
    const entry = await setSkillEnabled(skillName, false);
    if (!entry) {
      p.log.warn(`Skill not found in lock file: ${pc.cyan(skillName)}`);
      continue;
    }

    await removeFromAgentDirs(skillName, isGlobal, cwd);
    successCount++;
  }

  spinner.stop(`Disabled ${successCount} skill(s)`);

  if (successCount > 0) {
    p.log.success(pc.green(`Disabled ${successCount} skill(s). Files kept in canonical location.`));
    p.log.info(pc.dim(`Re-enable with: npx skills enable <name>`));
  }
}

export async function runEnable(args: string[]): Promise<void> {
  const { skills, options } = parseToggleOptions(args);
  const isGlobal = options.global ?? true; // Default to global for enable
  const cwd = process.cwd();

  if (skills.length === 0) {
    // Interactive selection from disabled skills
    const lock = await readSkillLock();
    const disabledSkills = Object.entries(lock.skills)
      .filter(([_, entry]) => !isSkillEnabled(entry))
      .map(([name]) => name)
      .sort();

    if (disabledSkills.length === 0) {
      p.log.info(pc.dim('No disabled skills found.'));
      return;
    }

    const selected = await p.multiselect({
      message: `Select skills to enable ${pc.dim('(space to toggle)')}`,
      options: disabledSkills.map((name) => ({ value: name, label: name })),
      required: true,
    });

    if (p.isCancel(selected)) {
      p.cancel('Cancelled');
      return;
    }

    skills.push(...(selected as string[]));
  }

  const spinner = p.spinner();
  spinner.start('Enabling skills...');

  let successCount = 0;

  for (const skillName of skills) {
    const lock = await readSkillLock();
    const entry = lock.skills[skillName];
    if (!entry) {
      p.log.warn(`Skill not found in lock file: ${pc.cyan(skillName)}`);
      continue;
    }

    try {
      await restoreToAgentDirs(skillName, entry, isGlobal, cwd);
    } catch (err) {
      p.log.warn(
        `Could not restore ${pc.cyan(skillName)}: ${err instanceof Error ? err.message : String(err)}`
      );
      continue;
    }

    await setSkillEnabled(skillName, true);
    successCount++;
  }

  spinner.stop(`Enabled ${successCount} skill(s)`);

  if (successCount > 0) {
    p.log.success(pc.green(`Enabled ${successCount} skill(s). Symlinks restored.`));
  }
}
