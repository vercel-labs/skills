import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  addSkillToLock,
  getSkillFromLock,
  removeSkillFromLock,
  getSkillLockPath,
} from '../src/skill-lock.ts';

// The global lock lives at ~/.agents/.skill-lock.json. homedir() honors $HOME,
// so we point HOME at a throwaway dir to isolate each test from the real lock.
describe('skill-lock (global)', () => {
  let home: string;
  let originalHome: string | undefined;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'skill-lock-test-'));
    originalHome = process.env.HOME;
    process.env.HOME = home;
  });

  afterEach(async () => {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    await rm(home, { recursive: true, force: true });
  });

  describe('removeSkillFromLock', () => {
    it('removes an existing skill', async () => {
      await addSkillToLock('my-skill', {
        source: 'org/repo',
        sourceType: 'github',
        sourceUrl: 'https://github.com/org/repo',
        skillFolderHash: 'hash',
      });

      const removed = await removeSkillFromLock('my-skill');
      expect(removed).toBe(true);
      expect(await getSkillFromLock('my-skill')).toBeNull();
    });

    it('returns false for a non-existent skill', async () => {
      expect(await removeSkillFromLock('no-such-skill')).toBe(false);
    });

    it('deletes the lock file when the last skill is removed', async () => {
      await addSkillToLock('only-skill', {
        source: 'org/repo',
        sourceType: 'github',
        sourceUrl: 'https://github.com/org/repo',
        skillFolderHash: 'hash',
      });

      const lockPath = getSkillLockPath();
      await expect(access(lockPath)).resolves.toBeUndefined();

      expect(await removeSkillFromLock('only-skill')).toBe(true);
      await expect(access(lockPath)).rejects.toThrow();
    });

    // Regression: entries are keyed by the raw skill name, but `skills remove -g`
    // passes the sanitized on-disk directory name. Removal must match
    // sanitized-equivalent keys or it leaves a stale global entry (#577, #808).
    it('removes an entry whose raw key differs from the sanitized lookup name', async () => {
      await addSkillToLock('My Cool Skill', {
        source: 'org/repo',
        sourceType: 'github',
        sourceUrl: 'https://github.com/org/repo',
        skillFolderHash: 'hash',
      });

      // The remove command derives this from the sanitized directory name.
      const removed = await removeSkillFromLock('my-cool-skill');
      expect(removed).toBe(true);
      expect(await getSkillFromLock('My Cool Skill')).toBeNull();
    });
  });

  describe('getSkillFromLock', () => {
    it('resolves an entry by its sanitized-equivalent name', async () => {
      await addSkillToLock('My Cool Skill', {
        source: 'org/repo',
        sourceType: 'github',
        sourceUrl: 'https://github.com/org/repo',
        skillFolderHash: 'hash',
      });

      const entry = await getSkillFromLock('my-cool-skill');
      expect(entry).not.toBeNull();
      expect(entry?.source).toBe('org/repo');
    });
  });
});
