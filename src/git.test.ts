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
  isGitHubHttpsCloneUrl,
  isGitHubSsoAuthError,
  parseGitHubRepoUrl,
  parseSshCloneUrl,
} from './git.ts';

function createGitClientMock(clone: ReturnType<typeof vi.fn>) {
  return {
    clone,
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

describe('git clone fallbacks', () => {
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

  it('parses GitHub HTTPS and SSH clone URLs', () => {
    expect(parseGitHubRepoUrl('https://github.com/Giphy/giphy-codex-skills.git')).toEqual({
      owner: 'Giphy',
      repo: 'giphy-codex-skills',
      slug: 'Giphy/giphy-codex-skills',
      sshUrl: 'git@github.com:Giphy/giphy-codex-skills.git',
    });

    expect(parseGitHubRepoUrl('git@github.com:Giphy/giphy-codex-skills.git')).toEqual({
      owner: 'Giphy',
      repo: 'giphy-codex-skills',
      slug: 'Giphy/giphy-codex-skills',
      sshUrl: 'git@github.com:Giphy/giphy-codex-skills.git',
    });
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

  it('detects GitHub SAML SSO clone failures', () => {
    expect(
      isGitHubSsoAuthError("remote: The 'Giphy' organization has enabled or enforced SAML SSO.")
    ).toBe(true);
    expect(isGitHubSsoAuthError('fatal: Authentication failed')).toBe(false);
  });

  it('only enables automatic auth fallback for GitHub HTTPS clone URLs', () => {
    expect(isGitHubHttpsCloneUrl('https://github.com/Giphy/giphy-codex-skills.git')).toBe(true);
    expect(isGitHubHttpsCloneUrl('http://github.com/Giphy/giphy-codex-skills.git')).toBe(false);
    expect(isGitHubHttpsCloneUrl('git@github.com:Giphy/giphy-codex-skills.git')).toBe(false);
    expect(isGitHubHttpsCloneUrl('https://gitlab.com/Giphy/giphy-codex-skills.git')).toBe(false);
  });

  it('allows the hard-coded LFS filter overrides required for clone', async () => {
    const clone = vi.fn().mockResolvedValue(undefined);
    simpleGitMock.mockReturnValueOnce(createGitClientMock(clone));

    const tempDir = await cloneRepo('https://github.com/Giphy/giphy-codex-skills.git');
    createdDirs.push(tempDir);

    expect(simpleGitMock).toHaveBeenCalledWith(
      expect.objectContaining({
        config: [
          'filter.lfs.required=false',
          'filter.lfs.smudge=',
          'filter.lfs.clean=',
          'filter.lfs.process=',
        ],
        unsafe: { allowUnsafeFilter: true },
      })
    );
  });

  it('falls back to gh repo clone for GitHub HTTPS auth failures', async () => {
    const primaryClone = vi
      .fn()
      .mockRejectedValue(
        new Error(
          "remote: The 'Giphy' organization has enabled or enforced SAML SSO.\n" +
            "fatal: unable to access 'https://github.com/Giphy/giphy-codex-skills.git/': The requested URL returned error: 403"
        )
      );

    simpleGitMock.mockReturnValueOnce(createGitClientMock(primaryClone));
    mockExecFileSuccess('Git operations protocol: https\n');
    mockExecFileSuccess();

    const tempDir = await cloneRepo('https://github.com/Giphy/giphy-codex-skills.git');
    createdDirs.push(tempDir);

    expect(execFileAsyncMock).toHaveBeenNthCalledWith(
      1,
      'gh',
      ['auth', 'status', '-h', 'github.com'],
      expect.any(Object)
    );
    expect(execFileAsyncMock).toHaveBeenNthCalledWith(
      2,
      'gh',
      ['repo', 'clone', 'Giphy/giphy-codex-skills', tempDir, '--', '--depth=1'],
      expect.any(Object)
    );
  });

  it('falls back to SSH when gh clone is unavailable or fails', async () => {
    const primaryClone = vi.fn().mockRejectedValue(new Error('fatal: Authentication failed'));
    const sshClone = vi.fn().mockResolvedValue(undefined);

    simpleGitMock
      .mockReturnValueOnce(createGitClientMock(primaryClone))
      .mockReturnValueOnce(createGitClientMock(sshClone));
    mockExecFileSuccess('Git operations protocol: ssh\n');
    mockExecFileError('gh repo clone failed');

    const tempDir = await cloneRepo('https://github.com/Giphy/giphy-codex-skills.git');
    createdDirs.push(tempDir);

    expect(sshClone).toHaveBeenCalledWith('git@github.com:Giphy/giphy-codex-skills.git', tempDir, [
      '--depth',
      '1',
    ]);
  });

  it('surfaces a targeted SAML SSO message when all fallbacks fail', async () => {
    const primaryClone = vi
      .fn()
      .mockRejectedValue(
        new Error(
          "remote: The 'Giphy' organization has enabled or enforced SAML SSO.\n" +
            "fatal: unable to access 'https://github.com/Giphy/giphy-codex-skills.git/': The requested URL returned error: 403"
        )
      );
    const sshClone = vi.fn().mockRejectedValue(new Error('Permission denied (publickey).'));

    simpleGitMock
      .mockReturnValueOnce(createGitClientMock(primaryClone))
      .mockReturnValueOnce(createGitClientMock(sshClone));
    mockExecFileError('gh auth unavailable');

    try {
      await cloneRepo('https://github.com/Giphy/giphy-codex-skills.git');
      throw new Error('Expected cloneRepo to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(GitCloneError);
      expect((error as Error).message).toMatch(/SAML SSO/);
      expect((error as Error).message).toMatch(/git@github\.com:Giphy\/giphy-codex-skills\.git/);
    }
  });

  it('does not try gh fallback for GitLab clone URLs', async () => {
    const primaryClone = vi
      .fn()
      .mockRejectedValue(
        new Error('fatal: unable to access repo: The requested URL returned error: 403')
      );

    simpleGitMock.mockReturnValueOnce(createGitClientMock(primaryClone));

    await expect(cloneRepo('https://gitlab.com/Giphy/giphy-codex-skills.git')).rejects.toThrow(
      GitCloneError
    );
    expect(execFileAsyncMock).not.toHaveBeenCalled();
  });

  it('does not try gh fallback for GitHub SSH clone URLs', async () => {
    const primaryClone = vi.fn().mockRejectedValue(new Error('Permission denied (publickey).'));

    simpleGitMock.mockReturnValueOnce(createGitClientMock(primaryClone));

    await expect(cloneRepo('git@github.com:Giphy/giphy-codex-skills.git')).rejects.toThrow(
      GitCloneError
    );
    expect(execFileAsyncMock).toHaveBeenCalledWith('ssh', ['-G', 'github.com'], expect.any(Object));
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

  it('rejects the command-executing ext transport before invoking git', async () => {
    await expect(cloneRepo('ext::sh -c id')).rejects.toThrow('Unsupported Git transport: ext');

    expect(simpleGitMock).not.toHaveBeenCalled();
    expect(execFileMock).not.toHaveBeenCalled();
  });
});
