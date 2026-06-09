import { describe, it, expect, vi, beforeEach } from 'vitest';
import { updateProjectSkills, updateGlobalSkills } from '../src/update.ts';
import * as git from '../src/git.ts';
import * as skills from '../src/skills.ts';
import * as blob from '../src/blob.ts';
import * as localLock from '../src/local-lock.ts';
import * as skillLock from '../src/skill-lock.ts';
import * as remove from '../src/remove.ts';
import * as p from '@clack/prompts';
import { readFileSync } from 'fs';
import { join } from 'path';

// Mock dependencies
vi.mock('../src/git.ts');
vi.mock('../src/skills.ts');
vi.mock('../src/blob.ts');
vi.mock('../src/local-lock.ts');
vi.mock('../src/skill-lock.ts');
vi.mock('../src/remove.ts');
vi.mock('@clack/prompts');

// Mock fs to prevent actual file checks during test
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    existsSync: vi.fn().mockReturnValue(true), // Assume CLI entrypoint exists
    readFileSync: vi.fn().mockImplementation((path, encoding) => {
      if (typeof path === 'string' && path.endsWith('.skill-lock.json')) {
        return JSON.stringify({
          version: 3,
          skills: {
            'skill-a': {
              source: 'owner/repo',
              skillPath: 'skills/skill-a/SKILL.md',
              sourceType: 'github',
              skillFolderHash: 'abc',
              installedAt: '',
              updatedAt: '',
            },
            'skill-b': {
              source: 'owner/repo',
              skillPath: 'skills/skill-b/SKILL.md',
              sourceType: 'github',
              skillFolderHash: 'def',
              installedAt: '',
              updatedAt: '',
            },
          },
        });
      }
      // Fall back to actual readFileSync for other files (like package.json if needed)
      try {
        return actual.readFileSync(path, encoding);
      } catch {
        return '';
      }
    }),
  };
});

// Mock child_process to prevent actual command execution
vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return {
    ...actual,
    spawnSync: vi.fn().mockReturnValue({ status: 0 }), // Mock spawnSync for updates
  };
});

describe('Update Cleanup Unit Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default mock for isTTY
    Object.defineProperty(process.stdin, 'isTTY', {
      value: true,
      configurable: true,
    });
  });

  describe('updateProjectSkills', () => {
    it('should prompt to remove deleted skill on update', async () => {
      // Mock local lock with 2 skills from same source
      vi.mocked(localLock.readLocalLock).mockResolvedValue({
        version: 1,
        skills: {
          'skill-a': {
            source: 'owner/repo',
            skillPath: 'skills/skill-a/SKILL.md',
            sourceType: 'github',
            computedHash: 'abc',
          },
          'skill-b': {
            source: 'owner/repo',
            skillPath: 'skills/skill-b/SKILL.md',
            sourceType: 'github',
            computedHash: 'def',
          },
        },
      });

      // Mock git clone
      vi.mocked(git.cloneRepo).mockResolvedValue('/tmp/repo');

      // Mock discoverSkills to return only skill-a
      vi.mocked(skills.discoverSkills).mockResolvedValue([
        { name: 'skill-a', path: '/tmp/repo/skills/skill-a', description: 'A', rawContent: '' },
      ]);

      // Mock confirm to say yes
      vi.mocked(p.confirm).mockResolvedValue(true);

      // Run update
      await updateProjectSkills();

      // Verify prompt was shown
      expect(p.confirm).toHaveBeenCalled();

      // Verify removeCommand was called for skill-b
      expect(remove.removeCommand).toHaveBeenCalledWith(
        ['skill-b'],
        expect.objectContaining({ yes: true, global: false })
      );
    });

    it('should skip deletion in non-interactive mode', async () => {
      vi.mocked(localLock.readLocalLock).mockResolvedValue({
        version: 1,
        skills: {
          'skill-a': {
            source: 'owner/repo',
            skillPath: 'skills/skill-a/SKILL.md',
            sourceType: 'github',
            computedHash: 'abc',
          },
          'skill-b': {
            source: 'owner/repo',
            skillPath: 'skills/skill-b/SKILL.md',
            sourceType: 'github',
            computedHash: 'def',
          },
        },
      });

      vi.mocked(git.cloneRepo).mockResolvedValue('/tmp/repo');
      vi.mocked(skills.discoverSkills).mockResolvedValue([
        { name: 'skill-a', path: '/tmp/repo/skills/skill-a', description: 'A', rawContent: '' },
      ]);

      // Run update with yes: true (non-interactive)
      await updateProjectSkills({ yes: true });

      // Verify prompt was NOT shown
      expect(p.confirm).not.toHaveBeenCalled();

      // Verify removeCommand was NOT called
      expect(remove.removeCommand).not.toHaveBeenCalled();
    });

    it('should skip deletion when isTTY is false', async () => {
      Object.defineProperty(process.stdin, 'isTTY', {
        value: false,
        configurable: true,
      });

      vi.mocked(localLock.readLocalLock).mockResolvedValue({
        version: 1,
        skills: {
          'skill-a': {
            source: 'owner/repo',
            skillPath: 'skills/skill-a/SKILL.md',
            sourceType: 'github',
            computedHash: 'abc',
          },
          'skill-b': {
            source: 'owner/repo',
            skillPath: 'skills/skill-b/SKILL.md',
            sourceType: 'github',
            computedHash: 'def',
          },
        },
      });

      vi.mocked(git.cloneRepo).mockResolvedValue('/tmp/repo');
      vi.mocked(skills.discoverSkills).mockResolvedValue([
        { name: 'skill-a', path: '/tmp/repo/skills/skill-a', description: 'A', rawContent: '' },
      ]);

      await updateProjectSkills();

      expect(p.confirm).not.toHaveBeenCalled();
      expect(remove.removeCommand).not.toHaveBeenCalled();
    });
  });

  describe('updateGlobalSkills', () => {
    it('should prompt to remove deleted skill on global update', async () => {
      // Mock readSkillLock
      vi.mocked(skillLock.readSkillLock).mockResolvedValue({
        version: 3,
        skills: {
          'skill-a': {
            source: 'owner/repo',
            skillPath: 'skills/skill-a/SKILL.md',
            sourceType: 'github',
            skillFolderHash: 'abc',
            installedAt: '',
            updatedAt: '',
          },
          'skill-b': {
            source: 'owner/repo',
            skillPath: 'skills/skill-b/SKILL.md',
            sourceType: 'github',
            skillFolderHash: 'def',
            installedAt: '',
            updatedAt: '',
          },
        },
      });

      vi.mocked(blob.fetchRepoTree).mockResolvedValue({
        sha: 'rootsha',
        branch: 'main',
        tree: [
          { path: 'skills/skill-a/SKILL.md', type: 'blob', sha: 'sha1' },
          { path: 'skills/skill-a', type: 'tree', sha: 'abc' },
        ],
      });
      vi.mocked(blob.findSkillMdPaths).mockReturnValue(['skills/skill-a/SKILL.md']);

      vi.mocked(p.confirm).mockResolvedValue(true);

      await updateGlobalSkills();

      expect(p.confirm).toHaveBeenCalled();
      expect(remove.removeCommand).toHaveBeenCalledWith(
        ['skill-b'],
        expect.objectContaining({ yes: true, global: true })
      );
    });

    it('should check global non-GitHub git sources by cloning', async () => {
      vi.mocked(skillLock.readSkillLock).mockResolvedValue({
        version: 3,
        skills: {
          'skill-a': {
            source: 'git@github.com:owner/repo.git',
            sourceUrl: 'git@github.com:owner/repo.git',
            skillPath: 'skills/skill-a/SKILL.md',
            sourceType: 'git',
            skillFolderHash: 'old-hash',
            installedAt: '',
            updatedAt: '',
          },
        },
      });

      vi.mocked(git.cloneRepo).mockResolvedValue('/tmp/repo');
      vi.mocked(skills.discoverSkills).mockResolvedValue([
        { name: 'skill-a', path: '/tmp/repo/skills/skill-a', description: 'A', rawContent: '' },
      ]);
      vi.mocked(localLock.computeSkillFolderHash).mockResolvedValue('new-hash');

      await updateGlobalSkills({ yes: true });

      expect(git.cloneRepo).toHaveBeenCalledWith('git@github.com:owner/repo.git', undefined);
      expect(localLock.computeSkillFolderHash).toHaveBeenCalledWith(
        join('/tmp/repo', 'skills/skill-a')
      );
    });
  });
});
