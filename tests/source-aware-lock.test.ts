import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  makeLockKey,
  parseLockKey,
  findEntriesBySkillName,
  addSkillToLock,
  removeSkillFromLockByName,
  getSkillFromLockByName,
  readSkillLock,
} from '../src/skill-lock.ts';

describe('source-aware lock keys', () => {
  let tempDir: string;
  let originalEnv: string | undefined;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'lock-test-'));
    originalEnv = process.env.XDG_STATE_HOME;
    process.env.XDG_STATE_HOME = tempDir;
  });

  afterEach(async () => {
    if (originalEnv === undefined) {
      delete process.env.XDG_STATE_HOME;
    } else {
      process.env.XDG_STATE_HOME = originalEnv;
    }
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('makeLockKey / parseLockKey', () => {
    it('creates composite key with :: separator', () => {
      expect(makeLockKey('owner/repo', 'my-skill')).toBe('owner/repo::my-skill');
    });

    it('parses composite key back into source and name', () => {
      const { source, skillName } = parseLockKey('owner/repo::my-skill');
      expect(source).toBe('owner/repo');
      expect(skillName).toBe('my-skill');
    });

    it('handles source with multiple slashes', () => {
      const key = makeLockKey('git@github.com:owner/repo.git', 'skill');
      const { source, skillName } = parseLockKey(key);
      expect(source).toBe('git@github.com:owner/repo.git');
      expect(skillName).toBe('skill');
    });
  });

  describe('addSkillToLock with source-aware keys', () => {
    it('stores skill under source::name key', async () => {
      await addSkillToLock('my-skill', {
        source: 'owner/repo',
        sourceType: 'github',
        sourceUrl: 'https://github.com/owner/repo.git',
        skillFolderHash: 'abc123',
      });

      const lock = await readSkillLock();
      expect(lock.skills['owner/repo::my-skill']).toBeDefined();
      expect(lock.skills['my-skill']).toBeUndefined();
    });

    it('allows same skill name from different sources', async () => {
      await addSkillToLock('react-tips', {
        source: 'owner1/repo',
        sourceType: 'github',
        sourceUrl: 'https://github.com/owner1/repo.git',
        skillFolderHash: 'abc',
      });

      await addSkillToLock('react-tips', {
        source: 'owner2/repo',
        sourceType: 'github',
        sourceUrl: 'https://github.com/owner2/repo.git',
        skillFolderHash: 'def',
      });

      const lock = await readSkillLock();
      expect(lock.skills['owner1/repo::react-tips']).toBeDefined();
      expect(lock.skills['owner2/repo::react-tips']).toBeDefined();
      expect(lock.skills['owner1/repo::react-tips']!.skillFolderHash).toBe('abc');
      expect(lock.skills['owner2/repo::react-tips']!.skillFolderHash).toBe('def');
    });
  });

  describe('findEntriesBySkillName', () => {
    it('finds all entries matching a skill name regardless of source', async () => {
      await addSkillToLock('react-tips', {
        source: 'owner1/repo',
        sourceType: 'github',
        sourceUrl: 'https://github.com/owner1/repo.git',
        skillFolderHash: 'abc',
      });

      await addSkillToLock('react-tips', {
        source: 'owner2/repo',
        sourceType: 'github',
        sourceUrl: 'https://github.com/owner2/repo.git',
        skillFolderHash: 'def',
      });

      await addSkillToLock('other-skill', {
        source: 'owner1/repo',
        sourceType: 'github',
        sourceUrl: 'https://github.com/owner1/repo.git',
        skillFolderHash: 'ghi',
      });

      const lock = await readSkillLock();
      const matches = findEntriesBySkillName(lock, 'react-tips');
      expect(matches).toHaveLength(2);
      expect(matches.map((m) => m.entry.source).sort()).toEqual(['owner1/repo', 'owner2/repo']);
    });

    it('returns empty array when no matches', async () => {
      const lock = await readSkillLock();
      const matches = findEntriesBySkillName(lock, 'nonexistent');
      expect(matches).toHaveLength(0);
    });
  });

  describe('removeSkillFromLockByName', () => {
    it('removes all entries matching skill name', async () => {
      await addSkillToLock('my-skill', {
        source: 'owner/repo',
        sourceType: 'github',
        sourceUrl: 'https://github.com/owner/repo.git',
        skillFolderHash: 'abc',
      });

      const removed = await removeSkillFromLockByName('my-skill');
      expect(removed).toBe(true);

      const lock = await readSkillLock();
      expect(Object.keys(lock.skills)).toHaveLength(0);
    });
  });

  describe('getSkillFromLockByName', () => {
    it('returns entry when skill exists', async () => {
      await addSkillToLock('my-skill', {
        source: 'owner/repo',
        sourceType: 'github',
        sourceUrl: 'https://github.com/owner/repo.git',
        skillFolderHash: 'abc',
      });

      const entry = await getSkillFromLockByName('my-skill');
      expect(entry).not.toBeNull();
      expect(entry!.source).toBe('owner/repo');
    });

    it('returns null when skill does not exist', async () => {
      const entry = await getSkillFromLockByName('nonexistent');
      expect(entry).toBeNull();
    });
  });

  describe('version bump', () => {
    it('creates lock file with version 4', async () => {
      await addSkillToLock('test', {
        source: 'owner/repo',
        sourceType: 'github',
        sourceUrl: 'https://github.com/owner/repo.git',
        skillFolderHash: 'abc',
      });

      const lock = await readSkillLock();
      expect(lock.version).toBe(4);
    });
  });
});
