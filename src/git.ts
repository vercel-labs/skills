import simpleGit, { type SimpleGit } from 'simple-git';
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

/**
 * Create a configured simple-git client.
 *
 * Environment is applied via .env() (not the constructor option) so the
 * options object matches SimpleGitOptions.
 *
 * When git-lfs IS installed, GIT_LFS_SKIP_SMUDGE tells it not to download
 * LFS content during checkout. See #952 for context and empirical impact.
 *
 * When git-lfs is NOT installed, GIT_LFS_SKIP_SMUDGE has no effect —
 * git sees `filter=lfs` in .gitattributes, tries to run
 * `git-lfs filter-process`, and aborts the checkout with:
 *   git-lfs filter-process: git-lfs: command not found
 *   fatal: the remote end hung up unexpectedly
 *   warning: Clone succeeded, but checkout failed.
 * Overriding filter.lfs.* at the command level disables the filter
 * entirely, so checkout succeeds regardless of whether git-lfs is
 * installed. LFS-tracked files are left as ~130-byte pointer files,
 * which the skills installer doesn't read anyway (skills are plain
 * text — HTML/MD/JSON — never LFS-tracked).
 *
 * Reported downstream: heygen-com/hyperframes#407.
 */
function gitClient(baseDir?: string): SimpleGit {
  const git = simpleGit({
    ...(baseDir ? { baseDir } : {}),
    timeout: { block: CLONE_TIMEOUT_MS },
    config: [
      'filter.lfs.required=false',
      'filter.lfs.smudge=',
      'filter.lfs.clean=',
      'filter.lfs.process=',
    ],
  });
  return git.env({
    ...process.env,
    GIT_TERMINAL_PROMPT: '0',
    GIT_LFS_SKIP_SMUDGE: '1',
  });
}

/**
 * Classify a clone/checkout failure into a GitCloneError with an actionable message.
 */
function classifyCloneError(error: unknown, url: string): GitCloneError {
  const errorMessage = error instanceof Error ? error.message : String(error);
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

export async function cloneRepo(url: string, ref?: string): Promise<string> {
  const tempDir = await mkdtemp(join(tmpdir(), 'skills-'));
  const git = gitClient();
  const cloneOptions = ref ? ['--depth', '1', '--branch', ref] : ['--depth', '1'];

  try {
    await git.clone(url, tempDir, cloneOptions);
    return tempDir;
  } catch (error) {
    // Clean up temp dir on failure
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    throw classifyCloneError(error, url);
  }
}

/**
 * Clone a repository and check out an exact commit.
 *
 * Tries a minimal fetch of just that commit first (supported by GitHub, GitLab
 * and most modern git servers); falls back to a full clone when the server does
 * not allow fetching unadvertised objects.
 */
export async function cloneRepoAtSha(url: string, sha: string, ref?: string): Promise<string> {
  // Fast path: init an empty repo and fetch only the pinned commit
  const fastDir = await mkdtemp(join(tmpdir(), 'skills-'));
  try {
    const git = gitClient(fastDir);
    await git.init();
    await git.addRemote('origin', url);
    await git.fetch('origin', sha, ['--depth', '1']);
    await git.checkout(sha);
    return fastDir;
  } catch {
    // Server may not allow fetching unadvertised objects; fall back below
    await rm(fastDir, { recursive: true, force: true }).catch(() => {});
  }

  // Fallback: full clone (all branches), then check out the commit
  const tempDir = await mkdtemp(join(tmpdir(), 'skills-'));
  try {
    const git = gitClient();
    await git.clone(url, tempDir, ref ? ['--branch', ref] : []);
    await gitClient(tempDir).checkout(sha);
    return tempDir;
  } catch (error) {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    throw classifyCloneError(error, url);
  }
}

/**
 * Clone only a subdirectory of a repository using a sparse, partial clone.
 *
 * Mirrors Claude Code's documented "sparse, partial clone" for git-subdir
 * sources: blobs are fetched on demand (--filter=blob:none) and only the
 * declared path is materialized in the working tree (sparse-checkout). This
 * keeps monorepo checkouts small — the rest of the tree never lands on disk.
 *
 * When a sha is given the exact commit is checked out (sparse): a shallow
 * fetch of just that commit first (supported by GitHub/GitLab and most modern
 * servers), falling back to a sparse clone + checkout when the server does not
 * allow fetching unadvertised objects — mirroring cloneRepoAtSha().
 */
export async function cloneRepoSparse(
  url: string,
  options: { path: string; ref?: string; sha?: string }
): Promise<string> {
  const { path, ref, sha } = options;

  if (sha) {
    // Fast path: init a sparse, partial repo and fetch only the pinned commit
    const fastDir = await mkdtemp(join(tmpdir(), 'skills-'));
    try {
      const git = gitClient(fastDir);
      await git.init();
      await git.addRemote('origin', url);
      await git.raw(['config', 'core.sparseCheckout', 'true']);
      await git.raw(['sparse-checkout', 'init', '--cone']);
      await git.raw(['sparse-checkout', 'set', path]);
      await git.fetch('origin', sha, ['--depth', '1', '--filter=blob:none']);
      await git.checkout(sha);
      return fastDir;
    } catch {
      // Server may not allow fetching unadvertised objects; fall back below
      await rm(fastDir, { recursive: true, force: true }).catch(() => {});
    }

    // Fallback: sparse clone (all branches), then check out the commit
    const tempDir = await mkdtemp(join(tmpdir(), 'skills-'));
    try {
      const git = gitClient();
      const cloneOptions = ['--filter=blob:none', '--sparse'];
      if (ref) cloneOptions.push('--branch', ref);
      await git.clone(url, tempDir, cloneOptions);
      const repo = gitClient(tempDir);
      await repo.raw(['sparse-checkout', 'set', path]);
      await repo.checkout(sha);
      return tempDir;
    } catch (error) {
      await rm(tempDir, { recursive: true, force: true }).catch(() => {});
      throw classifyCloneError(error, url);
    }
  }

  const tempDir = await mkdtemp(join(tmpdir(), 'skills-'));
  try {
    const git = gitClient();
    const cloneOptions = ['--depth', '1', '--filter=blob:none', '--sparse'];
    if (ref) cloneOptions.push('--branch', ref);
    await git.clone(url, tempDir, cloneOptions);
    await gitClient(tempDir).raw(['sparse-checkout', 'set', path]);
    return tempDir;
  } catch (error) {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    throw classifyCloneError(error, url);
  }
}

/**
 * Get the commit SHA currently checked out in a repository.
 */
export async function getHeadSha(repoDir: string): Promise<string> {
  const sha = await gitClient(repoDir).revparse(['HEAD']);
  return sha.trim();
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
