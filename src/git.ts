import simpleGit from 'simple-git';
import { join, normalize, resolve, sep } from 'path';
import { mkdtemp, mkdir, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { isGitHubHost } from './github-host.ts';

const DEFAULT_CLONE_TIMEOUT_MS = 300_000; // 5 minutes
const ALLOWED_GIT_PROTOCOLS = 'https:http:ssh:git:file';
const CLONE_TIMEOUT_MS = (() => {
  const raw = process.env.SKILLS_CLONE_TIMEOUT_MS;
  if (!raw) return DEFAULT_CLONE_TIMEOUT_MS;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_CLONE_TIMEOUT_MS;
})();
const execFileAsync = promisify(execFile);

interface GitHubRepoInfo {
  owner: string;
  repo: string;
  slug: string;
  sshUrl: string;
}

export class GitCloneError extends Error {
  readonly url: string;
  readonly isTimeout: boolean;
  readonly isAuthError: boolean;

  constructor(message: string, url: string, isTimeout = false, isAuthError = false) {
    super(message);
    this.name = 'GitCloneError';
    this.url = url;
    this.isTimeout = isTimeout;
    this.isAuthError = isAuthError;
  }
}

export function parseGitHubRepoUrl(url: string): GitHubRepoInfo | null {
  const sshMatch = url.match(/^git@([^:]+):([^/]+)\/([^/]+?)(?:\.git)?$/i);
  if (sshMatch && isGitHubHost(sshMatch[1]!)) {
    const host = sshMatch[1]!;
    const owner = sshMatch[2]!;
    const repo = sshMatch[3]!;
    return {
      owner,
      repo,
      slug: `${owner}/${repo}`,
      sshUrl: `git@${host}:${owner}/${repo}.git`,
    };
  }

  try {
    const parsed = new URL(url);
    if (!isGitHubHost(parsed.host)) return null;

    const match = parsed.pathname.match(/^\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
    if (!match) return null;

    const owner = match[1]!;
    const repo = match[2]!;
    return {
      owner,
      repo,
      slug: `${owner}/${repo}`,
      sshUrl: `git@${parsed.host}:${owner}/${repo}.git`,
    };
  } catch {
    return null;
  }
}

export function isGitHubHttpsCloneUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && isGitHubHost(parsed.host);
  } catch {
    return false;
  }
}

export function isGitHubSsoAuthError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes('saml sso') ||
    lower.includes('enforced sso') ||
    lower.includes('enabled or enforced saml') ||
    lower.includes('re-authorize the oauth application')
  );
}

function isAuthFailure(message: string): boolean {
  return (
    message.includes('Authentication failed') ||
    message.includes('could not read Username') ||
    message.includes('Permission denied') ||
    message.includes('Repository not found') ||
    message.includes('requested URL returned error: 403') ||
    isGitHubSsoAuthError(message)
  );
}

function createGitClient(sshCommand?: string) {
  const git = simpleGit({
    timeout: { block: CLONE_TIMEOUT_MS },
    // When git-lfs is NOT installed, GIT_LFS_SKIP_SMUDGE has no effect —
    // git sees `filter=lfs` in .gitattributes, tries to run
    // `git-lfs filter-process`, and aborts the checkout with:
    //   git-lfs filter-process: git-lfs: command not found
    //   fatal: the remote end hung up unexpectedly
    //   warning: Clone succeeded, but checkout failed.
    // Overriding filter.lfs.* at the command level disables the filter
    // entirely for this clone, so checkout succeeds regardless of whether
    // git-lfs is installed. LFS-tracked files are left as ~130-byte
    // pointer files, which the skills installer doesn't read anyway
    // (skills are plain text — HTML/MD/JSON — never LFS-tracked).
    //
    // Reported downstream: heygen-com/hyperframes#407.
    config: [
      'filter.lfs.required=false',
      'filter.lfs.smudge=',
      'filter.lfs.clean=',
      'filter.lfs.process=',
    ],
    // simple-git v3.36+ rejects all `filter.*` configuration by default.
    // These values are hard-coded above and only disable the LFS filter for
    // this clone; no caller-controlled filter command is ever allowed.
    //
    // Calling `.env()` below replaces simple-git's normally inherited process
    // environment. Preserve that existing Git behavior for credentials,
    // configuration, SSH, proxies, editors, pagers, and related tooling. These
    // allowances apply only to trusted environment variables already controlled
    // by the caller (plus the hard-coded SSH fallback). This client is used only
    // for clone with fixed options; the clone URL and ref cannot configure them.
    unsafe: {
      allowUnsafeAlias: true,
      allowUnsafeAskPass: true,
      allowUnsafeConfigEnvCount: true,
      allowUnsafeConfigPaths: true,
      allowUnsafeCredentialHelper: true,
      allowUnsafeDiffExternal: true,
      allowUnsafeDiffTextConv: true,
      allowUnsafeEditor: true,
      allowUnsafeFilter: true,
      allowUnsafeFsMonitor: true,
      allowUnsafeGpgProgram: true,
      allowUnsafeGitProxy: true,
      allowUnsafeHooksPath: true,
      allowUnsafeMergeDriver: true,
      allowUnsafePack: true,
      allowUnsafePager: true,
      allowUnsafeProtocolOverride: true,
      allowUnsafeSshCommand: true,
      allowUnsafeTemplateDir: true,
    },
  });

  git.env({
    ...process.env,
    GIT_TERMINAL_PROMPT: '0',
    GIT_ALLOW_PROTOCOL: ALLOWED_GIT_PROTOCOLS,
    // When git-lfs IS installed, tell it not to download LFS content
    // during checkout. See #952 for context and empirical impact.
    GIT_LFS_SKIP_SMUDGE: '1',
    ...(sshCommand ? { GIT_SSH_COMMAND: sshCommand } : {}),
  });

  return git;
}

async function resetTempDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true }).catch(() => {});
  await mkdir(dir, { recursive: true });
}

async function tryGhClone(repo: GitHubRepoInfo, tempDir: string, ref?: string): Promise<boolean> {
  let cloneTarget = repo.slug;
  const host = repo.sshUrl.match(/^git@([^:]+):/)?.[1] || 'github.com';

  try {
    const { stdout, stderr } = await execFileAsync('gh', ['auth', 'status', '-h', host], {
      timeout: 5000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
    const statusOutput = `${stdout}${stderr}`;
    if (/Git operations protocol:\s+ssh/i.test(statusOutput)) {
      cloneTarget = repo.sshUrl;
    }
  } catch {
    return false;
  }

  const gitFlags = ref ? ['--depth=1', '--branch', ref] : ['--depth=1'];
  await execFileAsync('gh', ['repo', 'clone', cloneTarget, tempDir, '--', ...gitFlags], {
    timeout: CLONE_TIMEOUT_MS,
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: '0',
      GIT_ALLOW_PROTOCOL: ALLOWED_GIT_PROTOCOLS,
    },
  });
  return true;
}

function buildGitHubAuthError(url: string, repo: GitHubRepoInfo | null, message: string): string {
  const host = repo?.sshUrl.match(/^git@([^:]+):/)?.[1] || 'github.com';
  if (repo && isGitHubSsoAuthError(message)) {
    return (
      `GitHub blocked HTTPS access to ${url} because the organization enforces SAML SSO.\n` +
      `  skills tried your existing git credentials and available fallbacks, but none succeeded.\n` +
      `  - Re-authorize your GitHub credentials/app for that org's SSO policy\n` +
      `  - Or rerun with SSH: npx skills add ${repo.sshUrl}\n` +
      `  - Verify access with: gh auth status -h ${host} or ssh -T git@${host}`
    );
  }

  if (repo) {
    return (
      `Authentication failed for ${url}.\n` +
      `  - For private repos, ensure you have access\n` +
      `  - Retry with SSH: npx skills add ${repo.sshUrl}\n` +
      `  - Check access with: gh auth status -h ${host} or ssh -T git@${host}`
    );
  }

  return (
    `Authentication failed for ${url}.\n` +
    `  - For private repos, ensure you have access\n` +
    `  - For SSH: Check your keys with 'ssh -T git@github.com'\n` +
    `  - For HTTPS: Run 'gh auth login' or configure git credentials`
  );
}

export async function cloneRepo(url: string, ref?: string): Promise<string> {
  if (/^ext::/i.test(url)) {
    throw new GitCloneError('Unsupported Git transport: ext', url);
  }

  const tempDir = await mkdtemp(join(tmpdir(), 'skills-'));
  const cloneOptions = ref ? ['--depth', '1', '--branch', ref] : ['--depth', '1'];
  const repo = parseGitHubRepoUrl(url);

  try {
    await createGitClient().clone(url, tempDir, cloneOptions);
    return tempDir;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const isTimeout = errorMessage.includes('block timeout') || errorMessage.includes('timed out');
    const isAuthError = isAuthFailure(errorMessage);

    if (isTimeout) {
      await rm(tempDir, { recursive: true, force: true }).catch(() => {});
      const seconds = Math.round(CLONE_TIMEOUT_MS / 1000);
      throw new GitCloneError(
        `Clone timed out after ${seconds}s. Common causes:\n` +
          `  - Large repository: raise the timeout with SKILLS_CLONE_TIMEOUT_MS=600000 (10m)\n` +
          `  - Slow network: retry, or clone manually and pass the local path to 'skills add'\n` +
          `  - Private repo without credentials: ensure auth is configured\n` +
          `      - For SSH: ssh-add -l (to check loaded keys)\n` +
          `      - For HTTPS: gh auth status (if using GitHub CLI)`,
        url,
        true,
        false
      );
    }

    if (isAuthError && repo && isGitHubHttpsCloneUrl(url)) {
      try {
        await resetTempDir(tempDir);
        if (await tryGhClone(repo, tempDir, ref)) {
          return tempDir;
        }
      } catch {
        // Fall through to SSH retry.
      }

      try {
        await resetTempDir(tempDir);
        await createGitClient(process.env.GIT_SSH_COMMAND ?? 'ssh -o BatchMode=yes').clone(
          repo.sshUrl,
          tempDir,
          cloneOptions
        );
        return tempDir;
      } catch {
        // Fall through to the targeted auth error below.
      }
    }

    await rm(tempDir, { recursive: true, force: true }).catch(() => {});

    if (isAuthError) {
      throw new GitCloneError(buildGitHubAuthError(url, repo, errorMessage), url, false, true);
    }

    throw new GitCloneError(`Failed to clone ${url}: ${errorMessage}`, url, false, false);
  }
}

export async function cleanupTempDir(dir: string): Promise<void> {
  // Validate that the directory path is within tmpdir to prevent deletion of arbitrary paths
  const normalizedDir = normalize(resolve(dir));
  const normalizedTmpDir = normalize(resolve(tmpdir()));

  if (!normalizedDir.startsWith(normalizedTmpDir + sep) && normalizedDir !== normalizedTmpDir) {
    throw new Error('Attempted to clean up directory outside of temp directory');
  }

  await rm(dir, { recursive: true, force: true });
}
