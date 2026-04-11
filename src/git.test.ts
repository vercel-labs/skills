import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { promisify } from 'util';
import { EventEmitter } from 'events';

const simpleGitMock = vi.hoisted(() => vi.fn());
const execFileAsyncMock = vi.hoisted(() => vi.fn());
const spawnMock = vi.hoisted(() => vi.fn());

vi.mock('simple-git', () => ({
  default: simpleGitMock,
}));

vi.mock('child_process', async () => {
  const actual = await vi.importActual<typeof import('child_process')>('child_process');
  const execFile = vi.fn();
  Object.defineProperty(execFile, promisify.custom, {
    value: execFileAsyncMock,
  });
  return {
    ...actual,
    execFile,
    spawn: spawnMock,
  };
});

import {
  GitCloneError,
  GitInteractiveSshPromptRequiredError,
  cloneRepo,
  cloneRepoInteractive,
  detectSshPassphrasePromptIssue,
  parseSshCloneUrl,
} from './git.ts';

function createGitClientMock(clone: ReturnType<typeof vi.fn>) {
  return {
    clone,
    env: vi.fn().mockReturnThis(),
  };
}

function mockExecFileSuccess(stdout = '', stderr = '') {
  execFileAsyncMock.mockResolvedValueOnce({ stdout, stderr });
}

function mockExecFileError(message: string) {
  execFileAsyncMock.mockRejectedValueOnce(
    Object.assign(new Error(message), { code: 1, stdout: '', stderr: message })
  );
}

function createSpawnChild() {
  const child = new EventEmitter() as EventEmitter & { kill: ReturnType<typeof vi.fn> };
  child.kill = vi.fn();
  return child;
}

describe('git ssh passphrase handling', () => {
  const createdDirs: string[] = [];

  beforeEach(() => {
    simpleGitMock.mockReset();
    execFileAsyncMock.mockReset();
    spawnMock.mockReset();
    execFileAsyncMock.mockRejectedValue(
      Object.assign(new Error('unexpected execFile call'), {
        code: 1,
        stdout: '',
        stderr: 'unexpected execFile call',
      })
    );
  });

  afterEach(() => {
    for (const dir of createdDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('parses SSH clone URLs and host aliases', () => {
    expect(parseSshCloneUrl('git@github-passphrase-giphy:Giphy/giphy-codex-skills.git')).toEqual({
      user: 'git',
      host: 'github-passphrase-giphy',
    });

    expect(
      parseSshCloneUrl('ssh://git@github-passphrase-giphy/Giphy/giphy-codex-skills.git')
    ).toEqual({
      user: 'git',
      host: 'github-passphrase-giphy',
    });
  });

  it('detects passphrase-protected SSH identities that are not usable through agent', async () => {
    const sshDir = join(tmpdir(), `skills-git-test-${Date.now()}`);
    const identityFile = join(sshDir, 'id_rsa_github_passphrase_giphy');
    mkdirSync(sshDir, { recursive: true });
    writeFileSync(identityFile, 'private');
    writeFileSync(`${identityFile}.pub`, 'public');
    createdDirs.push(sshDir);

    mockExecFileSuccess(
      `host github-passphrase-giphy\nidentitiesonly yes\nidentityfile ${identityFile}\n`
    );
    mockExecFileError('incorrect passphrase supplied to decrypt private key');
    mockExecFileError('The agent has no identities.');

    await expect(
      detectSshPassphrasePromptIssue('git@github-passphrase-giphy:Giphy/giphy-codex-skills.git')
    ).resolves.toEqual({
      host: 'github-passphrase-giphy',
      identityFile,
    });
  });

  it('fails fast with a targeted message for SSH passphrase prompt dead-ends', async () => {
    const sshDir = join(tmpdir(), `skills-git-test-${Date.now()}`);
    const identityFile = join(sshDir, 'id_rsa_github_passphrase_giphy');
    mkdirSync(sshDir, { recursive: true });
    writeFileSync(identityFile, 'private');
    writeFileSync(`${identityFile}.pub`, 'public');
    createdDirs.push(sshDir);

    mockExecFileSuccess(
      `host github-passphrase-giphy\nidentitiesonly yes\nidentityfile ${identityFile}\n`
    );
    mockExecFileError('incorrect passphrase supplied to decrypt private key');
    mockExecFileError('The agent has no identities.');

    const originalIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
    const clone = vi.fn().mockRejectedValue(new Error('Permission denied (publickey).'));
    simpleGitMock.mockReturnValueOnce(createGitClientMock(clone));

    try {
      await cloneRepo('git@github-passphrase-giphy:Giphy/giphy-codex-skills.git');
      throw new Error('Expected cloneRepo to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(GitCloneError);
      expect((error as Error).message).toMatch(/requires unlocking the passphrase-protected key/);
      expect((error as Error).message).toMatch(/cannot prompt for that passphrase/);
      expect((error as Error).message).toMatch(/ssh-add/);
    } finally {
      Object.defineProperty(process.stdin, 'isTTY', {
        value: originalIsTTY,
        configurable: true,
      });
    }

    expect(clone).toHaveBeenCalledWith(
      'git@github-passphrase-giphy:Giphy/giphy-codex-skills.git',
      expect.any(String),
      ['--depth', '1']
    );
    expect(simpleGitMock).toHaveBeenCalledWith(
      expect.objectContaining({
        timeout: { block: 60000 },
      })
    );
    expect(simpleGitMock.mock.results[0]?.value?.env).toHaveBeenCalledWith(
      expect.objectContaining({
        GIT_TERMINAL_PROMPT: '0',
        GIT_SSH_COMMAND: expect.stringContaining('BatchMode=yes'),
      })
    );
  });

  it('requests an interactive retry for SSH auth failures in a TTY', async () => {
    const sshDir = join(tmpdir(), `skills-git-test-${Date.now()}`);
    const identityFile = join(sshDir, 'id_rsa_github_passphrase_giphy');
    mkdirSync(sshDir, { recursive: true });
    writeFileSync(identityFile, 'private');
    writeFileSync(`${identityFile}.pub`, 'public');
    createdDirs.push(sshDir);

    mockExecFileSuccess(
      `host github-passphrase-giphy\nidentitiesonly yes\nidentityfile ${identityFile}\n`
    );
    mockExecFileError('incorrect passphrase supplied to decrypt private key');
    mockExecFileError('The agent has no identities.');

    const originalIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });

    const clone = vi.fn().mockRejectedValue(new Error('Permission denied (publickey).'));
    simpleGitMock.mockReturnValueOnce(createGitClientMock(clone));

    try {
      await cloneRepo('git@github-passphrase-giphy:Giphy/giphy-codex-skills.git');
      throw new Error('Expected cloneRepo to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(GitInteractiveSshPromptRequiredError);
      expect((error as Error).message).toMatch(/needs terminal interaction/);
    } finally {
      Object.defineProperty(process.stdin, 'isTTY', {
        value: originalIsTTY,
        configurable: true,
      });
    }
  });

  it('runs interactive git clone with inherited stdio', async () => {
    const child = createSpawnChild();
    spawnMock.mockImplementationOnce(() => {
      setImmediate(() => {
        child.emit('exit', 0, null);
      });
      return child;
    });

    const tempDir = await cloneRepoInteractive(
      'git@github-passphrase-giphy:Giphy/giphy-codex-skills.git'
    );
    createdDirs.push(tempDir);

    expect(spawnMock).toHaveBeenCalledWith(
      'git',
      [
        'clone',
        '--depth',
        '1',
        'git@github-passphrase-giphy:Giphy/giphy-codex-skills.git',
        tempDir,
      ],
      expect.objectContaining({
        stdio: 'inherit',
      })
    );
  });
});
