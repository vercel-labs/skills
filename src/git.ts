import simpleGit from 'simple-git';
import { join, normalize, resolve, sep } from 'path';
import { mkdtemp, rm } from 'fs/promises';
import { existsSync } from 'fs';
import { tmpdir } from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';

const CLONE_TIMEOUT_MS = 60000; // 60 seconds
const execFileAsync = promisify(execFile);

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
  const git = simpleGit({
    timeout: { block: CLONE_TIMEOUT_MS },
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });
  const cloneOptions = ref ? ['--depth', '1', '--branch', ref] : ['--depth', '1'];

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
