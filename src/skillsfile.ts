import { readFile, rm, access } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import * as p from '@clack/prompts';
import chalk from 'chalk';
import { runAdd } from './add.js';
import { readSkillLock, removeSkillFromLock } from './skill-lock.js';
import { agents } from './agents.js';
import type { InstallFromFileOptions } from './types.js';

const SKILLS_FILENAME = '.skills';
const AGENTS_DIR = '.agents';
const SKILLS_SUBDIR = 'skills';

export interface SkillsFileConfig {
  /** Path to the .skills file found */
  path: string;
  /** true if ~/.skills, false if ./.skills */
  isGlobal: boolean;
  /** List of skill sources parsed from the file */
  sources: string[];
}

/**
 * Find the .skills file in the current directory or home directory.
 * Current directory takes precedence over home directory.
 * @returns The config if found, null otherwise
 */
export async function findSkillsFile(): Promise<SkillsFileConfig | null> {
  const cwd = process.cwd();
  const home = homedir();

  // Check current directory first (project-level)
  const localPath = join(cwd, SKILLS_FILENAME);
  try {
    await access(localPath);
    const sources = await parseSkillsFile(localPath);
    return {
      path: localPath,
      isGlobal: false,
      sources,
    };
  } catch {
    // Not found in current directory
  }

  // Check home directory (global)
  const globalPath = join(home, SKILLS_FILENAME);
  try {
    await access(globalPath);
    const sources = await parseSkillsFile(globalPath);
    return {
      path: globalPath,
      isGlobal: true,
      sources,
    };
  } catch {
    // Not found in home directory either
  }

  return null;
}

/**
 * Parse a .skills file and return the list of sources.
 * - Reads file line by line
 * - Trims whitespace
 * - Skips empty lines and lines starting with #
 * @param filePath Path to the .skills file
 * @returns Array of source strings
 */
export async function parseSkillsFile(filePath: string): Promise<string[]> {
  const content = await readFile(filePath, 'utf-8');
  const lines = content.split('\n');
  const sources: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip empty lines
    if (!trimmed) continue;

    // Skip comments
    if (trimmed.startsWith('#')) continue;

    sources.push(trimmed);
  }

  return sources;
}

/**
 * Get list of installed skill names from the canonical .agents/skills directory
 */
async function getInstalledSkillNames(isGlobal: boolean): Promise<string[]> {
  const { readdir, stat } = await import('fs/promises');
  const baseDir = isGlobal ? homedir() : process.cwd();
  const skillsDir = join(baseDir, AGENTS_DIR, SKILLS_SUBDIR);
  const skillNames: string[] = [];

  try {
    const entries = await readdir(skillsDir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory() || entry.isSymbolicLink()) {
        const skillMdPath = join(skillsDir, entry.name, 'SKILL.md');
        try {
          const stats = await stat(skillMdPath);
          if (stats.isFile()) {
            skillNames.push(entry.name);
          }
        } catch {
          // No SKILL.md, check if directory has content
          try {
            const contents = await readdir(join(skillsDir, entry.name));
            if (contents.length > 0) {
              skillNames.push(entry.name);
            }
          } catch {
            // Skip
          }
        }
      }
    }
  } catch {
    // Directory doesn't exist
  }

  return skillNames;
}

/**
 * Remove a skill from all agent directories and the canonical location
 */
async function removeSkill(skillName: string, isGlobal: boolean): Promise<boolean> {
  const baseDir = isGlobal ? homedir() : process.cwd();

  // Remove from canonical location
  const canonicalPath = join(baseDir, AGENTS_DIR, SKILLS_SUBDIR, skillName);
  try {
    await rm(canonicalPath, { recursive: true, force: true });
  } catch {
    // Ignore if doesn't exist
  }

  // Remove from each agent's skills directory
  for (const [agentKey, agentConfig] of Object.entries(agents)) {
    const agentSkillsDir = isGlobal ? agentConfig.globalSkillsDir : join(process.cwd(), agentConfig.skillsDir);
    const agentSkillPath = join(agentSkillsDir, skillName);

    try {
      await rm(agentSkillPath, { recursive: true, force: true });
    } catch {
      // Ignore if doesn't exist
    }
  }

  // Remove from lock file
  await removeSkillFromLock(skillName);

  return true;
}

/**
 * Extract skill names from sources for comparison with installed skills.
 * This is a heuristic - for GitHub sources it extracts from the path,
 * for URLs it tries to extract from the source identifier.
 */
function extractExpectedSkillNames(sources: string[], installedResults: Map<string, string[]>): Set<string> {
  const expected = new Set<string>();

  for (const source of sources) {
    // If we tracked what was installed from this source, use that
    const installed = installedResults.get(source);
    if (installed) {
      for (const name of installed) {
        expected.add(name);
      }
    }
  }

  return expected;
}

/**
 * Install skills from a .skills file
 */
export async function runInstallFromFile(options: InstallFromFileOptions = {}): Promise<void> {
  const spinner = p.spinner();

  spinner.start('Looking for .skills file...');
  const config = await findSkillsFile();

  if (!config) {
    spinner.stop(chalk.yellow('No .skills file found'));
    console.log();
    p.log.message(chalk.dim('Create a .skills file with one skill source per line:'));
    console.log();
    console.log(chalk.dim('  # .skills example'));
    console.log(chalk.dim('  vercel-labs/agent-skills'));
    console.log(chalk.dim('  owner/repo@specific-skill'));
    console.log(chalk.dim('  https://docs.example.com/skill.md'));
    console.log(chalk.dim('  ./local-path/to/skill'));
    console.log();
    p.log.message(chalk.dim(`Place in current directory (./.skills) for project-level or home directory (~/.skills) for global.`));
    console.log();
    return;
  }

  const scopeLabel = config.isGlobal ? 'global' : 'project';
  spinner.stop(`Found .skills file: ${chalk.cyan(config.path)} (${scopeLabel} scope)`);

  if (config.sources.length === 0) {
    console.log();
    p.log.warn('No skill sources found in .skills file');
    p.log.message(chalk.dim('Add skill sources (one per line) to install them.'));
    return;
  }

  console.log();
  p.log.info(`Found ${chalk.cyan(config.sources.length)} skill source${config.sources.length !== 1 ? 's' : ''} to install`);

  // Track installed skill names for sync functionality
  const installedSkillNames = new Map<string, string[]>();
  let successCount = 0;
  let failCount = 0;

  // Get initial list of installed skills before installing (for sync)
  const preInstalledSkills = options.sync ? await getInstalledSkillNames(config.isGlobal) : [];

  // Install each source
  for (const source of config.sources) {
    console.log();
    p.log.step(`Installing: ${chalk.cyan(source)}`);

    try {
      // Create options for this installation
      const installOptions: AddOptions = {
        ...options,
        global: config.isGlobal,
        yes: true, // Auto-confirm in file mode
      };

      // Run the add command for this source
      await runAdd([source], installOptions);
      successCount++;

      // Track the skill name - this is a heuristic
      // For GitHub repos with @skill syntax, extract the skill name
      const atIndex = source.indexOf('@');
      if (atIndex !== -1) {
        const skillPart = source.slice(atIndex + 1);
        if (!installedSkillNames.has(source)) {
          installedSkillNames.set(source, []);
        }
        installedSkillNames.get(source)!.push(skillPart);
      }
    } catch (error) {
      failCount++;
      p.log.error(`Failed to install ${chalk.cyan(source)}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  console.log();
  if (successCount > 0) {
    p.log.success(`Installed ${successCount} skill source${successCount !== 1 ? 's' : ''}`);
  }
  if (failCount > 0) {
    p.log.warn(`Failed to install ${failCount} skill source${failCount !== 1 ? 's' : ''}`);
  }

  // Handle --sync: remove skills not in .skills file
  if (options.sync) {
    console.log();
    spinner.start('Syncing installed skills...');

    // Get current list of installed skills after installation
    const postInstalledSkills = await getInstalledSkillNames(config.isGlobal);

    // Get skills from lock file to determine which ones came from the .skills file sources
    const lock = await readSkillLock();
    const lockedSkillNames = new Set(Object.keys(lock.skills));

    // Determine which skills should be kept based on sources in .skills file
    const sourcesSet = new Set(config.sources);
    const skillsToKeep = new Set<string>();

    for (const [skillName, entry] of Object.entries(lock.skills)) {
      // Check if this skill's source is in the .skills file
      if (sourcesSet.has(entry.source) || sourcesSet.has(entry.sourceUrl)) {
        skillsToKeep.add(skillName);
      }
      // Also check if source matches a pattern like owner/repo
      for (const source of sourcesSet) {
        if (entry.source.includes(source) || source.includes(entry.source)) {
          skillsToKeep.add(skillName);
        }
        // Handle @skill-name syntax
        const atIndex = source.indexOf('@');
        if (atIndex !== -1) {
          const skillPart = source.slice(atIndex + 1);
          if (skillName === skillPart || skillName.toLowerCase() === skillPart.toLowerCase()) {
            skillsToKeep.add(skillName);
          }
        }
      }
    }

    // Find skills to remove (installed but not in keep list)
    const skillsToRemove = postInstalledSkills.filter(
      name => lockedSkillNames.has(name) && !skillsToKeep.has(name)
    );

    if (skillsToRemove.length === 0) {
      spinner.stop('All skills in sync');
    } else {
      spinner.stop(`Found ${skillsToRemove.length} skill${skillsToRemove.length !== 1 ? 's' : ''} to remove`);

      for (const skillName of skillsToRemove) {
        p.log.info(`Removing: ${chalk.yellow(skillName)}`);
        await removeSkill(skillName, config.isGlobal);
      }

      p.log.success(`Removed ${skillsToRemove.length} skill${skillsToRemove.length !== 1 ? 's' : ''} not in .skills file`);
    }
  }

  console.log();
  p.outro(chalk.green('Done!'));
}
