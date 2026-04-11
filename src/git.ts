import simpleGit from 'simple-git';
import { join, normalize, resolve, sep } from 'path';
import { mkdtemp, mkdir, rm } from 'fs/promises';
import { existsSync } from 'fs';
import { tmpdir } from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';

const DEFAULT_CLONE_TIMEOUT_MS = 300_000; // 5 minutes
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

interface SshCloneInfo {
  host: string;
  user: string;
}

interface SshHostConfig {
  identitiesOnly: boolean;
  identityFiles: string[];
}

interface SshPassphrasePromptIssue {
  host: string;
  identityFile: string;
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

export function parseSshCloneUrl(url: string): SshCloneInfo | null {
  const scpStyleMatch = url.match(/^([^@]+)@([^:]+):(.+)$/);
  if (scpStyleMatch) {
    return {
      user: scpStyleMatch[1]!,
      host: scpStyleMatch[2]!,
    };
  }

  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'ssh:' || !parsed.hostname) return null;
    return {
      user: parsed.username || 'git',
      host: parsed.hostname,
    };
  } catch {
    return null;
  }
}

export function parseGitHubRepoUrl(url: string): GitHubRepoInfo | null {
  const sshMatch = url.match(/^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/i);
  if (sshMatch) {
    const owner = sshMatch[1]!;
    const repo = sshMatch[2]!;
    return {
      owner,
      repo,
      slug: `${owner}/${repo}`,
      sshUrl: `git@github.com:${owner}/${repo}.git`,
    };
  }

  try {
    const parsed = new URL(url);
    if (parsed.hostname !== 'github.com') return null;

    const match = parsed.pathname.match(/^\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
    if (!match) return null;

    const owner = match[1]!;
    const repo = match[2]!;
    return {
      owner,
      repo,
      slug: `${owner}/${repo}`,
      sshUrl: `git@github.com:${owner}/${repo}.git`,
    };
  } catch {
    return null;
  }
}

export function isGitHubHttpsCloneUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && parsed.hostname === 'github.com';
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

function createGitClient(extraEnv?: NodeJS.ProcessEnv) {
  return simpleGit({
    timeout: { block: CLONE_TIMEOUT_MS },
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: '0',
      // When git-lfs IS installed, tell it not to download LFS content
      // during checkout. See #952 for context and empirical impact.
      GIT_LFS_SKIP_SMUDGE: '1',
      ...extraEnv,
    },
    // When git-lfs is NOT installed, GIT_LFS_SKIP_SMUDGE has no effect -
    // git sees `filter=lfs` in .gitattributes, tries to run
    // `git-lfs filter-process`, and aborts the checkout with:
    //   git-lfs filter-process: git-lfs: command not found
    //   fatal: the remote end hung up unexpectedly
    //   warning: Clone succeeded, but checkout failed.
    // Overriding filter.lfs.* at the command level disables the filter
    // entirely for this clone, so checkout succeeds regardless of whether
    // git-lfs is installed. LFS-tracked files are left as ~130-byte
    // pointer files, which the skills installer doesn't read anyway
    // (skills are plain text - HTML/MD/JSON - never LFS-tracked).
    //
    // Reported downstream: heygen-com/hyperframes#407.
    config: [
      'filter.lfs.required=false',
      'filter.lfs.smudge=',
      'filter.lfs.clean=',
      'filter.lfs.process=',
    ],
  });
}

async function getSshHostConfig(host: string): Promise<SshHostConfig | null> {
  try {
    const { stdout } = await execFileAsync('ssh', ['-G', host], {
      timeout: 5000,
      env: process.env,
    });

    const config: SshHostConfig = {
      identitiesOnly: false,
      identityFiles: [],
    };

    for (const rawLine of stdout.split('\n')) {
      const line = rawLine.trim();
      if (!line) continue;

      if (line.startsWith('identitiesonly ')) {
        config.identitiesOnly = line.slice('identitiesonly '.length).trim() === 'yes';
      } else if (line.startsWith('identityfile ')) {
        config.identityFiles.push(line.slice('identityfile '.length).trim());
      }
    }

    return config;
  } catch {
    return null;
  }
}

async function isPassphraseProtectedKey(identityFile: string): Promise<boolean | null> {
  if (!existsSync(identityFile)) {
    return null;
  }

  try {
    await execFileAsync('ssh-keygen', ['-y', '-P', '', '-f', identityFile], {
      timeout: 5000,
      env: process.env,
    });
    return false;
  } catch (error) {
    const message =
      error && typeof error === 'object' && 'stderr' in error
        ? String((error as { stderr?: string }).stderr || '')
        : '';
    const combined = message.toLowerCase();

    if (
      combined.includes('incorrect passphrase') ||
      combined.includes('bad passphrase') ||
      combined.includes('passphrase')
    ) {
      return true;
    }

    return null;
  }
}

async function isIdentityUsableThroughAgent(identityFile: string): Promise<boolean | null> {
  const publicKeyPath = `${identityFile}.pub`;
  if (!existsSync(publicKeyPath)) {
    return null;
  }

  try {
    await execFileAsync('ssh-add', ['-T', publicKeyPath], {
      timeout: 5000,
      env: process.env,
    });
    return true;
  } catch {
    return false;
  }
}

export async function detectSshPassphrasePromptIssue(
  url: string
): Promise<SshPassphrasePromptIssue | null> {
  const sshClone = parseSshCloneUrl(url);
  if (!sshClone) return null;

  const config = await getSshHostConfig(sshClone.host);
  if (!config || !config.identitiesOnly || config.identityFiles.length === 0) {
    return null;
  }

  for (const identityFile of config.identityFiles) {
    const isProtected = await isPassphraseProtectedKey(identityFile);
    if (isProtected !== true) continue;

    const agentUsable = await isIdentityUsableThroughAgent(identityFile);
    if (agentUsable === false) {
      return {
        host: sshClone.host,
        identityFile,
      };
    }
  }

  return null;
}

async function resetTempDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true }).catch(() => {});
  await mkdir(dir, { recursive: true });
}

async function tryGhClone(repo: GitHubRepoInfo, tempDir: string, ref?: string): Promise<boolean> {
  let cloneTarget = repo.slug;

  try {
    const { stdout, stderr } = await execFileAsync('gh', ['auth', 'status', '-h', 'github.com'], {
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
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });
  return true;
}

function buildGitHubAuthError(url: string, repo: GitHubRepoInfo | null, message: string): string {
  if (repo && isGitHubSsoAuthError(message)) {
    return (
      `GitHub blocked HTTPS access to ${url} because the organization enforces SAML SSO.\n` +
      `  skills tried your existing git credentials and available fallbacks, but none succeeded.\n` +
      `  - Re-authorize your GitHub credentials/app for that org's SSO policy\n` +
      `  - Or rerun with SSH: npx skills add ${repo.sshUrl}\n` +
      `  - Verify access with: gh auth status -h github.com or ssh -T git@github.com`
    );
  }

  if (repo) {
    return (
      `Authentication failed for ${url}.\n` +
      `  - For private repos, ensure you have access\n` +
      `  - Retry with SSH: npx skills add ${repo.sshUrl}\n` +
      `  - Check access with: gh auth status -h github.com or ssh -T git@github.com`
    );
  }

  return (
    `Authentication failed for ${url}.\n` +
    `  - For private repos, ensure you have access\n` +
    `  - For SSH: Check your keys with 'ssh -T git@github.com'\n` +
    `  - For HTTPS: Run 'gh auth login' or configure git credentials`
  );
}

function buildSshPassphrasePromptError(
  url: string,
  issue: SshPassphrasePromptIssue,
  interactive: boolean
): string {
  if (interactive) {
    return (
      `SSH clone for ${url} requires unlocking the passphrase-protected key ${issue.identityFile}, ` +
      `but the current clone flow does not allow SSH to prompt for that passphrase.\n` +
      `  - Load the key first: ssh-add ${issue.identityFile}\n` +
      `  - Then rerun: npx skills add --list ${url}\n` +
      `  - Host alias involved: ${issue.host}`
    );
  }

  return (
    `SSH clone for ${url} requires unlocking the passphrase-protected key ${issue.identityFile}, ` +
    `but this session is non-interactive and cannot prompt for that passphrase.\n` +
    `  - Load the key first: ssh-add ${issue.identityFile}\n` +
    `  - Then rerun: npx skills add --list ${url}\n` +
    `  - Host alias involved: ${issue.host}`
  );
}

export async function cloneRepo(url: string, ref?: string): Promise<string> {
  const tempDir = await mkdtemp(join(tmpdir(), 'skills-'));
  const cloneOptions = ref ? ['--depth', '1', '--branch', ref] : ['--depth', '1'];
  const repo = parseGitHubRepoUrl(url);

  try {
    const sshPromptIssue = await detectSshPassphrasePromptIssue(url);
    if (sshPromptIssue) {
      await rm(tempDir, { recursive: true, force: true }).catch(() => {});
      throw new GitCloneError(
        buildSshPassphrasePromptError(url, sshPromptIssue, !!process.stdin.isTTY),
        url,
        false,
        true
      );
    }

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
        await createGitClient({
          GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND ?? 'ssh -o BatchMode=yes',
        }).clone(repo.sshUrl, tempDir, cloneOptions);
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
