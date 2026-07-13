import { isAbsolute, resolve } from 'path';
import type { ParsedSource } from './types.ts';

/** The set of source types that can be forced via `--source-type`. */
export type SourceType = ParsedSource['type'];

export const SOURCE_TYPES: readonly SourceType[] = [
  'github',
  'gitlab',
  'azure',
  'git',
  'local',
  'well-known',
];

/** Type guard for validating a user-supplied `--source-type` value. */
export function isSourceType(value: string): value is SourceType {
  return (SOURCE_TYPES as readonly string[]).includes(value);
}

interface ParseSourceOptions {
  /**
   * Force the parsed source to a specific type instead of auto-detecting it.
   * Useful for self-hosted or otherwise unrecognized Git hosts.
   */
  sourceType?: SourceType;
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

  // Azure DevOps URLs use an `{org}/{project}/_git/{repo}` structure, so derive
  // a clean `org/repo` identifier rather than the raw path.
  if (parsed.type === 'azure') {
    return parseAzureDevOpsUrl(parsed.url)?.ownerRepo ?? null;
  }

  // Handle Git SSH URLs (e.g., git@gitlab.com:owner/repo.git, git@github.com:owner/repo.git)
  const sshMatch = parsed.url.match(/^git@[^:]+:(.+)$/);
  if (sshMatch) {
    let path = sshMatch[1]!;
    path = path.replace(/\.git$/, '');

    // Must have at least owner/repo (one slash)
    if (path.includes('/')) {
      return path;
    }
    return null;
  }

  // Handle SSH URLs with a scheme (e.g., ssh://git@host:7999/owner/repo.git)
  if (parsed.url.startsWith('ssh://')) {
    try {
      const url = new URL(parsed.url);
      let path = url.pathname.slice(1);
      path = path.replace(/\.git$/, '');

      if (path.includes('/')) {
        return path;
      }
      return null;
    } catch {
      return null;
    }
  }

  // Handle HTTP(S) URLs
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
 * Sanitizes a subpath to prevent path traversal attacks.
 * Rejects subpaths containing ".." segments that could escape the repository root.
 * Returns the sanitized subpath, or throws if the subpath is unsafe.
 */
export function sanitizeSubpath(subpath: string): string {
  // Normalize to forward slashes for consistent handling
  const normalized = subpath.replace(/\\/g, '/');

  // Check each segment for ".."
  const segments = normalized.split('/');
  for (const segment of segments) {
    if (segment === '..') {
      throw new Error(
        `Unsafe subpath: "${subpath}" contains path traversal segments. ` +
          `Subpaths must not contain ".." components.`
      );
    }
  }

  return subpath;
}

/**
 * Whether a hostname belongs to Azure DevOps (either the modern
 * `dev.azure.com` host or the legacy `<account>.visualstudio.com` hosts).
 */
function isAzureDevOpsHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  return lower === 'dev.azure.com' || lower.endsWith('.visualstudio.com');
}

interface AzureDevOpsParseResult {
  /** Normalized clone URL (query/fragment stripped). */
  url: string;
  /** Branch or tag resolved from `?version=GB…/GT…`. */
  ref?: string;
  /** Subpath resolved from `?path=…`. */
  subpath?: string;
  /** `org/repo` identifier for telemetry and lock tracking. */
  ownerRepo?: string;
}

/**
 * Parse an Azure DevOps repository URL.
 *
 * Recognizes:
 *   - HTTPS: https://[user@]dev.azure.com/{org}/{project}/_git/{repo}
 *   - Legacy HTTPS: https://{account}.visualstudio.com/[{collection}/]{project}/_git/{repo}
 *   - SSH: git@ssh.dev.azure.com:v3/{org}/{project}/{repo}
 *
 * The identifying marker for HTTPS URLs is the `/_git/` path segment. Azure
 * encodes the target folder and branch as query parameters
 * (`?path=/dir&version=GBmain`), which are lifted into `subpath` and `ref`.
 *
 * Returns null when the input is not a recognizable Azure DevOps repo URL.
 */
function parseAzureDevOpsUrl(input: string): AzureDevOpsParseResult | null {
  // SSH form: git@ssh.dev.azure.com:v3/{org}/{project}/{repo}
  const sshMatch = input.match(/^git@ssh\.dev\.azure\.com:v3\/(.+)$/i);
  if (sshMatch) {
    const segments = sshMatch[1]!
      .replace(/\.git$/, '')
      .split('/')
      .filter(Boolean);
    // Need at least {org}/{repo}; canonical form is {org}/{project}/{repo}.
    if (segments.length < 2) {
      return null;
    }
    const org = segments[0]!;
    const repo = segments[segments.length - 1]!;
    return {
      url: `git@ssh.dev.azure.com:v3/${segments.join('/')}`,
      ownerRepo: `${org}/${repo}`,
    };
  }

  if (!/^https?:\/\//i.test(input)) {
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    return null;
  }

  if (!isAzureDevOpsHost(parsed.hostname)) {
    return null;
  }

  // Keep the raw (percent-encoded) segments so the clone URL preserves any
  // encoding in project names (e.g. spaces -> %20).
  const encodedSegments = parsed.pathname.split('/').filter(Boolean);
  const gitIndex = encodedSegments.findIndex((seg) => seg.toLowerCase() === '_git');
  // Require at least one segment before `_git` (the org/project) and a repo after it.
  if (gitIndex < 1 || gitIndex >= encodedSegments.length - 1) {
    return null;
  }

  const repoSegment = encodedSegments[gitIndex + 1]!.replace(/\.git$/, '');
  if (!repoSegment) {
    return null;
  }

  const auth = parsed.username ? `${parsed.username}@` : '';
  const pathToRepo = [...encodedSegments.slice(0, gitIndex), '_git', repoSegment].join('/');
  const cloneUrl = `${parsed.protocol}//${auth}${parsed.host}/${pathToRepo}`;

  // org is the first path segment for dev.azure.com; for *.visualstudio.com the
  // account lives in the subdomain but the first path segment (project) is a
  // reasonable, stable identifier for telemetry/lock purposes.
  const org = decodeAzureComponent(encodedSegments[0]!);
  const repo = decodeAzureComponent(repoSegment);

  let ref: string | undefined;
  const version = parsed.searchParams.get('version');
  if (version) {
    const prefix = version.slice(0, 2).toUpperCase();
    const value = version.slice(2);
    // GB = branch, GT = tag. GC (commit) is skipped: a commit SHA can't be
    // used with `git clone --branch --depth 1`.
    if ((prefix === 'GB' || prefix === 'GT') && value) {
      ref = value;
    }
  }

  let subpath: string | undefined;
  const pathParam = parsed.searchParams.get('path');
  if (pathParam) {
    const trimmed = pathParam.replace(/^\/+/, '').replace(/\/+$/, '');
    if (trimmed) {
      subpath = sanitizeSubpath(trimmed);
    }
  }

  return {
    url: cloneUrl,
    ownerRepo: `${org}/${repo}`,
    ...(ref ? { ref } : {}),
    ...(subpath ? { subpath } : {}),
  };
}

function decodeAzureComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
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
 * Parse a source string into a structured format
 * Supports: local paths, GitHub URLs, GitLab URLs, GitHub shorthand, well-known URLs, and direct git URLs
 */
// Source aliases: map common shorthand to canonical source
const SOURCE_ALIASES: Record<string, string> = {
  'coinbase/agentWallet': 'coinbase/agentic-wallet-skills',
};

interface FragmentRefResult {
  inputWithoutFragment: string;
  ref?: string;
  skillFilter?: string;
}

function decodeFragmentValue(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function looksLikeGitSource(input: string): boolean {
  if (input.startsWith('github:') || input.startsWith('gitlab:') || input.startsWith('git@')) {
    return true;
  }

  if (/^ssh:\/\/.+\.git(?:$|[/?])/i.test(input)) {
    return true;
  }

  if (input.startsWith('http://') || input.startsWith('https://')) {
    try {
      const parsed = new URL(input);
      const pathname = parsed.pathname;

      // Only treat GitHub fragments as refs for repo/tree URLs.
      if (parsed.hostname === 'github.com') {
        return /^\/[^/]+\/[^/]+(?:\.git)?(?:\/tree\/[^/]+(?:\/.*)?)?\/?$/.test(pathname);
      }

      // Only treat gitlab.com fragments as refs for repo/tree URLs.
      if (parsed.hostname === 'gitlab.com') {
        return /^\/.+?\/[^/]+(?:\.git)?(?:\/-\/tree\/[^/]+(?:\/.*)?)?\/?$/.test(pathname);
      }

      // Azure DevOps repo URLs are identified by the `/_git/` path segment.
      if (isAzureDevOpsHost(parsed.hostname)) {
        return pathname.includes('/_git/');
      }
    } catch {
      // Fall through to generic checks below.
    }
  }

  if (/^https?:\/\/.+\.git(?:$|[/?])/i.test(input)) {
    return true;
  }

  return (
    !input.includes(':') &&
    !input.startsWith('.') &&
    !input.startsWith('/') &&
    /^([^/]+)\/([^/]+)(?:\/(.+)|@(.+))?$/.test(input)
  );
}

/**
 * Split an optional `#ref` / `#ref@skill` fragment from an input,
 * unconditionally (used when the caller already knows the source is git-backed,
 * e.g. via an explicit `--source-type`).
 */
function splitFragmentRef(input: string): FragmentRefResult {
  const hashIndex = input.indexOf('#');
  if (hashIndex < 0) {
    return { inputWithoutFragment: input };
  }

  const inputWithoutFragment = input.slice(0, hashIndex);
  const fragment = input.slice(hashIndex + 1);
  if (!fragment) {
    return { inputWithoutFragment: input };
  }

  const atIndex = fragment.indexOf('@');
  if (atIndex === -1) {
    return {
      inputWithoutFragment,
      ref: decodeFragmentValue(fragment),
    };
  }

  const ref = fragment.slice(0, atIndex);
  const skillFilter = fragment.slice(atIndex + 1);
  return {
    inputWithoutFragment,
    ref: ref ? decodeFragmentValue(ref) : undefined,
    skillFilter: skillFilter ? decodeFragmentValue(skillFilter) : undefined,
  };
}

function parseFragmentRef(input: string): FragmentRefResult {
  const hashIndex = input.indexOf('#');
  if (hashIndex < 0) {
    return { inputWithoutFragment: input };
  }

  const inputWithoutFragment = input.slice(0, hashIndex);
  const fragment = input.slice(hashIndex + 1);

  // Treat URL fragments as git refs only for git-like sources.
  // This avoids changing behavior for generic well-known URLs.
  if (!fragment || !looksLikeGitSource(inputWithoutFragment)) {
    return { inputWithoutFragment: input };
  }

  return splitFragmentRef(input);
}

function appendFragmentRef(input: string, ref?: string, skillFilter?: string): string {
  if (!ref) {
    return input;
  }
  return `${input}#${ref}${skillFilter ? `@${skillFilter}` : ''}`;
}

export function parseSource(input: string, options: ParseSourceOptions = {}): ParsedSource {
  // An explicit `--source-type` overrides auto-detection.
  if (options.sourceType) {
    return parseForcedSource(input, options.sourceType);
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

  const {
    inputWithoutFragment,
    ref: fragmentRef,
    skillFilter: fragmentSkillFilter,
  } = parseFragmentRef(input);
  input = inputWithoutFragment;

  // Resolve source aliases before parsing
  const alias = SOURCE_ALIASES[input];
  if (alias) {
    input = alias;
  }

  // Prefix shorthand: github:owner/repo -> owner/repo (handled by existing shorthand logic)
  // Also supports github:owner/repo/subpath and github:owner/repo@skill
  const githubPrefixMatch = input.match(/^github:(.+)$/);
  if (githubPrefixMatch) {
    return parseSource(appendFragmentRef(githubPrefixMatch[1]!, fragmentRef, fragmentSkillFilter));
  }

  // Prefix shorthand: gitlab:owner/repo -> https://gitlab.com/owner/repo
  const gitlabPrefixMatch = input.match(/^gitlab:(.+)$/);
  if (gitlabPrefixMatch) {
    return parseSource(
      appendFragmentRef(
        `https://gitlab.com/${gitlabPrefixMatch[1]!}`,
        fragmentRef,
        fragmentSkillFilter
      )
    );
  }

  // GitHub URL with path: https://github.com/owner/repo/tree/branch/path/to/skill
  const githubTreeWithPathMatch = input.match(/github\.com\/([^/]+)\/([^/]+)\/tree\/([^/]+)\/(.+)/);
  if (githubTreeWithPathMatch) {
    const [, owner, repo, ref, subpath] = githubTreeWithPathMatch;
    return {
      type: 'github',
      url: `https://github.com/${owner}/${repo}.git`,
      ref: ref || fragmentRef,
      subpath: subpath ? sanitizeSubpath(subpath) : subpath,
    };
  }

  // GitHub URL with branch only: https://github.com/owner/repo/tree/branch
  const githubTreeMatch = input.match(/github\.com\/([^/]+)\/([^/]+)\/tree\/([^/]+)$/);
  if (githubTreeMatch) {
    const [, owner, repo, ref] = githubTreeMatch;
    return {
      type: 'github',
      url: `https://github.com/${owner}/${repo}.git`,
      ref: ref || fragmentRef,
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
      ...(fragmentRef ? { ref: fragmentRef } : {}),
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
        ref: ref || fragmentRef,
        subpath: subpath ? sanitizeSubpath(subpath) : subpath,
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
        ref: ref || fragmentRef,
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
        ...(fragmentRef ? { ref: fragmentRef } : {}),
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
      ...(fragmentRef ? { ref: fragmentRef } : {}),
      skillFilter: fragmentSkillFilter || skillFilter,
    };
  }

  const shorthandMatch = input.match(/^([^/]+)\/([^/]+)(?:\/(.+?))?\/?$/);
  if (shorthandMatch && !input.includes(':') && !input.startsWith('.') && !input.startsWith('/')) {
    const [, owner, repo, subpath] = shorthandMatch;
    return {
      type: 'github',
      url: `https://github.com/${owner}/${repo}.git`,
      ...(fragmentRef ? { ref: fragmentRef } : {}),
      subpath: subpath ? sanitizeSubpath(subpath) : subpath,
      ...(fragmentSkillFilter ? { skillFilter: fragmentSkillFilter } : {}),
    };
  }

  // Azure DevOps URL: https://[user@]dev.azure.com/{org}/{project}/_git/{repo}
  // (also *.visualstudio.com and the SSH v3 form). Identified by the `/_git/`
  // path segment. Must be checked before the well-known fallback so these
  // repositories aren't misread as generic well-known endpoints.
  const azureParsed = parseAzureDevOpsUrl(input);
  if (azureParsed) {
    return {
      type: 'azure',
      url: azureParsed.url,
      ...(azureParsed.ref || fragmentRef ? { ref: azureParsed.ref || fragmentRef } : {}),
      ...(azureParsed.subpath ? { subpath: azureParsed.subpath } : {}),
      ...(fragmentSkillFilter ? { skillFilter: fragmentSkillFilter } : {}),
    };
  }

  // Well-known skills: arbitrary HTTP(S) URLs that aren't GitHub/GitLab
  // This is the final fallback for URLs - we'll check for /.well-known/agent-skills/index.json
  // then fall back to /.well-known/skills/index.json
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
    ...(fragmentRef ? { ref: fragmentRef } : {}),
  };
}

/**
 * Parse a source with an explicit, user-supplied type (`--source-type`),
 * bypassing host-based auto-detection.
 *
 * For the Git-backed types we still reuse the normal parser to normalize the
 * URL (e.g. GitHub tree paths, GitLab subgroups, Azure `?path=`/`?version=`),
 * then stamp the requested type. When the host isn't recognized, the input is
 * treated as a direct clone URL so unrecognized/self-hosted Git servers work.
 */
function parseForcedSource(input: string, type: SourceType): ParsedSource {
  if (type === 'local') {
    const resolvedPath = resolve(input);
    return { type: 'local', url: resolvedPath, localPath: resolvedPath };
  }

  if (type === 'well-known') {
    return { type: 'well-known', url: input };
  }

  // Git-backed types: peel off an optional #ref / #ref@skill fragment.
  const { inputWithoutFragment, ref, skillFilter } = splitFragmentRef(input);

  if (type === 'azure') {
    const azure = parseAzureDevOpsUrl(inputWithoutFragment);
    const resolvedRef = azure?.ref || ref;
    const resolvedSubpath = azure?.subpath;
    return {
      type: 'azure',
      url: azure?.url ?? inputWithoutFragment,
      ...(resolvedRef ? { ref: resolvedRef } : {}),
      ...(resolvedSubpath ? { subpath: resolvedSubpath } : {}),
      ...(skillFilter ? { skillFilter } : {}),
    };
  }

  // github / gitlab / git: reuse auto-detection to normalize the URL when it's
  // a recognizable host, otherwise fall back to a direct clone URL.
  const detected = parseSource(inputWithoutFragment);
  if (detected.type !== 'local' && detected.type !== 'well-known') {
    const resolvedRef = detected.ref ?? ref;
    const resolvedSkill = skillFilter ?? detected.skillFilter;
    return {
      ...detected,
      type,
      ...(resolvedRef ? { ref: resolvedRef } : {}),
      ...(resolvedSkill ? { skillFilter: resolvedSkill } : {}),
    };
  }

  return {
    type,
    url: inputWithoutFragment,
    ...(ref ? { ref } : {}),
    ...(skillFilter ? { skillFilter } : {}),
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
    const excludedHosts = ['github.com', 'gitlab.com', 'raw.githubusercontent.com'];
    if (excludedHosts.includes(parsed.hostname)) {
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
