import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  addSkillToLock,
  getSkillLockPath,
  readSkillLock,
  removeSkillFromLock,
  getSkillFromLock,
} from './skill-lock.ts';

describe('skill lock scope handling', () => {
  let projectDir: string;

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), 'skills-lock-scope-'));
  });

  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  it('stores project lock file under <cwd>/.agents/.skill-lock.json', () => {
    const lockPath = getSkillLockPath({ global: false, cwd: projectDir });
    expect(lockPath).toBe(join(projectDir, '.agents', '.skill-lock.json'));
  });

  it('can add/read/remove entries in the project-scoped lock', async () => {
    await addSkillToLock(
      'renamed-skill',
      {
        source: 'owner/repo',
        sourceType: 'github',
        sourceUrl: 'https://github.com/owner/repo.git',
        skillPath: 'skills/original/SKILL.md',
        skillFolderHash: 'abc123',
      },
      { global: false, cwd: projectDir }
    );

    const lock = await readSkillLock({ global: false, cwd: projectDir });
    expect(lock.skills['renamed-skill']).toBeDefined();

    const entry = await getSkillFromLock('renamed-skill', { global: false, cwd: projectDir });
    expect(entry?.source).toBe('owner/repo');

    const removed = await removeSkillFromLock('renamed-skill', {
      global: false,
      cwd: projectDir,
    });
    expect(removed).toBe(true);

    const after = await getSkillFromLock('renamed-skill', { global: false, cwd: projectDir });
    expect(after).toBeNull();
  });
});
