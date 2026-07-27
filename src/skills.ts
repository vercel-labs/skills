import { readdir, readFile, stat } from 'fs/promises';
import { join, basename, dirname, resolve, normalize, sep, relative } from 'path';
import { parseFrontmatter } from './frontmatter.ts';
import { sanitizeMetadata, stripTerminalEscapes } from './sanitize.ts';
import type { Skill } from './types.ts';
import { getPluginSkillPaths, getPluginGroupings } from './plugin-manifest.ts';
import { readLocalLock } from './local-lock.ts';

const SKIP_DIRS = ['node_modules', '.git', 'dist', 'build', '__pycache__'];

const AGENT_PROJECT_SKILL_DIRS = [
  '.agents/skills',
  '.claude/skills',
  '.cline/skills',
  '.codebuddy/skills',
  '.codex/skills',
  '.commandcode/skills',
  '.continue/skills',
  '.github/skills',
  '.goose/skills',
  '.grok/skills',
  '.iflow/skills',
  '.junie/skills',
  '.kilocode/skills',
  '.kimchi/skills',
  '.kiro/skills',
  '.mux/skills',
  '.neovate/skills',
  '.opencode/skills',
  '.openhands/skills',
  '.pi/skills',
  '.qoder/skills',
  '.roo/skills',
  '.trae/skills',
  '.windsurf/skills',
  '.zcode/skills',
  '.zencoder/skills',
];

function normalizeSkillName(name: string): string {
  return name.toLowerCase().replace(/[\s_]+/g, '-');
}

function normalizeRelativePath(path: string): string {
  return path.split(sep).join('/').replace(/\/+/g, '/');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

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

function warnSkippedSkill(skillMdPath: string, reason: string): void {
  console.warn(`⚠ Skipped ${sanitizeMetadata(skillMdPath)} — ${stripTerminalEscapes(reason)}`);
}

export async function parseSkillMd(
  skillMdPath: string,
  options?: { includeInternal?: boolean }
): Promise<Skill | null> {
  let content: string;
  try {
    content = await readFile(skillMdPath, 'utf-8');
  } catch (err) {
    warnSkippedSkill(skillMdPath, `failed to read file: ${(err as Error).message}`);
    return null;
  }

  let data: Record<string, unknown>;
  try {
    ({ data } = parseFrontmatter(content));
  } catch (err) {
    warnSkippedSkill(skillMdPath, `YAML parse error: ${(err as Error).message}`);
    return null;
  }

  if (!data.name || !data.description) {
    const missing: string[] = [];
    if (!data.name) missing.push('name');
    if (!data.description) missing.push('description');
    warnSkippedSkill(skillMdPath, `missing required frontmatter field(s): ${missing.join(', ')}`);
    return null;
  }

  // Ensure name and description are strings (YAML can parse numbers, booleans, etc.)
  if (typeof data.name !== 'string' || typeof data.description !== 'string') {
    warnSkippedSkill(
      skillMdPath,
      `frontmatter "name" and "description" must be strings (got ${typeof data.name} and ${typeof data.description})`
    );
    return null;
  }

  // Skip internal skills unless:
  // 1. INSTALL_INTERNAL_SKILLS=1 is set, OR
  // 2. includeInternal option is true (e.g., when user explicitly requests a skill)
  const metadata = isRecord(data.metadata) ? data.metadata : undefined;
  const isInternal = metadata?.internal === true;
  if (isInternal && !shouldInstallInternalSkills() && !options?.includeInternal) {
    return null;
  }

  return {
    name: sanitizeMetadata(data.name),
    description: sanitizeMetadata(data.description),
    path: dirname(skillMdPath),
    rawContent: content,
    metadata,
  };
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
  const parsedSkillPaths = new Set<string>();
  const localLock = await readLocalLock(basePath);
  const lockedSkillNames = new Set(Object.keys(localLock.skills).map(normalizeSkillName));

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

  const isInstalledProjectSkill = (skill: Skill): boolean => {
    if (lockedSkillNames.size === 0) return false;

    const relativeDir = normalizeRelativePath(relative(basePath, skill.path));
    const isAgentSkillPath = AGENT_PROJECT_SKILL_DIRS.some(
      (dir) => relativeDir === dir || relativeDir.startsWith(`${dir}/`)
    );
    if (!isAgentSkillPath) return false;

    const skillName = normalizeSkillName(skill.name);
    const directoryName = normalizeSkillName(basename(skill.path));
    return lockedSkillNames.has(skillName) || lockedSkillNames.has(directoryName);
  };

  const parseSkillAt = async (skillDir: string): Promise<Skill | null> => {
    const skillMdPath = resolve(skillDir, 'SKILL.md');
    if (parsedSkillPaths.has(skillMdPath)) return null;
    parsedSkillPaths.add(skillMdPath);
    return parseSkillMd(skillMdPath, options);
  };

  // If pointing directly at a skill, add it (and return early unless fullDepth is set).
  // If the root SKILL.md is an installed project skill tracked by skills-lock.json,
  // ignore it and continue scanning in case the repo also contains source skills.
  if (await hasSkillMd(searchPath)) {
    let skill = await parseSkillAt(searchPath);
    if (skill) {
      if (!isInstalledProjectSkill(skill)) {
        skill = enhanceSkill(skill);
        skills.push(skill);
        seenNames.add(skill.name);
        // Only return early if fullDepth is not set
        if (!options?.fullDepth) {
          return skills;
        }
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
    ...AGENT_PROJECT_SKILL_DIRS.map((dir) => join(searchPath, dir)),
  ];

  // Known skill container dirs are walked one extra level deep so layouts
  // like `skills/<category>/<skill>/SKILL.md` are discovered without
  // requiring `--full-depth`. The repo root (first entry) keeps its
  // existing depth-1 behavior to avoid surfacing unrelated `SKILL.md`
  // files (e.g. `examples/foo/SKILL.md`), and plugin-manifest-declared
  // dirs (appended below) stay at depth-1 to honor the manifest spec.
  const deepContainerDirs = new Set(prioritySearchDirs.slice(1));

  // Add skill paths declared in plugin manifests
  prioritySearchDirs.push(...(await getPluginSkillPaths(searchPath)));

  const tryAddSkillAt = async (skillDir: string): Promise<boolean> => {
    if (!(await hasSkillMd(skillDir))) return false;
    let skill = await parseSkillAt(skillDir);
    if (!skill || seenNames.has(skill.name)) return true;
    if (isInstalledProjectSkill(skill)) return true;
    skill = enhanceSkill(skill);
    skills.push(skill);
    seenNames.add(skill.name);
    return true;
  };

  for (const dir of prioritySearchDirs) {
    const walkDeep = deepContainerDirs.has(dir);

    try {
      const entries = await readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const childDir = join(dir, entry.name);
        const foundAtChild = await tryAddSkillAt(childDir);

        // Don't descend past a discovered SKILL.md (matches the existing
        // flat-layout semantics) and don't go deeper inside non-container
        // priority dirs.
        if (foundAtChild || !walkDeep) continue;
        if (SKIP_DIRS.includes(entry.name)) continue;

        // Walk one extra level for catalog layouts.
        try {
          const grandEntries = await readdir(childDir, { withFileTypes: true });
          for (const grand of grandEntries) {
            if (!grand.isDirectory() || SKIP_DIRS.includes(grand.name)) continue;
            await tryAddSkillAt(join(childDir, grand.name));
          }
        } catch {
          // Child dir unreadable; skip silently.
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
      let skill = await parseSkillAt(skillDir);
      if (skill && !seenNames.has(skill.name) && !isInstalledProjectSkill(skill)) {
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
