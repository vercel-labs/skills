import { readdir, readFile, stat } from 'fs/promises';
import { join, basename, dirname, resolve, normalize, sep } from 'path';
import { parse } from 'yaml';
import { parseFrontmatter } from './frontmatter.ts';
import { sanitizeMetadata } from './sanitize.ts';
import type { Skill } from './types.ts';
import { getPluginSkillPaths, getPluginGroupings } from './plugin-manifest.ts';

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

async function readPeerNames(skillDir: string): Promise<string[]> {
  try {
    const content = await readFile(join(skillDir, 'peers.yaml'), 'utf-8');
    const parsed = parse(content) as { peers?: Array<{ name?: unknown }> } | null;
    const peerNames = parsed?.peers
      ?.map((peer) => peer.name)
      .filter((name): name is string => typeof name === 'string' && name.trim().length > 0)
      .map((name) => sanitizeMetadata(name));

    return [...new Set(peerNames ?? [])];
  } catch {
    return [];
  }
}

export async function parseSkillMd(
  skillMdPath: string,
  options?: { includeInternal?: boolean }
): Promise<Skill | null> {
  try {
    const content = await readFile(skillMdPath, 'utf-8');
    const { data } = parseFrontmatter(content);

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
    const metadata =
      data.metadata && typeof data.metadata === 'object'
        ? (data.metadata as Record<string, unknown>)
        : undefined;
    const isInternal = metadata?.internal === true;
    if (isInternal && !shouldInstallInternalSkills() && !options?.includeInternal) {
      return null;
    }

    return {
      name: sanitizeMetadata(data.name),
      description: sanitizeMetadata(data.description),
      path: dirname(skillMdPath),
      rawContent: content,
      peerNames: await readPeerNames(dirname(skillMdPath)),
      metadata,
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

/**
 * Validates that a resolved subpath stays within the base directory.
 * Prevents path traversal attacks where subpath contains ".." segments
 * that would escape the cloned repository directory.
 */
export function isSubpathSafe(basePath: string, subpath: string): boolean {
  const normalizedBase = normalize(resolve(basePath));
  const normalizedTarget = normalize(resolve(join(basePath, subpath)));

  return normalizedTarget.startsWith(normalizedBase + sep) || normalizedTarget === normalizedBase;
}

export async function discoverSkills(
  basePath: string,
  subpath?: string,
  options?: DiscoverSkillsOptions
): Promise<Skill[]> {
  const skills: Skill[] = [];
  const seenNames = new Set<string>();

  // Validate subpath doesn't escape basePath (prevent path traversal)
  if (subpath && !isSubpathSafe(basePath, subpath)) {
    throw new Error(
      `Invalid subpath: "${subpath}" resolves outside the repository directory. Subpath must not contain ".." segments that escape the base path.`
    );
  }

  const searchPath = subpath ? join(basePath, subpath) : basePath;

  // Get plugin groupings to map skills to their parent plugin
  // We search for plugin definitions from the base search path
  const pluginGroupings = await getPluginGroupings(searchPath);

  // Helper to assign plugin name if available
  const enhanceSkill = (skill: Skill) => {
    const resolvedPath = resolve(skill.path);
    if (pluginGroupings.has(resolvedPath)) {
      skill.pluginName = pluginGroupings.get(resolvedPath);
    }
    return skill;
  };

  // If pointing directly at a skill, add it (and return early unless fullDepth is set)
  if (await hasSkillMd(searchPath)) {
    let skill = await parseSkillMd(join(searchPath, 'SKILL.md'), options);
    if (skill) {
      skill = enhanceSkill(skill);
      skills.push(skill);
      seenNames.add(skill.name);
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
    join(searchPath, '.agents/skills'),
    join(searchPath, '.claude/skills'),
    join(searchPath, '.cline/skills'),
    join(searchPath, '.codebuddy/skills'),
    join(searchPath, '.codex/skills'),
    join(searchPath, '.commandcode/skills'),
    join(searchPath, '.continue/skills'),

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
            let skill = await parseSkillMd(join(skillDir, 'SKILL.md'), options);
            if (skill && !seenNames.has(skill.name)) {
              skill = enhanceSkill(skill);
              skills.push(skill);
              seenNames.add(skill.name);
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
      let skill = await parseSkillMd(join(skillDir, 'SKILL.md'), options);
      if (skill && !seenNames.has(skill.name)) {
        skill = enhanceSkill(skill);
        skills.push(skill);
        seenNames.add(skill.name);
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
 */
export function filterSkills(skills: Skill[], inputNames: string[]): Skill[] {
  const normalizedInputs = inputNames.map((n) => n.toLowerCase());

  return skills.filter((skill) => {
    const name = skill.name.toLowerCase();
    const displayName = getSkillDisplayName(skill).toLowerCase();

    return normalizedInputs.some((input) => input === name || input === displayName);
  });
}

/**
 * Include any local peer skills declared in peers.yaml for selected skills.
 * Peers are only expanded when the named peer exists in the discovered source.
 */
export function expandSkillsWithPeers(selectedSkills: Skill[], allSkills: Skill[]): Skill[] {
  const skillsByName = new Map(allSkills.map((skill) => [skill.name.toLowerCase(), skill]));
  const expanded: Skill[] = [];
  const seenNames = new Set<string>();

  const addSkill = (skill: Skill) => {
    const normalizedName = skill.name.toLowerCase();
    if (seenNames.has(normalizedName)) return;

    seenNames.add(normalizedName);
    expanded.push(skill);

    for (const peerName of skill.peerNames ?? []) {
      const peer = skillsByName.get(peerName.toLowerCase());
      if (peer) {
        addSkill(peer);
      }
    }
  };

  for (const skill of selectedSkills) {
    addSkill(skill);
  }

  return expanded;
}
