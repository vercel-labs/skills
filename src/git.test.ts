import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { rmSync } from 'fs';

const simpleGitMock = vi.hoisted(() => vi.fn());
const execFileMock = vi.hoisted(() => vi.fn());

vi.mock('simple-git', () => ({
  default: simpleGitMock,
}));

vi.mock('child_process', async () => {
  const actual = await vi.importActual<typeof import('child_process')>('child_process');
  return {
    ...actual,
    execFile: execFileMock,
  };
});

import {
  GitCloneError,
  cloneRepo,
  isGitHubHttpsCloneUrl,
  isGitHubSsoAuthError,
  parseGitHubRepoUrl,
} from './git.ts';

function createGitClientMock(clone: ReturnType<typeof vi.fn>) {
  return {
    clone,
  };
}

function mockExecFileSuccess(stdout = '', stderr = '') {
  execFileMock.mockImplementationOnce(
    (_file: string, _args: string[], _options: unknown, callback: (...args: unknown[]) => void) => {
      callback(null, stdout, stderr);
    }
  );
}

function mockExecFileError(message: string) {
  execFileMock.mockImplementationOnce(
    (_file: string, _args: string[], _options: unknown, callback: (...args: unknown[]) => void) => {
      const error = Object.assign(new Error(message), { code: 1 });
      callback(error, '', message);
    }
  );
}

describe('git clone fallbacks', () => {
  const createdDirs: string[] = [];

  beforeEach(() => {
    simpleGitMock.mockReset();
    execFileMock.mockReset();
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

    expect(execFileMock).toHaveBeenNthCalledWith(
      1,
      'gh',
      ['auth', 'status', '-h', 'github.com'],
      expect.any(Object),
      expect.any(Function)
    );
    expect(execFileMock).toHaveBeenNthCalledWith(
      2,
      'gh',
      ['repo', 'clone', 'Giphy/giphy-codex-skills', tempDir, '--', '--depth=1'],
      expect.any(Object),
      expect.any(Function)
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
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it('does not try gh fallback for GitHub SSH clone URLs', async () => {
    const primaryClone = vi.fn().mockRejectedValue(new Error('Permission denied (publickey).'));

    simpleGitMock.mockReturnValueOnce(createGitClientMock(primaryClone));

    await expect(cloneRepo('git@github.com:Giphy/giphy-codex-skills.git')).rejects.toThrow(
      GitCloneError
    );
    expect(execFileMock).not.toHaveBeenCalled();
  });

  describe('GITHUB_TOKEN / GH_TOKEN auth', () => {
    const originalGithubToken = process.env.GITHUB_TOKEN;
    const originalGhToken = process.env.GH_TOKEN;

    afterEach(() => {
      if (originalGithubToken === undefined) delete process.env.GITHUB_TOKEN;
      else process.env.GITHUB_TOKEN = originalGithubToken;
      if (originalGhToken === undefined) delete process.env.GH_TOKEN;
      else process.env.GH_TOKEN = originalGhToken;
    });

    it('authenticates GitHub HTTPS clones via GITHUB_TOKEN without touching the URL', async () => {
      delete process.env.GH_TOKEN;
      process.env.GITHUB_TOKEN = 'test-github-token';
      const primaryClone = vi.fn().mockResolvedValue(undefined);
      simpleGitMock.mockReturnValueOnce(createGitClientMock(primaryClone));

      const tempDir = await cloneRepo('https://github.com/Giphy/giphy-codex-skills.git');
      createdDirs.push(tempDir);

      // The clone URL itself must stay bare — no credential in argv.
      expect(primaryClone).toHaveBeenCalledWith(
        'https://github.com/Giphy/giphy-codex-skills.git',
        tempDir,
        ['--depth', '1']
      );

      const gitOptions = simpleGitMock.mock.calls[0]![0] as { env: NodeJS.ProcessEnv };
      const expectedHeader = `AUTHORIZATION: basic ${Buffer.from('x-access-token:test-github-token').toString('base64')}`;
      expect(gitOptions.env.GIT_CONFIG_COUNT).toBe('1');
      expect(gitOptions.env.GIT_CONFIG_KEY_0).toBe('http.https://github.com/.extraheader');
      expect(gitOptions.env.GIT_CONFIG_VALUE_0).toBe(expectedHeader);
    });

    it('falls back to GH_TOKEN when GITHUB_TOKEN is unset', async () => {
      delete process.env.GITHUB_TOKEN;
      process.env.GH_TOKEN = 'test-gh-token';
      const primaryClone = vi.fn().mockResolvedValue(undefined);
      simpleGitMock.mockReturnValueOnce(createGitClientMock(primaryClone));

      const tempDir = await cloneRepo('https://github.com/Giphy/giphy-codex-skills.git');
      createdDirs.push(tempDir);

      const gitOptions = simpleGitMock.mock.calls[0]![0] as { env: NodeJS.ProcessEnv };
      const expectedHeader = `AUTHORIZATION: basic ${Buffer.from('x-access-token:test-gh-token').toString('base64')}`;
      expect(gitOptions.env.GIT_CONFIG_VALUE_0).toBe(expectedHeader);
    });

    it('does not inject a token header for non-GitHub-HTTPS URLs even when a token is set', async () => {
      process.env.GITHUB_TOKEN = 'test-github-token';
      const primaryClone = vi.fn().mockResolvedValue(undefined);
      simpleGitMock.mockReturnValueOnce(createGitClientMock(primaryClone));

      const tempDir = await cloneRepo('git@github.com:Giphy/giphy-codex-skills.git');
      createdDirs.push(tempDir);

      const gitOptions = simpleGitMock.mock.calls[0]![0] as { env: NodeJS.ProcessEnv };
      expect(gitOptions.env.GIT_CONFIG_COUNT).toBeUndefined();
    });

    it('omits the token header entirely when no token is configured', async () => {
      delete process.env.GITHUB_TOKEN;
      delete process.env.GH_TOKEN;
      const primaryClone = vi.fn().mockResolvedValue(undefined);
      simpleGitMock.mockReturnValueOnce(createGitClientMock(primaryClone));

      const tempDir = await cloneRepo('https://github.com/Giphy/giphy-codex-skills.git');
      createdDirs.push(tempDir);

      const gitOptions = simpleGitMock.mock.calls[0]![0] as { env: NodeJS.ProcessEnv };
      expect(gitOptions.env.GIT_CONFIG_COUNT).toBeUndefined();
    });
  });
});
