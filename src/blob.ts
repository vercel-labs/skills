/**
 * Blob-based skill download utilities.
 *
 * Enables fast skill installation by fetching pre-built skill snapshots
 * from the skills.sh download API instead of cloning git repos.
 *
 * Flow:
 *   1. GitHub Trees API → discover SKILL.md locations
 *   2. raw.githubusercontent.com → fetch frontmatter to get skill names
 *   3. skills.sh/api/download → fetch full file contents from cached blob
 */

import { parseFrontmatter } from './frontmatter.ts';
import type { Skill } from './types.ts';

// ─── Types ───

export interface SkillSnapshotFile {
  path: string;
  contents: string;
}

export interface SkillDownloadResponse {
  files: SkillSnapshotFile[];
  hash: string; // skillsComputedHash
}

/**
 * A skill resolved from blob storage, carrying file contents in memory
 * instead of referencing a directory on disk.
 */
export interface BlobSkill extends Skill {
  /** Files from the blob snapshot */
  files: SkillSnapshotFile[];
  /** skillsComputedHash from the blob snapshot */
  snapshotHash: string;
  /** Path of the SKILL.md within the repo (e.g., "skills/react-best-practices/SKILL.md") */
  repoPath: string;
}

// ─── Constants ───

const DOWNLOAD_BASE_URL = process.env.SKILLS_DOWNLOAD_URL || 'https://skills.sh';

/** Timeout for individual HTTP fetches (ms) */
const FETCH_TIMEOUT = 10_000;

// ─── Slug computation ───

/**
 * Convert a skill name to a URL-safe slug.
 * Must match the server-side toSkillSlug() exactly.
 */
export function toSkillSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

// ─── GitHub Trees API ───

export interface TreeEntry {
  path: string;
  type: 'blob' | 'tree';
  sha: string;
  size?: number;
}

export interface RepoTree {
  sha: string;
  branch: string;
  tree: TreeEntry[];
}

/**
 * Fetch the full recursive tree for a GitHub repo.
 * Returns the tree data including all entries, or null on failure.
 * Tries branches in order: ref (if specified), then main, then master.
 */
export async function fetchRepoTree(
  ownerRepo: string,
  ref?: string,
  token?: string | null
): Promise<RepoTree | null> {
  const branches = ref ? [ref] : ['HEAD', 'main', 'master'];

  for (const branch of branches) {
    try {
      const url = `https://api.github.com/repos/${ownerRepo}/git/trees/${encodeURIComponent(branch)}?recursive=1`;
      const headers: Record<string, string> = {
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'skills-cli',
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const response = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(FETCH_TIMEOUT),
      });

      if (!response.ok) continue;

      const data = (await response.json()) as {
        sha: string;
        tree: TreeEntry[];
      };

      return { sha: data.sha, branch, tree: data.tree };
    } catch {
      continue;
    }
  }

  return null;
}

/**
 * Extract the folder hash (tree SHA) for a specific skill path from a repo tree.
 * This replaces the per-skill GitHub API call previously done in fetchSkillFolderHash().
 */
export function getSkillFolderHashFromTree(tree: RepoTree, skillPath: string): string | null {
  let folderPath = skillPath.replace(/\\/g, '/');

  // Remove SKILL.md suffix to get folder path
  if (folderPath.endsWith('/SKILL.md')) {
    folderPath = folderPath.slice(0, -9);
  } else if (folderPath.endsWith('SKILL.md')) {
    folderPath = folderPath.slice(0, -8);
  }
  if (folderPath.endsWith('/')) {
    folderPath = folderPath.slice(0, -1);
  }

  // Root-level skill
  if (!folderPath) {
    return tree.sha;
  }

  const entry = tree.tree.find((e) => e.type === 'tree' && e.path === folderPath);
  return entry?.sha ?? null;
}

// ─── Skill discovery from tree ───

/** Known directories where SKILL.md files are commonly found (relative to repo root) */
const PRIORITY_PREFIXES = [
  '',
  'skills/',
  'skills/.curated/',
  'skills/.experimental/',
  'skills/.system/',
  '.agents/skills/',
  '.claude/skills/',
  '.cline/skills/',
  '.codebuddy/skills/',
  '.codex/skills/',
  '.commandcode/skills/',
  '.continue/skills/',
  '.github/skills/',
  '.goose/skills/',
  '.iflow/skills/',
  '.junie/skills/',
  '.kilocode/skills/',
  '.kiro/skills/',
  '.mux/skills/',
  '.neovate/skills/',
  '.opencode/skills/',
  '.openhands/skills/',
  '.pi/skills/',
  '.qoder/skills/',
  '.roo/skills/',
  '.trae/skills/',
  '.windsurf/skills/',
  '.zencoder/skills/',
];

/**
 * Find all SKILL.md file paths in a repo tree.
 * Applies the same priority directory logic as discoverSkills().
 * If subpath is set, only searches within that subtree.
 */
export function findSkillMdPaths(tree: RepoTree, subpath?: string): string[] {
  // Find all blob entries that are SKILL.md files
  const allSkillMds = tree.tree
    .filter((e) => e.type === 'blob' && e.path.endsWith('SKILL.md'))
    .map((e) => e.path);

  // Apply subpath filter
  const prefix = subpath ? (subpath.endsWith('/') ? subpath : subpath + '/') : '';
  const filtered = prefix
    ? allSkillMds.filter((p) => p.startsWith(prefix) || p === prefix + 'SKILL.md')
    : allSkillMds;

  if (filtered.length === 0) return [];

  // Check priority directories first (same order as discoverSkills)
  const priorityResults: string[] = [];
  const seen = new Set<string>();

  for (const priorityPrefix of PRIORITY_PREFIXES) {
    const fullPrefix = prefix + priorityPrefix;
    for (const skillMd of filtered) {
      // Check if this SKILL.md is directly inside the priority dir (one level deep)
      if (!skillMd.startsWith(fullPrefix)) continue;
      const rest = skillMd.slice(fullPrefix.length);

      // Direct SKILL.md in the priority dir (e.g., "skills/SKILL.md")
      if (rest === 'SKILL.md') {
        if (!seen.has(skillMd)) {
          priorityResults.push(skillMd);
          seen.add(skillMd);
        }
        continue;
      }

      // SKILL.md one level deep (e.g., "skills/react-best-practices/SKILL.md")
      const parts = rest.split('/');
      if (parts.length === 2 && parts[1] === 'SKILL.md') {
        if (!seen.has(skillMd)) {
          priorityResults.push(skillMd);
          seen.add(skillMd);
        }
      }
    }
  }

  // If we found skills in priority dirs, return those
  if (priorityResults.length > 0) return priorityResults;

  // Fallback: return all SKILL.md files found (limited to 5 levels deep)
  return filtered.filter((p) => {
    const depth = p.split('/').length;
    return depth <= 6; // 5 levels + the SKILL.md file itself
  });
}

// ─── Fetching skill content ───

/**
 * Fetch a single SKILL.md from raw.githubusercontent.com to get frontmatter.
 * Returns the raw content string, or null on failure.
 */
async function fetchSkillMdContent(
  ownerRepo: string,
  branch: string,
  skillMdPath: string
): Promise<string | null> {
  try {
    const url = `https://raw.githubusercontent.com/${ownerRepo}/${branch}/${skillMdPath}`;
    const response = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT),
    });
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  }
}

/**
 * Fetch a skill's full file contents from the skills.sh download API.
 * Returns the files array and content hash, or null on failure.
 */
async function fetchSkillDownload(
  source: string,
  slug: string
): Promise<SkillDownloadResponse | null> {
  try {
    const [owner, repo] = source.split('/');
    const url = `${DOWNLOAD_BASE_URL}/api/download/${encodeURIComponent(owner!)}/${encodeURIComponent(repo!)}/${encodeURIComponent(slug)}`;
    const response = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT),
    });
    if (!response.ok) return null;
    return (await response.json()) as SkillDownloadResponse;
  } catch {
    return null;
  }
}

// ─── Main entry point ───

export interface BlobInstallResult {
  skills: BlobSkill[];
  tree: RepoTree;
}

/**
 * Attempt to resolve skills from blob storage instead of cloning.
 *
 * Steps:
 *   1. Fetch repo tree from GitHub Trees API
 *   2. Discover SKILL.md paths from the tree
 *   3. Fetch SKILL.md content from raw.githubusercontent.com (for frontmatter/name)
 *   4. Compute slugs and fetch full snapshots from skills.sh download API
 *
 * Returns the resolved BlobSkills + tree data on success, or null on any failure
 * (the caller should fall back to git clone).
 *
 * @param ownerRepo - e.g., "vercel-labs/agent-skills"
 * @param options - subpath, skillFilter, ref, token
 */
export async function tryBlobInstall(
  ownerRepo: string,
  options: {
    subpath?: string;
    skillFilter?: string;
    ref?: string;
    token?: string | null;
    includeInternal?: boolean;
  } = {}
): Promise<BlobInstallResult | null> {
  // 1. Fetch the full repo tree
  const tree = await fetchRepoTree(ownerRepo, options.ref, options.token);
  if (!tree) return null;

  // 2. Discover SKILL.md paths in the tree
  let skillMdPaths = findSkillMdPaths(tree, options.subpath);
  if (skillMdPaths.length === 0) return null;

  // 3. If a skill filter is set (owner/repo@skill-name), try to narrow down
  if (options.skillFilter) {
    const filterSlug = toSkillSlug(options.skillFilter);
    const filtered = skillMdPaths.filter((p) => {
      // Match by folder name — e.g., "skills/react-best-practices/SKILL.md"
      const parts = p.split('/');
      if (parts.length < 2) return false;
      const folderName = parts[parts.length - 2]!;
      return toSkillSlug(folderName) === filterSlug;
    });
    if (filtered.length > 0) {
      skillMdPaths = filtered;
    }
    // If no match by folder name, we'll try matching by frontmatter name below
  }

  // 4. Fetch SKILL.md content from raw.githubusercontent.com in parallel
  const mdFetches = await Promise.all(
    skillMdPaths.map(async (mdPath) => {
      const content = await fetchSkillMdContent(ownerRepo, tree.branch, mdPath);
      return { mdPath, content };
    })
  );

  // Parse frontmatter to get skill names
  const parsedSkills: Array<{
    mdPath: string;
    name: string;
    description: string;
    content: string;
    slug: string;
    metadata?: Record<string, unknown>;
  }> = [];

  for (const { mdPath, content } of mdFetches) {
    if (!content) continue;

    const { data } = parseFrontmatter(content);
    if (!data.name || !data.description) continue;
    if (typeof data.name !== 'string' || typeof data.description !== 'string') continue;

    // Skip internal skills unless explicitly requested
    const isInternal = (data.metadata as Record<string, unknown>)?.internal === true;
    if (isInternal && !options.includeInternal) continue;

    parsedSkills.push({
      mdPath,
      name: data.name,
      description: data.description,
      content,
      slug: toSkillSlug(data.name),
      metadata: data.metadata as Record<string, unknown> | undefined,
    });
  }

  if (parsedSkills.length === 0) return null;

  // Apply skill filter by name if not already filtered by folder name
  let filteredSkills = parsedSkills;
  if (options.skillFilter) {
    const filterSlug = toSkillSlug(options.skillFilter);
    const nameFiltered = parsedSkills.filter((s) => s.slug === filterSlug);
    if (nameFiltered.length > 0) {
      filteredSkills = nameFiltered;
    }
    // If still no match, let the caller fall back to clone where
    // filterSkills() does fuzzy matching
    if (filteredSkills.length === 0) return null;
  }

  // 5. Fetch full snapshots from skills.sh download API in parallel
  const source = ownerRepo.toLowerCase();
  const downloads = await Promise.all(
    filteredSkills.map(async (skill) => {
      const download = await fetchSkillDownload(source, skill.slug);
      return { skill, download };
    })
  );

  // If ANY download failed, fall back to clone — we don't do partial blob installs
  const allSucceeded = downloads.every((d) => d.download !== null);
  if (!allSucceeded) return null;

  // 6. Convert to BlobSkill objects
  const blobSkills: BlobSkill[] = downloads.map(({ skill, download }) => {
    // Compute the folder path from the SKILL.md path (e.g., "skills/react-best-practices")
    const folderPath = skill.mdPath.endsWith('/SKILL.md')
      ? skill.mdPath.slice(0, -9)
      : skill.mdPath === 'SKILL.md'
        ? ''
        : skill.mdPath.slice(0, -(1 + 'SKILL.md'.length));

    return {
      name: skill.name,
      description: skill.description,
      // BlobSkills don't have a disk path — set to empty string.
      // The installer uses the files array directly.
      path: '',
      rawContent: skill.content,
      metadata: skill.metadata,
      files: download!.files,
      snapshotHash: download!.hash,
      repoPath: skill.mdPath,
    };
  });

  return { skills: blobSkills, tree };
}
