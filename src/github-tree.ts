import { execSync } from 'child_process';

type GitHubTreeEntry = {
  path: string;
  type: string;
  sha: string;
};

type GitHubTreeResponse = {
  sha: string;
  tree: GitHubTreeEntry[];
};

// Cache repo tree fetches for the lifetime of the current process. Failed lookups are evicted so
// transient network or API errors do not poison later retries.
const repoTreeCache = new Map<string, Promise<GitHubTreeResponse | null>>();

/**
 * Get a GitHub token for authenticated API requests.
 * Tries environment variables first, then falls back to `gh auth token`.
 *
 * @returns The token string, or null if no token is available
 */
export function getGitHubToken(): string | null {
  if (process.env.GITHUB_TOKEN) {
    return process.env.GITHUB_TOKEN;
  }
  if (process.env.GH_TOKEN) {
    return process.env.GH_TOKEN;
  }

  try {
    const token = execSync('gh auth token', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    if (token) {
      return token;
    }
  } catch {
    // gh CLI not installed or not authenticated
  }

  return null;
}

/**
 * Fetch the full recursive GitHub tree for a repository branch.
 * Results are cached per `owner/repo@branch` for the lifetime of the current process.
 *
 * @param ownerRepo - GitHub owner/repo (e.g. "vercel-labs/agent-skills")
 * @param branch - Branch to query (typically "main" or "master")
 * @param token - Optional GitHub token for authenticated requests
 * @returns The recursive tree payload, or null if the branch/tree could not be fetched
 */
async function fetchRepoTree(
  ownerRepo: string,
  branch: string,
  token?: string | null
): Promise<GitHubTreeResponse | null> {
  const cacheKey = `${ownerRepo}@${branch}`;
  let treePromise = repoTreeCache.get(cacheKey);
  if (!treePromise) {
    treePromise = (async () => {
      const url = `https://api.github.com/repos/${ownerRepo}/git/trees/${branch}?recursive=1`;
      const headers: Record<string, string> = {
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'skills-cli',
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const response = await fetch(url, { headers });
      if (!response.ok) {
        return null;
      }
      return (await response.json()) as GitHubTreeResponse;
    })();
    repoTreeCache.set(cacheKey, treePromise);
  }

  try {
    return await treePromise;
  } catch {
    repoTreeCache.delete(cacheKey);
    return null;
  }
}

/**
 * Fetch the GitHub tree SHA for a skill folder.
 * Tries `main` first, then falls back to `master`.
 *
 * @param ownerRepo - GitHub owner/repo (e.g. "vercel-labs/agent-skills")
 * @param skillPath - Path to the skill folder or its SKILL.md file
 * @param token - Optional GitHub token for authenticated requests
 * @returns The tree SHA for the skill folder, or null if not found
 */
export async function fetchSkillFolderHash(
  ownerRepo: string,
  skillPath: string,
  token?: string | null
): Promise<string | null> {
  let folderPath = skillPath.replace(/\\/g, '/');

  if (folderPath.endsWith('/SKILL.md')) {
    folderPath = folderPath.slice(0, -9);
  } else if (folderPath.endsWith('SKILL.md')) {
    folderPath = folderPath.slice(0, -8);
  }

  if (folderPath.endsWith('/')) {
    folderPath = folderPath.slice(0, -1);
  }

  const branches = ['main', 'master'];
  for (const branch of branches) {
    try {
      const data = await fetchRepoTree(ownerRepo, branch, token);
      if (!data) {
        repoTreeCache.delete(`${ownerRepo}@${branch}`);
        continue;
      }

      if (!folderPath) {
        return data.sha;
      }

      const folderEntry = data.tree.find(
        (entry) => entry.type === 'tree' && entry.path === folderPath
      );
      if (folderEntry) {
        return folderEntry.sha;
      }
    } catch {
      repoTreeCache.delete(`${ownerRepo}@${branch}`);
    }
  }

  return null;
}
