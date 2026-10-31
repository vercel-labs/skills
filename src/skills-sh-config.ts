import { readFile } from 'fs/promises';
import { join, posix } from 'path';

/**
 * Repo-level config file that describes a repo's skills to skills.sh.
 * The CLI reads its optional `paths` field to find extra skill containers.
 */
export const SKILLS_SH_CONFIG_FILE = 'skills.sh.json';

/**
 * Parse the `paths` field of a skills.sh.json file into normalized,
 * repo-relative POSIX paths (e.g. "./tools/skills/" -> "tools/skills").
 *
 * Entries follow the same rules as plugin manifest paths: they must start
 * with './' and stay inside the repo. Entries pointing at the repo root are
 * dropped because the root is already searched. Invalid JSON, a missing
 * field, or invalid entries are ignored so discovery behaves as if the file
 * didn't exist.
 */
export function parseSkillsShPaths(content: string): string[] {
  let config: unknown;
  try {
    config = JSON.parse(content);
  } catch {
    return [];
  }

  if (typeof config !== 'object' || config === null || Array.isArray(config)) return [];
  const paths = (config as { paths?: unknown }).paths;
  if (!Array.isArray(paths)) return [];

  const result: string[] = [];
  for (const entry of paths) {
    if (typeof entry !== 'string' || !entry.startsWith('./')) continue;
    // Backslashes are not separators on POSIX, so reject them instead of
    // letting Windows treat "./a\\..\\.." as a traversal.
    if (entry.includes('\\')) continue;

    const normalized = posix.normalize(entry).replace(/\/+$/, '');
    if (normalized === '.' || normalized === '' || normalized === '..') continue;
    if (normalized.startsWith('../') || posix.isAbsolute(normalized)) continue;

    if (!result.includes(normalized)) result.push(normalized);
  }
  return result;
}

/**
 * Read skills.sh.json from `basePath` and return the absolute skill
 * container directories it declares. Returns [] when the file is missing
 * or invalid.
 */
export async function getSkillsShSearchDirs(basePath: string): Promise<string[]> {
  let content: string;
  try {
    content = await readFile(join(basePath, SKILLS_SH_CONFIG_FILE), 'utf-8');
  } catch {
    return [];
  }
  return parseSkillsShPaths(content).map((path) => join(basePath, path));
}
