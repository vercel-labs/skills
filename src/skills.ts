import { readdir, readFile, stat } from 'fs/promises';
import { join, basename, dirname, resolve } from 'path';
import matter from 'gray-matter';
import type { Skill } from './types.ts';
import { getPluginSkillPaths } from './plugin-manifest.ts';
import { sanitizeName } from './sanitize.ts';

const SKIP_DIRS = ['node_modules', '.git', 'dist', 'build', '__pycache__'];

/**
 * Check if internal skills should be installed.
 * Internal skills are hidden by default unless INSTALL_INTERNAL_SKILLS=1 is set.
 */
export function shouldInstallInternalSkills(): boolean {
  const envValue = process.env.INSTALL_INTERNAL_SKILLS;
  return envValue === '1' || envValue === 'true';
}

async function hasSkillMd(dir: string): Promise<boolean> {
  try {
    const skillPath = join(dir, 'SKILL.md');
    const stats = await stat(skillPath);
    return stats.isFile();
  } catch {
    return false;
  }
}

export async function parseSkillMd(
  skillMdPath: string,
  options?: { includeInternal?: boolean; basePath?: string }
): Promise<Skill | null> {
  try {
    const content = await readFile(skillMdPath, 'utf-8');
    const { data } = matter(content);

    if (!data.name || !data.description) {
      return null;
    }

    // Ensure name and description are strings (YAML can parse numbers, booleans, etc.)
    if (typeof data.name !== 'string' || typeof data.description !== 'string') {
      return null;
    }

    // Skip internal skills unless:
    // 1. INSTALL_INTERNAL_SKILLS=1 is set, OR
    // 2. includeInternal option is true (e.g., when user explicitly requests a skill)
    const isInternal = data.metadata?.internal === true;
    if (isInternal && !shouldInstallInternalSkills() && !options?.includeInternal) {
      return null;
    }

    // Validate name-directory binding to prevent namespace squatting.
    // Only applies when basePath is provided (i.e., called from discoverSkills).
    // Skip for root-level SKILL.md (where dirname is a temp clone directory).
    if (options?.basePath) {
      const dirName = basename(dirname(skillMdPath));
      const isRootSkill = resolve(dirname(skillMdPath)) === resolve(options.basePath);

      if (!isRootSkill && sanitizeName(data.name) !== sanitizeName(dirName)) {
        console.warn(
          `[skills] Warning: Skill at "${skillMdPath}" claims name "${data.name}" ` +
            `but is in directory "${dirName}". Using directory name to prevent namespace squatting.`
        );
        data.name = dirName;
      }
    }

    return {
      name: data.name,
      description: data.description,
      path: dirname(skillMdPath),
      rawContent: content,
      metadata: data.metadata,
    };
  } catch {
    return null;
  }
}

async function findSkillDirs(dir: string, depth = 0, maxDepth = 5): Promise<string[]> {
  if (depth > maxDepth) return [];

  try {
    const [hasSkill, entries] = await Promise.all([
      hasSkillMd(dir),
      readdir(dir, { withFileTypes: true }).catch(() => []),
    ]);

    const currentDir = hasSkill ? [dir] : [];

    // Search subdirectories in parallel
    const subDirResults = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory() && !SKIP_DIRS.includes(entry.name))
        .map((entry) => findSkillDirs(join(dir, entry.name), depth + 1, maxDepth))
    );

    return [...currentDir, ...subDirResults.flat()];
  } catch {
    return [];
  }
}

export interface DiscoverSkillsOptions {
  /** Include internal skills (e.g., when user explicitly requests a skill by name) */
  includeInternal?: boolean;
  /** Search all subdirectories even when a root SKILL.md exists */
  fullDepth?: boolean;
}

export async function discoverSkills(
  basePath: string,
  subpath?: string,
  options?: DiscoverSkillsOptions
): Promise<Skill[]> {
  const skills: Skill[] = [];
  const seenNames = new Map<string, string>(); // name → path (for duplicate warnings)
  const searchPath = subpath ? join(basePath, subpath) : basePath;
  const parseOptions = { ...options, basePath: searchPath };

  // If pointing directly at a skill, add it (and return early unless fullDepth is set)
  if (await hasSkillMd(searchPath)) {
    const skill = await parseSkillMd(join(searchPath, 'SKILL.md'), parseOptions);
    if (skill) {
      skills.push(skill);
      seenNames.set(skill.name, skill.path);
      // Only return early if fullDepth is not set
      if (!options?.fullDepth) {
        return skills;
      }
    }
  }

  // Search common skill locations first
  const prioritySearchDirs = [
    searchPath,
    join(searchPath, 'skills'),
    join(searchPath, 'skills/.curated'),
    join(searchPath, 'skills/.experimental'),
    join(searchPath, 'skills/.system'),
    join(searchPath, '.agent/skills'),
    join(searchPath, '.agents/skills'),
    join(searchPath, '.claude/skills'),
    join(searchPath, '.cline/skills'),
    join(searchPath, '.codebuddy/skills'),
    join(searchPath, '.codex/skills'),
    join(searchPath, '.commandcode/skills'),
    join(searchPath, '.continue/skills'),
    join(searchPath, '.cursor/skills'),
    join(searchPath, '.github/skills'),
    join(searchPath, '.goose/skills'),
    join(searchPath, '.iflow/skills'),
    join(searchPath, '.junie/skills'),
    join(searchPath, '.kilocode/skills'),
    join(searchPath, '.kiro/skills'),
    join(searchPath, '.mux/skills'),
    join(searchPath, '.neovate/skills'),
    join(searchPath, '.opencode/skills'),
    join(searchPath, '.openhands/skills'),
    join(searchPath, '.pi/skills'),
    join(searchPath, '.qoder/skills'),
    join(searchPath, '.roo/skills'),
    join(searchPath, '.trae/skills'),
    join(searchPath, '.windsurf/skills'),
    join(searchPath, '.zencoder/skills'),
  ];

  // Add skill paths declared in plugin manifests
  prioritySearchDirs.push(...(await getPluginSkillPaths(searchPath)));

  for (const dir of prioritySearchDirs) {
    try {
      const entries = await readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const skillDir = join(dir, entry.name);
          if (await hasSkillMd(skillDir)) {
            const skill = await parseSkillMd(join(skillDir, 'SKILL.md'), parseOptions);
            if (skill) {
              if (seenNames.has(skill.name)) {
                console.warn(
                  `[skills] Warning: Duplicate skill name "${skill.name}".\n` +
                    `  Accepted: ${seenNames.get(skill.name)}\n` +
                    `  Skipped:  ${skill.path}`
                );
              } else {
                skills.push(skill);
                seenNames.set(skill.name, skill.path);
              }
            }
          }
        }
      }
    } catch {
      // Directory doesn't exist
    }
  }

  // Fall back to recursive search if nothing found, or if fullDepth is set
  if (skills.length === 0 || options?.fullDepth) {
    const allSkillDirs = await findSkillDirs(searchPath);

    for (const skillDir of allSkillDirs) {
      const skill = await parseSkillMd(join(skillDir, 'SKILL.md'), parseOptions);
      if (skill) {
        if (seenNames.has(skill.name)) {
          console.warn(
            `[skills] Warning: Duplicate skill name "${skill.name}".\n` +
              `  Accepted: ${seenNames.get(skill.name)}\n` +
              `  Skipped:  ${skill.path}`
          );
        } else {
          skills.push(skill);
          seenNames.set(skill.name, skill.path);
        }
      }
    }
  }

  return skills;
}

export function getSkillDisplayName(skill: Skill): string {
  return skill.name || basename(skill.path);
}

/**
 * Filter skills based on user input (case-insensitive direct matching).
 * Multi-word skill names must be quoted on the command line.
 * When multiple skills match, prefer those whose directory name matches the filter
 * (defense-in-depth against namespace squatting).
 */
export function filterSkills(skills: Skill[], inputNames: string[]): Skill[] {
  const normalizedInputs = inputNames.map((n) => n.toLowerCase());

  const matches = skills.filter((skill) => {
    const name = skill.name.toLowerCase();
    const displayName = getSkillDisplayName(skill).toLowerCase();

    return normalizedInputs.some((input) => input === name || input === displayName);
  });

  // When multiple skills match, prefer those whose directory name matches the filter
  if (matches.length > 1) {
    const dirMatches = matches.filter((skill) => {
      const dirName = sanitizeName(basename(skill.path));
      return normalizedInputs.some((input) => sanitizeName(input) === dirName);
    });
    if (dirMatches.length > 0) {
      return dirMatches;
    }
  }

  return matches;
}
