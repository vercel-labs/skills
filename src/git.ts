import simpleGit from 'simple-git';
import { join, normalize, resolve, sep } from 'path';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';

const DEFAULT_CLONE_TIMEOUT_MS = 300_000; // 5 minutes
const CLONE_TIMEOUT_MS = (() => {
  const raw = process.env.SKILLS_CLONE_TIMEOUT_MS;
  if (!raw) return DEFAULT_CLONE_TIMEOUT_MS;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_CLONE_TIMEOUT_MS;
})();

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
  const baseOptions = {
    timeout: { block: CLONE_TIMEOUT_MS },
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: '0',
      GIT_LFS_SKIP_SMUDGE: '1',
    },
  };

  // LFS filter overrides for systems where git-lfs is not installed.
  // Some git configurations block filter config overrides (allowUnsafeFilter),
  // so we try without them first and fall back to overrides only if needed.
  const lfsFilterConfig = [
    'filter.lfs.required=false',
    'filter.lfs.smudge=',
    'filter.lfs.clean=',
    'filter.lfs.process=',
  ];

  const cloneOptions = ref ? ['--depth', '1', '--branch', ref] : ['--depth', '1'];

  try {
    const git = simpleGit(baseOptions);
    await git.clone(url, tempDir, cloneOptions);
    return tempDir;
  } catch (firstError) {
    const firstMessage = firstError instanceof Error ? firstError.message : String(firstError);

    // If checkout failed due to missing git-lfs, retry with filter overrides
    if (
      firstMessage.includes('filter-process') ||
      firstMessage.includes('checkout failed') ||
      firstMessage.includes('filter.lfs')
    ) {
      await rm(tempDir, { recursive: true, force: true }).catch(() => {});
      const retryDir = await mkdtemp(join(tmpdir(), 'skills-'));
      try {
        const gitWithLfs = simpleGit({ ...baseOptions, config: lfsFilterConfig });
        await gitWithLfs.clone(url, retryDir, cloneOptions);
        return retryDir;
      } catch (retryError) {
        await rm(retryDir, { recursive: true, force: true }).catch(() => {});
        // Fall through to error handling with the retry error
        const error = retryError;
        const errorMessage = error instanceof Error ? error.message : String(error);
        throw toGitCloneError(url, errorMessage);
      }
    }

    // Clean up temp dir on failure
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    throw toGitCloneError(url, firstMessage);
  }
}

function toGitCloneError(url: string, errorMessage: string): GitCloneError {
  const isTimeout = errorMessage.includes('block timeout') || errorMessage.includes('timed out');
  const isAuthError =
    errorMessage.includes('Authentication failed') ||
    errorMessage.includes('could not read Username') ||
    errorMessage.includes('Permission denied') ||
    errorMessage.includes('Repository not found');

  if (isTimeout) {
    const seconds = Math.round(CLONE_TIMEOUT_MS / 1000);
    return new GitCloneError(
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

  if (isAuthError) {
    return new GitCloneError(
      `Authentication failed for ${url}.\n` +
        `  - For private repos, ensure you have access\n` +
        `  - For SSH: Check your keys with 'ssh -T git@github.com'\n` +
        `  - For HTTPS: Run 'gh auth login' or configure git credentials`,
      url,
      false,
      true
    );
  }

  return new GitCloneError(`Failed to clone ${url}: ${errorMessage}`, url, false, false);
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
