import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { diagnostics } from './diagnostics.ts';
import {
  addSkillToLock,
  dismissPrompt,
  getGitHubToken,
  getSkillLockPath,
  readSkillLock,
  saveSelectedAgents,
} from './skill-lock.ts';

describe('getGitHubToken', () => {
  const originalGitHubToken = process.env.GITHUB_TOKEN;
  const originalGhToken = process.env.GH_TOKEN;

  beforeEach(() => {
    delete process.env.GITHUB_TOKEN;
    delete process.env.GH_TOKEN;
  });

  afterEach(() => {
    if (originalGitHubToken === undefined) {
      delete process.env.GITHUB_TOKEN;
    } else {
      process.env.GITHUB_TOKEN = originalGitHubToken;
    }
    if (originalGhToken === undefined) {
      delete process.env.GH_TOKEN;
    } else {
      process.env.GH_TOKEN = originalGhToken;
    }
  });

  it('prefers an explicitly supplied GITHUB_TOKEN', () => {
    process.env.GITHUB_TOKEN = 'github-token';
    process.env.GH_TOKEN = 'gh-token';

    expect(getGitHubToken()).toBe('github-token');
  });

  it('uses an explicitly supplied GH_TOKEN', () => {
    process.env.GH_TOKEN = 'gh-token';

    expect(getGitHubToken()).toBe('gh-token');
  });

  it('does not extract credentials from external tools', () => {
    expect(getGitHubToken()).toBeNull();
  });
});

describe('global skill lock', () => {
  const entry = { source: 'x/gamma', sourceType: 'github', sourceUrl: '', skillFolderHash: '' };
  let stateDir: string;
  let lockPath: string;

  beforeEach(async () => {
    stateDir = await mkdtemp(join(tmpdir(), 'skills-global-lock-'));
    vi.stubEnv('XDG_STATE_HOME', stateDir);
    lockPath = getSkillLockPath();
    await mkdir(join(stateDir, 'skills'), { recursive: true });
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    await rm(stateDir, { recursive: true, force: true });
  });

  it('reads a missing lock as empty', async () => {
    expect(await readSkillLock()).toEqual({ version: 3, skills: {}, dismissed: {} });
  });

  it('wipes a lock from an older version', async () => {
    await writeFile(lockPath, JSON.stringify({ version: 2, skills: { alpha: entry } }));

    expect((await readSkillLock()).skills).toEqual({});
  });

  it.each([
    [
      'truncated JSON',
      '{"version":3,"skills":{"alpha":{"source":"x/alpha"},"beta":{"source":"x/be',
    ],
    ['an empty file', ''],
    ['null', 'null'],
    ['an array', '[]'],
    ['a string version', '{"version":"3","skills":{}}'],
    ['no skills map', '{"version":3}'],
  ])('refuses to rewrite a lock holding %s', async (_, content) => {
    await writeFile(lockPath, content);

    const error = await addSkillToLock('gamma', entry).catch((e: unknown) => e);

    expect(diagnostics.SKILLS_INVALID_GLOBAL_LOCK.is(error)).toBe(true);
    expect(await readFile(lockPath, 'utf-8')).toBe(content);
  });

  it('rethrows read errors other than a missing file', async () => {
    await mkdir(lockPath);

    const error = await readSkillLock().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(Error);
    expect(diagnostics.SKILLS_INVALID_GLOBAL_LOCK.is(error)).toBe(false);
  });

  it('skips preference writes on an invalid lock and warns', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const content = '{"version":3,"skills":{"alpha":';
    await writeFile(lockPath, content);

    await saveSelectedAgents(['cursor']);
    await dismissPrompt('findSkillsPrompt');

    expect(await readFile(lockPath, 'utf-8')).toBe(content);
    expect(warnSpy).toHaveBeenCalledTimes(2);
  });

  it('replaces the lock without leaving temp files behind', async () => {
    await writeFile(lockPath, JSON.stringify({ version: 3, skills: { alpha: entry } }));

    await addSkillToLock('gamma', entry);

    expect(Object.keys((await readSkillLock()).skills)).toEqual(['alpha', 'gamma']);
    expect(await readdir(join(stateDir, 'skills'))).toEqual(['.skill-lock.json']);
  });

  it.skipIf(process.platform === 'win32')('writes through a symlinked lock', async () => {
    const target = join(stateDir, 'dotfiles-lock.json');
    await writeFile(target, JSON.stringify({ version: 3, skills: {} }));
    await symlink(target, lockPath);

    await addSkillToLock('gamma', entry);

    expect((await lstat(lockPath)).isSymbolicLink()).toBe(true);
    expect(JSON.parse(await readFile(target, 'utf-8')).skills).toHaveProperty('gamma');
  });
});
