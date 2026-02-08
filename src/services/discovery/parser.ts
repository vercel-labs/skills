import { readdir, readFile, stat } from 'fs/promises';
import { join, dirname } from 'path';
import matter from 'gray-matter';
import type { Skill, CognitiveType } from '../../core/types.ts';
import { COGNITIVE_FILE_NAMES } from '../../core/constants.ts';

/**
 * Check if internal skills should be installed.
 * Internal skills are hidden by default unless INSTALL_INTERNAL_SKILLS=1 is set.
 */
export function shouldInstallInternalSkills(): boolean {
  const envValue = process.env.INSTALL_INTERNAL_SKILLS;
  return envValue === '1' || envValue === 'true';
}

// ---------------------------------------------------------------------------
// Generalized cognitive discovery helpers
// ---------------------------------------------------------------------------

/**
 * Check if a directory contains a cognitive file (SKILL.md, AGENT.md, or PROMPT.md).
 */
export async function hasCognitiveMd(dir: string, cognitiveType: CognitiveType): Promise<boolean> {
  try {
    const fileName = COGNITIVE_FILE_NAMES[cognitiveType];
    const filePath = join(dir, fileName);
    const stats = await stat(filePath);
    return stats.isFile();
  } catch {
    return false;
  }
}

/**
 * Parse a cognitive markdown file (SKILL.md, AGENT.md, or PROMPT.md) and return
 * a Skill object with the appropriate `cognitiveType` set.
 */
export async function parseCognitiveMd(
  mdPath: string,
  cognitiveType: CognitiveType,
  options?: { includeInternal?: boolean }
): Promise<Skill | null> {
  try {
    const content = await readFile(mdPath, 'utf-8');
    const { data } = matter(content);

    if (!data.name || !data.description) {
      return null;
    }

    // Skip internal entries unless:
    // 1. INSTALL_INTERNAL_SKILLS=1 is set, OR
    // 2. includeInternal option is true (e.g., when user explicitly requests by name)
    const isInternal = data.metadata?.internal === true;
    if (isInternal && !shouldInstallInternalSkills() && !options?.includeInternal) {
      return null;
    }

    return {
      name: data.name,
      description: data.description,
      path: dirname(mdPath),
      rawContent: content,
      metadata: data.metadata,
      cognitiveType,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Backward-compatible wrappers
// ---------------------------------------------------------------------------

/**
 * Check if a directory contains a SKILL.md file.
 * @deprecated Use `hasCognitiveMd(dir, 'skill')` instead.
 */
async function hasSkillMd(dir: string): Promise<boolean> {
  return hasCognitiveMd(dir, 'skill');
}

/**
 * Parse a SKILL.md file and return a Skill object.
 * @deprecated Use `parseCognitiveMd(path, 'skill', options)` instead.
 */
export async function parseSkillMd(
  skillMdPath: string,
  options?: { includeInternal?: boolean }
): Promise<Skill | null> {
  return parseCognitiveMd(skillMdPath, 'skill', options);
}

/**
 * Recursively find directories containing a SKILL.md file.
 * @deprecated Use `findCognitiveDirs(dir, ['skill'])` from scanner instead.
 */
async function findSkillDirs(dir: string, depth = 0, maxDepth = 5): Promise<string[]> {
  // Inline implementation to avoid circular dependency with scanner.ts
  if (depth > maxDepth) return [];

  try {
    const found = await hasCognitiveMd(dir, 'skill');
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);

    const currentDir = found ? [dir] : [];

    const SKIP_DIRS = ['node_modules', '.git', 'dist', 'build', '__pycache__'];
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
