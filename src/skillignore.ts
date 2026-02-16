/**
 * .skillignore support for skill maintainers.
 *
 * A `.skillignore` file at the repo root lets maintainers hide internal skills
 * from public discovery (e.g., validation scripts, prompt evals, scaffolding).
 *
 * Format (one pattern per line):
 *   # comment
 *   internal-tool        # exact match
 *   test-*               # trailing wildcard
 */

import { readFile } from 'fs/promises';
import { join } from 'path';

/**
 * Parse a .skillignore file into an array of patterns.
 * Blank lines and lines starting with # are ignored.
 */
export function parseSkillIgnore(content: string): string[] {
  return content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
}

/**
 * Check whether a skill name matches any of the ignore patterns.
 * Supports exact matches and trailing-wildcard patterns (e.g. "internal-*").
 */
export function isSkillIgnored(skillName: string, patterns: string[]): boolean {
  return patterns.some((pattern) => {
    if (pattern.endsWith('*')) {
      return skillName.startsWith(pattern.slice(0, -1));
    }
    return skillName === pattern;
  });
}

/**
 * Try to read and parse a .skillignore file from the given directory.
 * Returns an empty array if the file doesn't exist.
 */
export async function loadSkillIgnorePatterns(dir: string): Promise<string[]> {
  try {
    const content = await readFile(join(dir, '.skillignore'), 'utf-8');
    return parseSkillIgnore(content);
  } catch {
    return [];
  }
}
