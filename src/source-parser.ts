import { isAbsolute, resolve } from 'path';
import type { ParsedSource } from './types.ts';

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
 * Extract a short domain keyword from a hostname.
 * e.g., "gitlab.com" -> "gitlab", "github.com" -> "github"
 * For self-hosted instances (gitlab.company.io), extracts the organization/company name.
 */
function getDomainKeyword(hostname: string): string {
  const lowerHost = hostname.toLowerCase();

  // Well-known public domains - use service name as keyword
  const knownDomains: Record<string, string> = {
    'github.com': 'github',
    'gitlab.com': 'gitlab',
    'gitlab.org': 'gitlab',
    'bitbucket.org': 'bitbucket',
    'gitea.io': 'gitea',
    'gitee.com': 'gitee',
  };

  if (knownDomains[lowerHost]) {
    return knownDomains[lowerHost];
  }

  // For self-hosted instances, extract the organization/company name
  // e.g., "gitlab.company.io" -> "company", "git.example.com" -> "example"
  const parts = lowerHost.split('.');

  // Filter out common subdomains and TLDs
  const meaningfulParts = parts.filter(
    (part) => !['www', 'com', 'org', 'net', 'io', 'co', 'dev'].includes(part)
  );

  // For self-hosted GitLab/GitHub/etc, skip the service name (gitlab, git, etc)
  // and use the organization/company name
  const serviceNames = ['gitlab', 'git', 'github', 'gitea', 'gogs', 'gitblit'];
  const orgPart = meaningfulParts.find((part) => !serviceNames.includes(part));

  if (orgPart) {
    return orgPart;
  }

  // Fallback to first non-service part or first part
  return meaningfulParts[0] || parts[0] || 'git';
}

/**
 * Extract organization/company name from hostname.
 * e.g., "gitlab.company.com.cn" -> "company"
 * e.g., "github.com" -> "github"
 */
function getOrgFromHostname(hostname: string): string {
  const lowerHost = hostname.toLowerCase();
  const parts = lowerHost.split('.');

  // Filter out common TLDs and service names
  const excludedParts = new Set([
    'com',
    'org',
    'net',
    'io',
    'co',
    'dev',
    'cn',
    'io',
    'gitlab',
    'git',
    'github',
    'gitea',
    'gogs',
    'gitblit',
    'www',
  ]);

  // Find the first meaningful part (usually the org/company name)
  for (const part of parts) {
    if (!excludedParts.has(part) && part.length > 1) {
      return part;
    }
  }

  // Fallback: return the first non-excluded part or first part
  return parts.find((p) => !excludedParts.has(p)) || parts[0] || 'git';
}

/**
 * Generic directory names that should be skipped when building namespace
 * but included in the skill subpath
 */
const GENERIC_DIR_NAMES = new Set([
  'skills',
  'skill',
  'src',
  'lib',
  'packages',
  'pkg',
  'code',
  'repo',
  'repos',
  'projects',
]);

/**
 * Build namespace from path components.
 * Strategy:
 * 1. For paths with 4+ segments (e.g., /tools/skills-center/skills/01-base/list-skills):
 *    - Use org from hostname + first 2-3 meaningful path segments for namespace
 *    - Remaining segments (excluding generic dirs like 'skills') become skill subpath
 * 2. For simple 2-segment paths (e.g., /owner/repo): use traditional owner-repo format
 */
function buildNamespaceFromPath(
  hostname: string,
  pathSegments: string[],
  isGitHub: boolean,
  isGitLab: boolean
): { namespace: string; skillSubpath?: string } | null {
  // Remove empty segments and .git suffixes
  const segments = pathSegments.map((s) => s.replace(/\.git$/, '')).filter((s) => s.length > 0);

  if (segments.length < 2) {
    return null;
  }

  const lowerHost = hostname.toLowerCase();

  // GitHub: use traditional owner-repo format
  if (isGitHub) {
    const owner = segments[0]!;
    const repo = segments[1]!;
    if (segments.length > 2) {
      // Has subpath: owner-repo/subpath
      return {
        namespace: `${owner}-${repo}`,
        skillSubpath: segments.slice(2).join('/'),
      };
    }
    return { namespace: `${owner}-${repo}` };
  }

  // GitLab.com: use gitlab-owner-repo format
  if (isGitLab && (lowerHost === 'gitlab.com' || lowerHost === 'gitlab.org')) {
    const owner = segments[0]!;
    const repo = segments[1]!;
    if (segments.length > 2) {
      return {
        namespace: `gitlab-${owner}-${repo}`,
        skillSubpath: segments.slice(2).join('/'),
      };
    }
    return { namespace: `gitlab-${owner}-${repo}` };
  }

  // Self-hosted GitLab or other Git hosts
  // For self-hosted GitLab instances, use the same format as GitLab.com (hyphens)
  // e.g., company-team-repo instead of company/team/repo
  let orgFromHost: string;
  const isSelfHostedGitLab =
    lowerHost.includes('gitlab') &&
    !['github.com', 'gitlab.com', 'gitlab.org', 'gitee.com'].includes(lowerHost);

  if (isSelfHostedGitLab) {
    // For self-hosted GitLab, extract org from hostname
    orgFromHost = getOrgFromHostname(hostname);
  } else if (
    lowerHost === 'github.com' ||
    lowerHost === 'gitlab.com' ||
    lowerHost === 'gitlab.org' ||
    lowerHost === 'gitee.com'
  ) {
    // For public git hosting services, don't add prefix
    orgFromHost = '';
  } else {
    orgFromHost = getOrgFromHostname(hostname);
  }

  // For self-hosted GitLab, use the same logic as GitLab.com (hyphens)
  // Namespace: org + all path segments (joined with hyphens)
  // Subpath: remove only the first 'skills' directory, keep rest as-is
  if (isSelfHostedGitLab) {
    const namespaceParts: string[] = [];
    if (orgFromHost.length > 0) {
      namespaceParts.push(orgFromHost);
    }

    // Find the first occurrence of 'skills' directory
    // Everything before it becomes namespace
    // Everything after it (excluding 'skills') becomes subpath
    let firstSkillsIndex = -1;

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i]!;
      if (firstSkillsIndex === -1 && segment.toLowerCase() === 'skills') {
        firstSkillsIndex = i;
      }
    }

    // Namespace: org + all segments before first 'skills'
    const namespaceSegmentCount = firstSkillsIndex !== -1 ? firstSkillsIndex : segments.length;
    for (let i = 0; i < namespaceSegmentCount; i++) {
      namespaceParts.push(segments[i]!);
    }

    // Build namespace with hyphens
    const namespace = namespaceParts.join('-');

    // Subpath: all segments after first 'skills', preserving hierarchy
    let skillSubpath: string | undefined;
    if (firstSkillsIndex !== -1 && firstSkillsIndex < segments.length - 1) {
      const subpathSegments = segments.slice(firstSkillsIndex + 1);
      skillSubpath = subpathSegments.join('/');
    }

    return { namespace, skillSubpath };
  }

  // For multi-level paths from other hosts (Gitee, etc.)
  // Separate meaningful segments from generic ones for namespace building
  // But keep track of generic dirs for subpath calculation
  const meaningfulSegments: string[] = [];
  let firstGenericIndex = -1;

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i]!;
    if (!GENERIC_DIR_NAMES.has(segment.toLowerCase())) {
      meaningfulSegments.push(segment);
    } else if (firstGenericIndex === -1) {
      firstGenericIndex = i;
    }
  }

  // For multi-level paths like /tools/skills-center/skills/01-base/list-skills
  // We want: group1-tools-skills-center/01-base/list-skills (for Gitee)
  if (segments.length >= 4) {
    // For public hosts (no orgFromHost), use first 2 meaningful segments as namespace
    // For self-hosted, use org + first 2 meaningful segments
    let namespaceParts: string[] = [];

    if (orgFromHost.length > 0) {
      namespaceParts.push(orgFromHost);
    }

    // Use first 2 meaningful segments for namespace
    const maxNamespaceSegments = 2;
    for (let i = 0; i < Math.min(maxNamespaceSegments, meaningfulSegments.length); i++) {
      namespaceParts.push(meaningfulSegments[i]!);
    }

    // Calculate skill subpath - starts after the segments used for namespace
    // We need to count which original segments are used in the namespace
    const namespaceSegmentCount = namespaceParts.length;

    const skillSubpath = segments.slice(namespaceSegmentCount).join('/');

    // Remove leading generic directory names from subpath
    const subpathParts = skillSubpath.split('/');
    while (subpathParts.length > 0 && GENERIC_DIR_NAMES.has(subpathParts[0]!.toLowerCase())) {
      subpathParts.shift();
    }

    return {
      namespace: namespaceParts.join('-'),
      skillSubpath: subpathParts.join('/') || undefined,
    };
  }

  // For 3 segment paths with a generic middle segment like /tools/skills/my-skill
  // We want: company-tools/my-skill (not company-tools-skills)
  if (segments.length === 3 && GENERIC_DIR_NAMES.has(segments[1]!.toLowerCase())) {
    if (orgFromHost.length > 0) {
      return {
        namespace: `${orgFromHost}-${segments[0]}`,
        skillSubpath: segments[2],
      };
    } else {
      // For public hosts, just use the first meaningful segment
      return {
        namespace: segments[0]!,
        skillSubpath: segments[2],
      };
    }
  }

  // For 2-3 segment paths: org-segment1-segment2
  const namespaceParts: string[] = [];
  if (orgFromHost.length > 0) {
    namespaceParts.push(orgFromHost);
  }
  for (let i = 0; i < Math.min(2, segments.length); i++) {
    namespaceParts.push(segments[i]!);
  }

  const namespace = namespaceParts.join('-');
  if (segments.length > 2) {
    return {
      namespace,
      skillSubpath: segments.slice(2).join('/'),
    };
  }

  return { namespace };
}

/**
 * Infers a namespace from a parsed source.
 * Namespace naming strategy:
 * - GitHub: owner-repo (clean format)
 * - GitLab: gitlab-owner-repo (prefix to distinguish from GitHub)
 * - Other Git hosts: domain-keyword-owner-repo (with domain keyword prefix)
 * - Direct URLs: hostname (e.g., "docs.bun.com" -> "bun.com")
 * - Well-known: wellknown/hostname (e.g., "wellknown/mintlify.com")
 * Returns null for local paths.
 */
export function inferNamespace(parsed: ParsedSource): string | null {
  if (parsed.type === 'local') {
    return null;
  }

  const url = parsed.url;

  // Handle direct-url type (Mintlify, HuggingFace, etc.)
  if (parsed.type === 'direct-url') {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname.replace(/^www\./, '');
    } catch {
      return null;
    }
  }

  // Handle well-known type
  if (parsed.type === 'well-known') {
    try {
      const urlObj = new URL(url);
      return `wellknown/${urlObj.hostname.replace(/^www\./, '')}`;
    } catch {
      return null;
    }
  }

  // Try to parse the URL to extract hostname and path
  let hostname: string;
  let pathPart: string;

  try {
    const urlObj = new URL(url);
    hostname = urlObj.hostname;
    pathPart = urlObj.pathname;
  } catch {
    // Not a valid URL, try SSH format
    const sshMatch = url.match(/^git@([^:]+):(.+)\.git$/);
    if (sshMatch) {
      hostname = sshMatch[1] || '';
      pathPart = sshMatch[2] || '';
    } else {
      return null;
    }
  }

  const lowerHost = hostname.toLowerCase();
  const isGitHub = lowerHost === 'github.com' || parsed.type === 'github';
  const isGitLab =
    lowerHost === 'gitlab.com' || lowerHost === 'gitlab.org' || parsed.type === 'gitlab';

  // Split path into segments
  const pathSegments = pathPart.split('/').filter((s) => s.length > 0);

  // Use smart path builder for multi-level paths
  const result = buildNamespaceFromPath(hostname, pathSegments, isGitHub, isGitLab);
  if (result) {
    return result.namespace;
  }

  // Fallback: use domain keyword
  const keyword = getDomainKeyword(hostname);
  return keyword || 'git';
}

/**
 * Extract skill subpath from a parsed source.
 * For multi-level paths like /tools/skills-center/skills/01-base/list-skills,
 * returns the subpath part (e.g., "01-base/list-skills").
 */
export function inferSkillSubpath(parsed: ParsedSource): string | undefined {
  if (parsed.type === 'local' || parsed.type === 'direct-url' || parsed.type === 'well-known') {
    return parsed.subpath;
  }

  const url = parsed.url;

  try {
    const urlObj = new URL(url);
    const pathSegments = urlObj.pathname.split('/').filter((s) => s.length > 0);

    const isGitHub = urlObj.hostname.toLowerCase() === 'github.com' || parsed.type === 'github';
    const isGitLab =
      urlObj.hostname.toLowerCase() === 'gitlab.com' ||
      urlObj.hostname.toLowerCase() === 'gitlab.org' ||
      parsed.type === 'gitlab';

    const result = buildNamespaceFromPath(urlObj.hostname, pathSegments, isGitHub, isGitLab);
    return result?.skillSubpath || parsed.subpath;
  } catch {
    // Try SSH format
    const sshMatch = url.match(/^git@([^:]+):(.+)\.git$/);
    if (sshMatch) {
      const hostname = sshMatch[1] || '';
      const pathSegments = sshMatch[2]!.split('/').filter((s) => s.length > 0);
      const isGitHub = hostname.toLowerCase() === 'github.com';
      const isGitLab =
        hostname.toLowerCase() === 'gitlab.com' || hostname.toLowerCase() === 'gitlab.org';

      const result = buildNamespaceFromPath(hostname, pathSegments, isGitHub, isGitLab);
      return result?.skillSubpath;
    }
  }

  return parsed.subpath;
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

  // Exclude GitHub and GitLab repository URLs - they have their own handling
  // (but allow raw.githubusercontent.com if someone wants to use it directly)
  if (input.includes('github.com/') && !input.includes('raw.githubusercontent.com')) {
    // Check if it's a blob/raw URL to SKILL.md (these should be handled by providers)
    // vs a tree/repo URL (these should be cloned)
    if (!input.includes('/blob/') && !input.includes('/raw/')) {
      return false;
    }
  }
  if (input.includes('gitlab.com/') && !input.includes('/-/raw/')) {
    return false;
  }

  return true;
}

/**
 * Parse a source string into a structured format
 * Supports: local paths, GitHub URLs, GitLab URLs, GitHub shorthand, direct skill.md URLs, and direct git URLs
 */
export function parseSource(input: string): ParsedSource {
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

  // Git SSH URL: git@github.com:owner/repo.git or git@gitlab.com:owner/repo.git
  // This handles SSH-style Git URLs for GitHub, GitLab, and other Git hosts
  // Keep SSH protocol for cloning to support SSH key authentication
  const gitSshMatch = input.match(/^git@([^:]+):(.+)\.git$/i);
  if (gitSshMatch) {
    const [, hostname, repoPath] = gitSshMatch;
    if (!hostname || !repoPath) {
      return { type: 'git', url: input };
    }

    // Determine if it's GitHub or GitLab based on hostname
    const isGitHub = hostname.toLowerCase() === 'github.com';
    const isGitLab =
      hostname.toLowerCase() === 'gitlab.com' || hostname.toLowerCase() === 'gitlab.org';

    if (isGitHub || isGitLab) {
      // Parse owner/repo from repoPath (e.g., "owner/repo" or "owner/repo/path/to/skill")
      const repoPathParts = repoPath.split('/');
      const owner = repoPathParts[0];
      const repo = repoPathParts[1] || owner;

      // Keep original SSH URL for cloning, preserving SSH protocol
      if (isGitHub) {
        return {
          type: 'github',
          url: input, // Keep SSH URL: git@github.com:owner/repo.git
        };
      } else if (isGitLab) {
        return {
          type: 'gitlab',
          url: input, // Keep SSH URL: git@gitlab.com:owner/repo.git
        };
      }
    }

    // Other Git hosts with SSH - keep the original SSH URL
    return {
      type: 'git',
      url: input,
    };
  }

  // Direct skill.md URL (non-GitHub/GitLab): https://docs.bun.com/docs/skill.md
  if (isDirectSkillUrl(input)) {
    return {
      type: 'direct-url',
      url: input,
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

  // Private/self-hosted GitLab instances: detect by hostname containing 'gitlab'
  // e.g., https://gitlab.company.com/owner/repo or https://gitlab.company.com.cn/tools/project
  // This pattern handles both 2-level (owner/repo) and multi-level paths
  const privateGitLabMatch = input.match(/^(https?):\/\/([^/]*gitlab[^/]*)\/(.+)$/i);
  if (privateGitLabMatch) {
    const [, protocol, hostname, pathPart] = privateGitLabMatch;
    // Skip if it's github.com
    if (hostname!.toLowerCase() !== 'github.com') {
      // For paths without tree/blob markers, treat as repo URL
      // Support both 2-level (owner/repo) and multi-level paths
      const cleanPath = pathPart!.replace(/\.git$/, '');
      return {
        type: 'gitlab',
        url: `${protocol}://${hostname}/${cleanPath}.git`,
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

  // Other Git hosts (git.example.com, gitea.company.io, etc.)
  // Detect by common service names in hostname
  const gitHostMatch = input.match(
    /^(https?):\/\/((?:git|gitea|gogs|gitblit)[^.]*\.[^/]+)\/(.+)$/i
  );
  if (gitHostMatch) {
    const [, protocol, hostname, pathPart] = gitHostMatch;
    const cleanPath = pathPart!.replace(/\.git$/, '');
    return {
      type: 'git',
      url: `${protocol}://${hostname}/${cleanPath}.git`,
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
