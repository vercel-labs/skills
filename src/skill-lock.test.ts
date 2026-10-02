import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  addSkillToDirLock,
  addSkillToLock,
  getAllDirLocks,
  getDirLockedSkills,
  readSkillLock,
  removeSkillFromDirLock,
  getGitHubToken,
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

describe('custom directory lock entries', () => {
  const originalXdg = process.env.XDG_STATE_HOME;
  let stateDir: string;
  const entry = {
    source: 'owner/repo',
    sourceType: 'github',
    sourceUrl: 'https://github.com/owner/repo.git',
    skillPath: 'skills/a/SKILL.md',
    skillFolderHash: 'hash-1',
  };

  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), 'skills-lock-dir-'));
    process.env.XDG_STATE_HOME = stateDir;
  });

  afterEach(() => {
    rmSync(stateDir, { recursive: true, force: true });
    if (originalXdg === undefined) delete process.env.XDG_STATE_HOME;
    else process.env.XDG_STATE_HOME = originalXdg;
  });

  it('tracks skills per directory without touching global entries', async () => {
    await addSkillToLock('a', { ...entry, skillFolderHash: 'global-hash' });
    await addSkillToDirLock('/work/skills', 'a', entry);
    await addSkillToDirLock('/personal/skills', 'a', { ...entry, skillFolderHash: 'hash-2' });

    const lock = await readSkillLock();
    expect(lock.skills.a?.skillFolderHash).toBe('global-hash');
    expect((await getDirLockedSkills('/work/skills')).a?.skillFolderHash).toBe('hash-1');
    expect((await getDirLockedSkills('/personal/skills')).a?.skillFolderHash).toBe('hash-2');
    expect(Object.keys(await getAllDirLocks()).sort()).toEqual([
      '/personal/skills',
      '/work/skills',
    ]);
  });

  it('keeps installedAt across re-installs', async () => {
    await addSkillToDirLock('/work/skills', 'a', entry);
    const first = (await getDirLockedSkills('/work/skills')).a!;
    await addSkillToDirLock('/work/skills', 'a', { ...entry, skillFolderHash: 'hash-2' });
    const second = (await getDirLockedSkills('/work/skills')).a!;
    expect(second.installedAt).toBe(first.installedAt);
    expect(second.skillFolderHash).toBe('hash-2');
  });

  it('drops a directory once its last skill is removed', async () => {
    await addSkillToDirLock('/work/skills', 'a', entry);
    await addSkillToDirLock('/work/skills', 'b', entry);

    expect(await removeSkillFromDirLock('/work/skills', 'a')).toBe(true);
    expect(Object.keys(await getDirLockedSkills('/work/skills'))).toEqual(['b']);
    expect(await removeSkillFromDirLock('/work/skills', 'b')).toBe(true);
    expect((await readSkillLock()).customDirs).toBeUndefined();
    expect(await removeSkillFromDirLock('/work/skills', 'b')).toBe(false);
  });
});
