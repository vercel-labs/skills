import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { promisify } from 'util';

const simpleGitMock = vi.hoisted(() => vi.fn());
const execFileAsyncMock = vi.hoisted(() => vi.fn());

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
  };
});

import {
  GitCloneError,
  cloneRepo,
  detectSshPassphrasePromptIssue,
  parseSshCloneUrl,
} from './git.ts';

function createGitClientMock(clone: ReturnType<typeof vi.fn>) {
  return { clone };
}

function mockExecFileSuccess(stdout = '', stderr = '') {
  execFileAsyncMock.mockResolvedValueOnce({ stdout, stderr });
}

function mockExecFileError(message: string) {
  execFileAsyncMock.mockRejectedValueOnce(
    Object.assign(new Error(message), { code: 1, stdout: '', stderr: message })
  );
}

describe('git ssh passphrase handling', () => {
  const createdDirs: string[] = [];

  beforeEach(() => {
    simpleGitMock.mockReset();
    execFileAsyncMock.mockReset();
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

    expect(simpleGitMock.mock.results[0]?.value?.clone).toBeUndefined();
  });
});
