import simpleGit from 'simple-git';
import { join, normalize, resolve, sep } from 'path';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';

const CLONE_TIMEOUT_MS = 60000; // 60 seconds
const LS_REMOTE_TIMEOUT_MS = 15000; // 15 seconds for ls-remote

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

export async function cloneRepo(url: string, ref?: string): Promise<string> {
  const tempDir = await mkdtemp(join(tmpdir(), 'skills-'));
  const git = simpleGit({
    timeout: { block: CLONE_TIMEOUT_MS },
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });
  const cloneOptions = ref ? ['--depth', '1', '--branch', ref] : ['--depth', '1'];

  try {
    await git.clone(url, tempDir, cloneOptions);
    return tempDir;
  } catch (error) {
    // Clean up temp dir on failure
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});

    const errorMessage = error instanceof Error ? error.message : String(error);
    const isTimeout = errorMessage.includes('block timeout') || errorMessage.includes('timed out');
    const isAuthError =
      errorMessage.includes('Authentication failed') ||
      errorMessage.includes('could not read Username') ||
      errorMessage.includes('Permission denied') ||
      errorMessage.includes('Repository not found');

    if (isTimeout) {
      throw new GitCloneError(
        `Clone timed out after 60s. This often happens with private repos that require authentication.\n` +
          `  Ensure you have access and your SSH keys or credentials are configured:\n` +
          `  - For SSH: ssh-add -l (to check loaded keys)\n` +
          `  - For HTTPS: gh auth status (if using GitHub CLI)`,
        url,
        true,
        false
      );
    }

    if (isAuthError) {
      throw new GitCloneError(
        `Authentication failed for ${url}.\n` +
          `  - For private repos, ensure you have access\n` +
          `  - For SSH: Check your keys with 'ssh -T git@github.com'\n` +
          `  - For HTTPS: Run 'gh auth login' or configure git credentials`,
        url,
        false,
        true
      );
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

/**
 * Get the HEAD commit SHA of a remote git repository using `git ls-remote`.
 * This works with any git URL (GitHub, GitLab, self-hosted, SSH, HTTPS).
 *
 * @param url - The git remote URL (e.g., "git@git.example.com:owner/repo.git")
 * @param ref - Optional ref to check (defaults to "HEAD")
 * @returns The commit SHA string, or null if unable to fetch
 */
export async function getRemoteHeadCommit(url: string, ref?: string): Promise<string | null> {
  const git = simpleGit({
    timeout: { block: LS_REMOTE_TIMEOUT_MS },
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });

  try {
    const result = await git.listRemote([url, ref || 'HEAD']);
    const sha = result.trim().split(/\s+/)[0];
    if (sha && /^[0-9a-f]{40}$/i.test(sha)) {
      return sha;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Get the HEAD commit SHA of a local git repository clone.
 *
 * @param repoDir - Path to the cloned repository directory
 * @returns The commit SHA string, or null if not a git repo or unable to read
 */
export async function getLocalHeadCommit(repoDir: string): Promise<string | null> {
  const git = simpleGit(repoDir);
  try {
    const result = await git.revparse(['HEAD']);
    const sha = result.trim();
    if (sha && /^[0-9a-f]{40}$/i.test(sha)) {
      return sha;
    }
    return null;
  } catch {
    return null;
  }
}
