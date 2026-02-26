import { isAbsolute, resolve } from 'path';
import type { ParsedSource } from './types.ts';

/**
 * Check if a hostname is a GitHub-like host.
 * Matches: github.com, *.github.com (e.g., mycompany.github.com),
 * and github.*.* (e.g., github.mycompany.com) for GitHub Enterprise Server.
 */
function isGitHubHost(hostname: string): boolean {
  return (
    hostname === 'github.com' ||
    hostname.endsWith('.github.com') ||
    (hostname.startsWith('github.') && hostname !== 'github.com')
  );
}

/**
 * Extract owner/repo (or group/subgroup/repo for GitLab) from a parsed source
 * for lockfile tracking and telemetry.
 * Returns null for local paths or unparseable sources.
 * Supports any Git host with an owner/repo URL structure, including GitLab subgroups.
 */
export function getOwnerRepo(parsed: ParsedSource): string | null {
  if (parsed.type === 'local') {
    return null;
  }

  // Only handle HTTP(S) URLs
  if (!parsed.url.startsWith('http://') && !parsed.url.startsWith('https://')) {
    return null;
  }

  try {
    const url = new URL(parsed.url);
    // Get pathname, remove leading slash and trailing .git
    let path = url.pathname.slice(1);
    path = path.replace(/\.git$/, '');

    // Must have at least owner/repo (one slash)
    if (path.includes('/')) {
      return path;
    }
  } catch {
    // Invalid URL
  }

  return null;
}

/**
 * Extract owner and repo from an owner/repo string.
 * Returns null if the format is invalid.
 */
export function parseOwnerRepo(ownerRepo: string): { owner: string; repo: string } | null {
  const match = ownerRepo.match(/^([^/]+)\/([^/]+)$/);
  if (match) {
    return { owner: match[1]!, repo: match[2]! };
  }
  return null;
}

/**
 * Check if a GitHub repository is private.
 * Returns true if private, false if public, null if unable to determine.
 * Only works for GitHub repositories (GitLab not supported).
 */
export async function isRepoPrivate(owner: string, repo: string): Promise<boolean | null> {
  try {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`);

    // If repo doesn't exist or we don't have access, assume private to be safe
    if (!res.ok) {
      return null; // Unable to determine
    }

    const data = (await res.json()) as { private?: boolean };
    return data.private === true;
  } catch {
    // On error, return null to indicate we couldn't determine
    return null;
  }
}

/**
 * Check if a string represents a local file system path
 */
function isLocalPath(input: string): boolean {
  return (
    isAbsolute(input) ||
    input.startsWith('./') ||
    input.startsWith('../') ||
    input === '.' ||
    input === '..' ||
    // Windows absolute paths like C:\ or D:\
    /^[a-zA-Z]:[/\\]/.test(input)
  );
}

/**
 * Check if a URL is a direct link to a skill.md file.
 * Supports various hosts: Mintlify docs, HuggingFace Spaces, etc.
 * e.g., https://docs.bun.com/docs/skill.md
 * e.g., https://huggingface.co/spaces/owner/repo/blob/main/SKILL.md
 *
 * Note: GitHub and GitLab URLs are excluded as they have their own handling
 * for cloning repositories.
 */
function isDirectSkillUrl(input: string): boolean {
  if (!input.startsWith('http://') && !input.startsWith('https://')) {
    return false;
  }

  // Must end with skill.md (case insensitive)
  if (!input.toLowerCase().endsWith('/skill.md')) {
    return false;
  }

  try {
    const parsed = new URL(input);

    // Exclude GitHub and GitLab repository URLs - they have their own handling
    // (but allow raw.githubusercontent.com if someone wants to use it directly)
    if (isGitHubHost(parsed.hostname) && !input.includes('raw.githubusercontent.com')) {
      // Check if it's a blob/raw URL to SKILL.md (these should be handled by providers)
      // vs a tree/repo URL (these should be cloned)
      if (!input.includes('/blob/') && !input.includes('/raw/')) {
        return false;
      }
    }
    if (parsed.hostname === 'gitlab.com' && !input.includes('/-/raw/')) {
      return false;
    }
  } catch {
    return false;
  }

  return true;
}

/**
 * Parse a source string into a structured format
 * Supports: local paths, GitHub URLs, GitLab URLs, GitHub shorthand, direct skill.md URLs, and direct git URLs
 */
// Source aliases: map common shorthand to canonical source
const SOURCE_ALIASES: Record<string, string> = {
  'coinbase/agentWallet': 'coinbase/agentic-wallet-skills',
};

export function parseSource(input: string): ParsedSource {
  // Resolve source aliases before parsing
  const alias = SOURCE_ALIASES[input];
  if (alias) {
    input = alias;
  }

  // Local path: absolute, relative, or current directory
  if (isLocalPath(input)) {
    const resolvedPath = resolve(input);
    // Return local type even if path doesn't exist - we'll handle validation in main flow
    return {
      type: 'local',
      url: resolvedPath, // Store resolved path in url for consistency
      localPath: resolvedPath,
    };
  }

  // Direct skill.md URL (non-GitHub/GitLab): https://docs.bun.com/docs/skill.md
  if (isDirectSkillUrl(input)) {
    return {
      type: 'direct-url',
      url: input,
    };
  }

  // Custom GitHub Enterprise URLs
  // Supports two hostname formats:
  //   - *.github.com (e.g., mycompany.github.com)
  //   - github.*.* (e.g., github.mycompany.com) - GitHub Enterprise Server
  // Supports both full URLs (https://github.mycompany.com/...) and shorthand (github.mycompany.com/...)
  // Must be checked BEFORE standard github.com patterns

  // Custom GitHub host with @skill syntax: github.mycompany.com/org/repo@skill-name
  // Must be checked FIRST before other custom GitHub patterns
  const customGitHubAtSkillMatch = input.match(
    /^(?:https?:\/\/)?([a-z0-9-]+\.github\.com|github\.[a-z0-9-]+\.[a-z]+)\/([^/]+)\/([^/@]+)@(.+)$/i
  );
  if (customGitHubAtSkillMatch) {
    const [, hostname, owner, repo, skillFilter] = customGitHubAtSkillMatch;
    return {
      type: 'github',
      url: `https://${hostname}/${owner}/${repo}.git`,
      skillFilter,
    };
  }

  // Custom GitHub host with tree/branch/path: github.mycompany.com/org/repo/tree/main/skills
  const customGitHubTreeMatch = input.match(
    /^(?:https?:\/\/)?([a-z0-9-]+\.github\.com|github\.[a-z0-9-]+\.[a-z]+)\/([^/]+)\/([^/]+)\/tree\/([^/]+)(?:\/(.+))?$/i
  );
  if (customGitHubTreeMatch) {
    const [, hostname, owner, repoWithGit, ref, subpath] = customGitHubTreeMatch;
    const repo = repoWithGit!.replace(/\.git$/, '');
    return {
      type: 'github',
      url: `https://${hostname}/${owner}/${repo}.git`,
      ref,
      subpath,
    };
  }

  // Custom GitHub host with subpath: github.mycompany.com/org/repo/path/to/skill
  const customGitHubSubpathMatch = input.match(
    /^(?:https?:\/\/)?([a-z0-9-]+\.github\.com|github\.[a-z0-9-]+\.[a-z]+)\/([^/]+)\/([^/]+)\/(.+)$/i
  );
  if (customGitHubSubpathMatch) {
    const [, hostname, owner, repoWithGit, subpath] = customGitHubSubpathMatch;
    const repo = repoWithGit!.replace(/\.git$/, '');
    return {
      type: 'github',
      url: `https://${hostname}/${owner}/${repo}.git`,
      subpath,
    };
  }

  // Basic custom GitHub host: github.mycompany.com/org/repo
  const customGitHubMatch = input.match(
    /^(?:https?:\/\/)?([a-z0-9-]+\.github\.com|github\.[a-z0-9-]+\.[a-z]+)\/([^/]+)\/([^/]+)$/i
  );
  if (customGitHubMatch) {
    const [, hostname, owner, repoWithGit] = customGitHubMatch;
    const repo = repoWithGit!.replace(/\.git$/, '');
    return {
      type: 'github',
      url: `https://${hostname}/${owner}/${repo}.git`,
    };
  }

  // GitHub URL with path: https://github.com/owner/repo/tree/branch/path/to/skill
  const githubTreeWithPathMatch = input.match(/github\.com\/([^/]+)\/([^/]+)\/tree\/([^/]+)\/(.+)/);
  if (githubTreeWithPathMatch) {
    const [, owner, repo, ref, subpath] = githubTreeWithPathMatch;
    return {
      type: 'github',
      url: `https://github.com/${owner}/${repo}.git`,
      ref,
      subpath,
    };
  }

  // GitHub URL with branch only: https://github.com/owner/repo/tree/branch
  const githubTreeMatch = input.match(/github\.com\/([^/]+)\/([^/]+)\/tree\/([^/]+)$/);
  if (githubTreeMatch) {
    const [, owner, repo, ref] = githubTreeMatch;
    return {
      type: 'github',
      url: `https://github.com/${owner}/${repo}.git`,
      ref,
    };
  }

  // GitHub URL: https://github.com/owner/repo
  const githubRepoMatch = input.match(/github\.com\/([^/]+)\/([^/]+)/);
  if (githubRepoMatch) {
    const [, owner, repo] = githubRepoMatch;
    const cleanRepo = repo!.replace(/\.git$/, '');
    return {
      type: 'github',
      url: `https://github.com/${owner}/${cleanRepo}.git`,
    };
  }

  // GitLab URL with path (any GitLab instance): https://gitlab.com/owner/repo/-/tree/branch/path
  // Key identifier is the "/-/tree/" path pattern unique to GitLab.
  // Supports subgroups by using a non-greedy match for the repository path.
  const gitlabTreeWithPathMatch = input.match(
    /^(https?):\/\/([^/]+)\/(.+?)\/-\/tree\/([^/]+)\/(.+)/
  );
  if (gitlabTreeWithPathMatch) {
    const [, protocol, hostname, repoPath, ref, subpath] = gitlabTreeWithPathMatch;
    if (hostname !== 'github.com' && repoPath) {
      return {
        type: 'gitlab',
        url: `${protocol}://${hostname}/${repoPath.replace(/\.git$/, '')}.git`,
        ref,
        subpath,
      };
    }
  }

  // GitLab URL with branch only (any GitLab instance): https://gitlab.com/owner/repo/-/tree/branch
  const gitlabTreeMatch = input.match(/^(https?):\/\/([^/]+)\/(.+?)\/-\/tree\/([^/]+)$/);
  if (gitlabTreeMatch) {
    const [, protocol, hostname, repoPath, ref] = gitlabTreeMatch;
    if (hostname !== 'github.com' && repoPath) {
      return {
        type: 'gitlab',
        url: `${protocol}://${hostname}/${repoPath.replace(/\.git$/, '')}.git`,
        ref,
      };
    }
  }

  // GitLab.com URL: https://gitlab.com/owner/repo or https://gitlab.com/group/subgroup/repo
  // Only for the official gitlab.com domain for user convenience.
  // Supports nested subgroups (e.g., gitlab.com/group/subgroup1/subgroup2/repo).
  const gitlabRepoMatch = input.match(/gitlab\.com\/(.+?)(?:\.git)?\/?$/);
  if (gitlabRepoMatch) {
    const repoPath = gitlabRepoMatch[1]!;
    // Must have at least owner/repo (one slash)
    if (repoPath.includes('/')) {
      return {
        type: 'gitlab',
        url: `https://gitlab.com/${repoPath}.git`,
      };
    }
  }

  // GitHub shorthand: owner/repo, owner/repo/path/to/skill, or owner/repo@skill-name
  // Exclude paths that start with . or / to avoid matching local paths
  // First check for @skill syntax: owner/repo@skill-name
  const atSkillMatch = input.match(/^([^/]+)\/([^/@]+)@(.+)$/);
  if (atSkillMatch && !input.includes(':') && !input.startsWith('.') && !input.startsWith('/')) {
    const [, owner, repo, skillFilter] = atSkillMatch;
    return {
      type: 'github',
      url: `https://github.com/${owner}/${repo}.git`,
      skillFilter,
    };
  }

  const shorthandMatch = input.match(/^([^/]+)\/([^/]+)(?:\/(.+))?$/);
  if (shorthandMatch && !input.includes(':') && !input.startsWith('.') && !input.startsWith('/')) {
    const [, owner, repo, subpath] = shorthandMatch;
    return {
      type: 'github',
      url: `https://github.com/${owner}/${repo}.git`,
      subpath,
    };
  }

  // Well-known skills: arbitrary HTTP(S) URLs that aren't GitHub/GitLab
  // This is the final fallback for URLs - we'll check for /.well-known/skills/index.json
  if (isWellKnownUrl(input)) {
    return {
      type: 'well-known',
      url: input,
    };
  }

  // Fallback: treat as direct git URL
  return {
    type: 'git',
    url: input,
  };
}

/**
 * Check if a URL could be a well-known skills endpoint.
 * Must be HTTP(S) and not a known git host (GitHub, GitLab).
 * Also excludes URLs that look like git repos (.git suffix).
 */
function isWellKnownUrl(input: string): boolean {
  if (!input.startsWith('http://') && !input.startsWith('https://')) {
    return false;
  }

  try {
    const parsed = new URL(input);

    // Exclude known git hosts that have their own handling
    const excludedHosts = [
      'github.com',
      'gitlab.com',
      'huggingface.co',
      'raw.githubusercontent.com',
    ];
    if (excludedHosts.includes(parsed.hostname)) {
      return false;
    }

    // Exclude custom GitHub hosts (*.github.com)
    if (isGitHubHost(parsed.hostname)) {
      return false;
    }

    // Don't match URLs that look like direct skill.md links (handled by direct-url type)
    if (input.toLowerCase().endsWith('/skill.md')) {
      return false;
    }

    // Don't match URLs that look like git repos (should be handled by git type)
    if (input.endsWith('.git')) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}
