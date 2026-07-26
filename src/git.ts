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
  const git = simpleGit({
    timeout: { block: CLONE_TIMEOUT_MS },
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: '0',
      // When git-lfs IS installed, tell it not to download LFS content
      // during checkout. See #952 for context and empirical impact.
      GIT_LFS_SKIP_SMUDGE: '1',
    },
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
