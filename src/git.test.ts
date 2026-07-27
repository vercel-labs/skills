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
  const client = {
    clone,
    env: vi.fn(),
  };
  client.env.mockReturnValue(client);
  return client;
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
    vi.unstubAllEnvs();
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

  it('recognizes the configured GitHub Enterprise host', () => {
    vi.stubEnv('GH_HOST', 'github.example.com');

    expect(parseGitHubRepoUrl('https://github.example.com/acme/agent-skills.git')).toEqual({
      owner: 'acme',
      repo: 'agent-skills',
      slug: 'acme/agent-skills',
      sshUrl: 'git@github.example.com:acme/agent-skills.git',
    });
    expect(isGitHubHttpsCloneUrl('https://github.example.com/acme/agent-skills.git')).toBe(true);
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
    vi.stubEnv('EDITOR', 'skills-test-editor');
    vi.stubEnv('GIT_ASKPASS', 'skills-test-askpass');
    vi.stubEnv('PAGER', 'skills-test-pager');
    const clone = vi.fn().mockResolvedValue(undefined);
    const client = createGitClientMock(clone);
    simpleGitMock.mockReturnValueOnce(client);

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
        unsafe: {
          allowUnsafeAlias: true,
          allowUnsafeAskPass: true,
          allowUnsafeConfigEnvCount: true,
          allowUnsafeConfigPaths: true,
          allowUnsafeCredentialHelper: true,
          allowUnsafeDiffExternal: true,
          allowUnsafeDiffTextConv: true,
          allowUnsafeEditor: true,
          allowUnsafeFilter: true,
          allowUnsafeFsMonitor: true,
          allowUnsafeGpgProgram: true,
          allowUnsafeGitProxy: true,
          allowUnsafeHooksPath: true,
          allowUnsafeMergeDriver: true,
          allowUnsafePack: true,
          allowUnsafePager: true,
          allowUnsafeProtocolOverride: true,
          allowUnsafeSshCommand: true,
          allowUnsafeTemplateDir: true,
        },
      })
    );
    expect(simpleGitMock.mock.calls[0]![0]).not.toHaveProperty('env');
    expect(client.env).toHaveBeenCalledWith(
      expect.objectContaining({
        EDITOR: 'skills-test-editor',
        GIT_ASKPASS: 'skills-test-askpass',
        GIT_TERMINAL_PROMPT: '0',
        GIT_LFS_SKIP_SMUDGE: '1',
        PAGER: 'skills-test-pager',
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

  it('uses the enterprise host for gh authentication fallback', async () => {
    vi.stubEnv('GH_HOST', 'github.example.com');
    const primaryClone = vi.fn().mockRejectedValue(new Error('fatal: Authentication failed'));

    simpleGitMock.mockReturnValueOnce(createGitClientMock(primaryClone));
    mockExecFileSuccess('Git operations protocol: https\n');
    mockExecFileSuccess();

    const tempDir = await cloneRepo('https://github.example.com/acme/agent-skills.git');
    createdDirs.push(tempDir);

    expect(execFileMock).toHaveBeenNthCalledWith(
      1,
      'gh',
      ['auth', 'status', '-h', 'github.example.com'],
      expect.any(Object),
      expect.any(Function)
    );
    expect(execFileMock).toHaveBeenNthCalledWith(
      2,
      'gh',
      ['repo', 'clone', 'acme/agent-skills', tempDir, '--', '--depth=1'],
      expect.any(Object),
      expect.any(Function)
    );
  });

  it('falls back to SSH when gh clone is unavailable or fails', async () => {
    const primaryClone = vi.fn().mockRejectedValue(new Error('fatal: Authentication failed'));
    const sshClone = vi.fn().mockResolvedValue(undefined);
    const primaryClient = createGitClientMock(primaryClone);
    const sshClient = createGitClientMock(sshClone);

    simpleGitMock.mockReturnValueOnce(primaryClient).mockReturnValueOnce(sshClient);
    mockExecFileSuccess('Git operations protocol: ssh\n');
    mockExecFileError('gh repo clone failed');

    const tempDir = await cloneRepo('https://github.com/Giphy/giphy-codex-skills.git');
    createdDirs.push(tempDir);

    expect(sshClone).toHaveBeenCalledWith('git@github.com:Giphy/giphy-codex-skills.git', tempDir, [
      '--depth',
      '1',
    ]);
    expect(sshClient.env).toHaveBeenCalledWith(
      expect.objectContaining({
        GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND ?? 'ssh -o BatchMode=yes',
      })
    );
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

  it('rejects the command-executing ext transport before invoking git', async () => {
    await expect(cloneRepo('ext::sh -c id')).rejects.toThrow('Unsupported Git transport: ext');

    expect(simpleGitMock).not.toHaveBeenCalled();
    expect(execFileMock).not.toHaveBeenCalled();
  });
});
