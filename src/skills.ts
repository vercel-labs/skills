import { readdir, readFile, stat } from 'fs/promises';
import { join, basename, dirname } from 'path';
import matter from 'gray-matter';
import type { Skill, CognitiveType } from './types.ts';
import { COGNITIVE_FILE_NAMES, COGNITIVE_SUBDIRS } from './constants.ts';
import { getPluginSkillPaths } from './plugin-manifest.ts';

const SKIP_DIRS = ['node_modules', '.git', 'dist', 'build', '__pycache__'];

/** All cognitive types in standard iteration order. */
const ALL_COGNITIVE_TYPES: CognitiveType[] = ['skill', 'agent', 'prompt'];

/**
 * The agent directory prefixes used for priority search paths.
 * Each entry produces paths like `.agent/<subdir>`, `.agents/<subdir>`, etc.
 */
const AGENT_DIR_PREFIXES = [
  '.agent',
  '.agents',
  '.claude',
  '.cline',
  '.codebuddy',
  '.codex',
  '.commandcode',
  '.continue',
  '.cursor',
  '.github',
  '.goose',
  '.iflow',
  '.junie',
  '.kilocode',
  '.kiro',
  '.mux',
  '.neovate',
  '.opencode',
  '.openhands',
  '.pi',
  '.qoder',
  '.roo',
  '.trae',
  '.windsurf',
  '.zencoder',
];

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

/**
 * Recursively find directories that contain any of the specified cognitive files.
 */
async function findCognitiveDirs(
  dir: string,
  types: CognitiveType[] = ALL_COGNITIVE_TYPES,
  depth = 0,
  maxDepth = 5
): Promise<{ dir: string; cognitiveType: CognitiveType }[]> {
  if (depth > maxDepth) return [];

  try {
    const checks = types.map(async (ct) => ({
      type: ct,
      found: await hasCognitiveMd(dir, ct),
    }));

    const [results, entries] = await Promise.all([
      Promise.all(checks),
      readdir(dir, { withFileTypes: true }).catch(() => []),
    ]);

    const currentDir = results.filter((r) => r.found).map((r) => ({ dir, cognitiveType: r.type }));

    // Search subdirectories in parallel
    const subDirResults = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory() && !SKIP_DIRS.includes(entry.name))
        .map((entry) => findCognitiveDirs(join(dir, entry.name), types, depth + 1, maxDepth))
    );

    return [...currentDir, ...subDirResults.flat()];
  } catch {
    return [];
  }
}

export interface DiscoverSkillsOptions {
  /** Include internal skills (e.g., when user explicitly requests a skill by name) */
  includeInternal?: boolean;
  /** Search all subdirectories even when a root cognitive file exists */
  fullDepth?: boolean;
  /** Cognitive types to discover. Defaults to ['skill'] for backward compatibility. */
  types?: CognitiveType[];
}

/**
 * Build priority search directories for a given cognitive type.
 */
function buildPrioritySearchDirs(searchPath: string, cognitiveType: CognitiveType): string[] {
  const subdir = COGNITIVE_SUBDIRS[cognitiveType];

  const dirs = [
    searchPath,
    join(searchPath, subdir),
    join(searchPath, `${subdir}/.curated`),
    join(searchPath, `${subdir}/.experimental`),
    join(searchPath, `${subdir}/.system`),
  ];

  for (const prefix of AGENT_DIR_PREFIXES) {
    dirs.push(join(searchPath, prefix, subdir));
  }

  return dirs;
}

/**
 * Discover cognitives (skills, agents, prompts) at the given path.
 *
 * When `options.types` is not specified, defaults to `['skill']` for backward
 * compatibility with `discoverSkills`.
 */
export async function discoverCognitives(
  basePath: string,
  subpath?: string,
  options?: DiscoverSkillsOptions
): Promise<Skill[]> {
  const types = options?.types ?? ['skill'];
  const results: Skill[] = [];
  const seenKeys = new Set<string>();
  const searchPath = subpath ? join(basePath, subpath) : basePath;

  /** Deduplicated key: cognitive type + name */
  const makeKey = (cognitiveType: CognitiveType, name: string) => `${cognitiveType}::${name}`;

  const addResult = (skill: Skill): boolean => {
    const key = makeKey(skill.cognitiveType ?? 'skill', skill.name);
    if (seenKeys.has(key)) return false;
    seenKeys.add(key);
    results.push(skill);
    return true;
  };

  // If pointing directly at a cognitive file, add it (and return early unless fullDepth)
  for (const ct of types) {
    if (await hasCognitiveMd(searchPath, ct)) {
      const fileName = COGNITIVE_FILE_NAMES[ct];
      const cognitive = await parseCognitiveMd(join(searchPath, fileName), ct, options);
      if (cognitive) {
        addResult(cognitive);
      }
    }
  }

  // Return early if we found a direct match and fullDepth is not set
  if (results.length > 0 && !options?.fullDepth) {
    return results;
  }

  // Collect all unique priority search dirs across all requested types
  const allPriorityDirs = new Set<string>();
  /** Maps directory path -> set of cognitive types to check in that directory */
  const dirTypeMap = new Map<string, Set<CognitiveType>>();

  for (const ct of types) {
    const dirs = buildPrioritySearchDirs(searchPath, ct);

    // For skills, also add plugin manifest paths
    if (ct === 'skill') {
      dirs.push(...(await getPluginSkillPaths(searchPath)));
    }

    for (const dir of dirs) {
      allPriorityDirs.add(dir);
      if (!dirTypeMap.has(dir)) {
        dirTypeMap.set(dir, new Set());
      }
      dirTypeMap.get(dir)!.add(ct);
    }
  }

  // Search priority directories
  for (const dir of allPriorityDirs) {
    const typesForDir = dirTypeMap.get(dir)!;

    try {
      const entries = await readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const subDir = join(dir, entry.name);

          for (const ct of typesForDir) {
            if (await hasCognitiveMd(subDir, ct)) {
              const fileName = COGNITIVE_FILE_NAMES[ct];
              const cognitive = await parseCognitiveMd(join(subDir, fileName), ct, options);
              if (cognitive) {
                addResult(cognitive);
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
  if (results.length === 0 || options?.fullDepth) {
    const allCognitiveDirs = await findCognitiveDirs(searchPath, types);

    for (const { dir: cogDir, cognitiveType: ct } of allCognitiveDirs) {
      const fileName = COGNITIVE_FILE_NAMES[ct];
      const cognitive = await parseCognitiveMd(join(cogDir, fileName), ct, options);
      if (cognitive) {
        addResult(cognitive);
      }
    }
  }

  return results;
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
 * @deprecated Use `findCognitiveDirs(dir, ['skill'])` instead.
 */
async function findSkillDirs(dir: string, depth = 0, maxDepth = 5): Promise<string[]> {
  const results = await findCognitiveDirs(dir, ['skill'], depth, maxDepth);
  return results.map((r) => r.dir);
}

/**
 * Discover skills at the given path.
 * This is a backward-compatible wrapper around `discoverCognitives`.
 */
export async function discoverSkills(
  basePath: string,
  subpath?: string,
  options?: DiscoverSkillsOptions
): Promise<Skill[]> {
  return discoverCognitives(basePath, subpath, { ...options, types: options?.types ?? ['skill'] });
}

export function getSkillDisplayName(skill: Skill): string {
  return skill.name || basename(skill.path);
}

/**
 * Filter skills based on user input (case-insensitive direct matching).
 * Multi-word skill names must be quoted on the command line.
 */
export function filterSkills(skills: Skill[], inputNames: string[]): Skill[] {
  const normalizedInputs = inputNames.map((n) => n.toLowerCase());

  return skills.filter((skill) => {
    const name = skill.name.toLowerCase();
    const displayName = getSkillDisplayName(skill).toLowerCase();

    return normalizedInputs.some((input) => input === name || input === displayName);
  });
}
