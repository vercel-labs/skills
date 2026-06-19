import { describe, it, expect, vi, beforeEach } from 'vitest';
import { spawnSync } from 'child_process';
import {
  updateProjectSkills,
  updateGlobalSkills,
  printLegacyProjectSkills,
} from '../src/update.ts';
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

    it('should keep GitHub global update source path-targeted', async () => {
      vi.mocked(skillLock.readSkillLock).mockResolvedValue({
        version: 3,
        skills: {
          'skill-a': {
            source: 'owner/repo',
            sourceUrl: 'https://github.com/owner/repo.git',
            ref: 'main',
            skillPath: 'skills/skill-a/SKILL.md',
            sourceType: 'github',
            skillFolderHash: 'old-hash',
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
      vi.mocked(blob.getSkillFolderHashFromTree).mockReturnValue('new-hash');

      await updateGlobalSkills({ yes: true });

      expect(vi.mocked(spawnSync)).toHaveBeenCalledWith(
        expect.anything(),
        expect.arrayContaining([
          'add',
          'owner/repo/skills/skill-a#main',
          '--skill',
          'skill-a',
          '-g',
          '-y',
        ]),
        expect.anything()
      );
      expect(vi.mocked(spawnSync).mock.calls[0]![1]).not.toContain(
        'https://github.com/owner/repo.git#main'
      );
    });

    it('should use sourceUrl when applying global non-GitHub git updates', async () => {
      vi.mocked(skillLock.readSkillLock).mockResolvedValue({
        version: 3,
        skills: {
          'skill-a': {
            source: 'owner/repo',
            sourceUrl: 'https://gitlab.com/owner/repo.git',
            ref: 'main',
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

      expect(vi.mocked(spawnSync)).toHaveBeenCalledWith(
        expect.anything(),
        expect.arrayContaining([
          'add',
          'https://gitlab.com/owner/repo.git#main',
          '--skill',
          'skill-a',
          '-g',
          '-y',
        ]),
        expect.anything()
      );
    });

    it('keeps same normalized global sources isolated by sourceUrl during clone and deletion checks', async () => {
      vi.mocked(skillLock.readSkillLock).mockResolvedValue({
        version: 3,
        skills: {
          'github-skill': {
            source: 'org/repo',
            sourceUrl: 'https://github.com/org/repo.git',
            skillPath: 'skills/github-skill/SKILL.md',
            sourceType: 'git',
            skillFolderHash: 'old-a',
            installedAt: '',
            updatedAt: '',
          },
          'gitlab-skill': {
            source: 'org/repo',
            sourceUrl: 'https://gitlab.example.com/org/repo.git',
            skillPath: 'skills/gitlab-skill/SKILL.md',
            sourceType: 'git',
            skillFolderHash: 'old-b',
            installedAt: '',
            updatedAt: '',
          },
        },
      });

      vi.mocked(git.cloneRepo).mockImplementation(async (source) =>
        source === 'https://github.com/org/repo.git' ? '/tmp/github' : '/tmp/gitlab'
      );
      vi.mocked(skills.discoverSkills).mockImplementation(async (root) => [
        {
          name: root === '/tmp/github' ? 'github-skill' : 'gitlab-skill',
          path: `${root}/skills/${root === '/tmp/github' ? 'github-skill' : 'gitlab-skill'}`,
          description: 'A',
          rawContent: '',
        },
      ]);
      vi.mocked(p.confirm).mockResolvedValue(true);
      vi.mocked(localLock.computeSkillFolderHash).mockResolvedValue('old-a');

      await updateGlobalSkills();

      expect(git.cloneRepo).toHaveBeenCalledTimes(2);
      expect(git.cloneRepo).toHaveBeenCalledWith('https://github.com/org/repo.git', undefined);
      expect(git.cloneRepo).toHaveBeenCalledWith(
        'https://gitlab.example.com/org/repo.git',
        undefined
      );
      expect(remove.removeCommand).not.toHaveBeenCalled();
    });
  });

  describe('updateProjectSkills with sourceUrl', () => {
    it('should use sourceUrl for clone when available', async () => {
      vi.mocked(localLock.readLocalLock).mockResolvedValue({
        version: 1,
        skills: {
          'skill-a': {
            source: 'gradiant-organization/skill-inventory',
            sourceUrl: 'https://gitlab.gradiant.co.kr/gradiant-organization/skill-inventory.git',
            skillPath: 'skills/skill-a/SKILL.md',
            sourceType: 'gitlab',
            computedHash: 'abc',
          },
        },
      });

      vi.mocked(git.cloneRepo).mockResolvedValue('/tmp/repo');
      vi.mocked(skills.discoverSkills).mockResolvedValue([
        { name: 'skill-a', path: '/tmp/repo/skills/skill-a', description: 'A', rawContent: '' },
      ]);
      vi.mocked(localLock.computeSkillFolderHash).mockResolvedValue('new-hash');

      await updateProjectSkills({ yes: true });

      // Should clone using sourceUrl, not the hostless source
      expect(git.cloneRepo).toHaveBeenCalledWith(
        'https://gitlab.gradiant.co.kr/gradiant-organization/skill-inventory.git',
        undefined
      );
    });

    it('should use sourceUrl in spawned add command', async () => {
      vi.mocked(localLock.readLocalLock).mockResolvedValue({
        version: 1,
        skills: {
          'skill-a': {
            source: 'gradiant-organization/skill-inventory',
            sourceUrl: 'https://gitlab.gradiant.co.kr/gradiant-organization/skill-inventory.git',
            ref: 'main',
            skillPath: 'skills/skill-a/SKILL.md',
            sourceType: 'gitlab',
            computedHash: 'abc',
          },
        },
      });

      vi.mocked(git.cloneRepo).mockResolvedValue('/tmp/repo');
      vi.mocked(skills.discoverSkills).mockResolvedValue([
        { name: 'skill-a', path: '/tmp/repo/skills/skill-a', description: 'A', rawContent: '' },
      ]);
      vi.mocked(localLock.computeSkillFolderHash).mockResolvedValue('new-hash');

      await updateProjectSkills({ yes: true });

      // The spawned add command should use sourceUrl with ref
      expect(vi.mocked(spawnSync)).toHaveBeenCalledWith(
        expect.anything(),
        expect.arrayContaining([
          'add',
          'https://gitlab.gradiant.co.kr/gradiant-organization/skill-inventory.git#main',
          '--skill',
          'skill-a',
          '-y',
        ]),
        expect.anything()
      );
    });

    it('should fall back to source when sourceUrl is not set', async () => {
      vi.mocked(localLock.readLocalLock).mockResolvedValue({
        version: 1,
        skills: {
          'skill-a': {
            source: 'owner/repo',
            skillPath: 'skills/skill-a/SKILL.md',
            sourceType: 'github',
            computedHash: 'abc',
          },
        },
      });

      vi.mocked(git.cloneRepo).mockResolvedValue('/tmp/repo');
      vi.mocked(skills.discoverSkills).mockResolvedValue([
        { name: 'skill-a', path: '/tmp/repo/skills/skill-a', description: 'A', rawContent: '' },
      ]);
      vi.mocked(localLock.computeSkillFolderHash).mockResolvedValue('new-hash');

      await updateProjectSkills({ yes: true });

      // Should clone using source (owner/repo) when no sourceUrl
      expect(git.cloneRepo).toHaveBeenCalledWith('owner/repo', undefined);
    });

    it('should keep GitHub project update spawned source at repo root', async () => {
      vi.mocked(localLock.readLocalLock).mockResolvedValue({
        version: 1,
        skills: {
          'skill-a': {
            source: 'owner/repo',
            ref: 'main',
            skillPath: 'skills/skill-a/SKILL.md',
            sourceType: 'github',
            computedHash: 'abc',
          },
        },
      });

      vi.mocked(git.cloneRepo).mockResolvedValue('/tmp/repo');
      vi.mocked(skills.discoverSkills).mockResolvedValue([
        { name: 'skill-a', path: '/tmp/repo/skills/skill-a', description: 'A', rawContent: '' },
      ]);
      vi.mocked(localLock.computeSkillFolderHash).mockResolvedValue('new-hash');

      await updateProjectSkills({ yes: true });

      expect(vi.mocked(spawnSync)).toHaveBeenCalledWith(
        expect.anything(),
        expect.arrayContaining(['add', 'owner/repo#main', '--skill', 'skill-a', '-y']),
        expect.anything()
      );
      expect(vi.mocked(spawnSync).mock.calls[0]![1]).not.toContain(
        'owner/repo/skills/skill-a#main'
      );
    });

    it('should group by effective source, separating different hosts', async () => {
      // Two skills with same hostless "source" but different sourceUrl (different hosts)
      vi.mocked(localLock.readLocalLock).mockResolvedValue({
        version: 1,
        skills: {
          'github-skill': {
            source: 'org/repo',
            skillPath: 'skills/github-skill/SKILL.md',
            sourceType: 'github',
            computedHash: 'aaa',
          },
          'gitlab-skill': {
            source: 'org/repo',
            sourceUrl: 'https://gitlab.example.com/org/repo.git',
            skillPath: 'skills/gitlab-skill/SKILL.md',
            sourceType: 'gitlab',
            computedHash: 'bbb',
          },
        },
      });

      vi.mocked(git.cloneRepo).mockResolvedValue('/tmp/repo');
      vi.mocked(skills.discoverSkills).mockResolvedValue([
        {
          name: 'github-skill',
          path: '/tmp/repo/skills/github-skill',
          description: 'A',
          rawContent: '',
        },
        {
          name: 'gitlab-skill',
          path: '/tmp/repo/skills/gitlab-skill',
          description: 'B',
          rawContent: '',
        },
      ]);
      vi.mocked(localLock.computeSkillFolderHash).mockResolvedValue('new-hash');

      await updateProjectSkills({ yes: true });

      // Should clone twice — once for each host
      expect(git.cloneRepo).toHaveBeenCalledTimes(2);
      expect(git.cloneRepo).toHaveBeenCalledWith('org/repo', undefined);
      expect(git.cloneRepo).toHaveBeenCalledWith(
        'https://gitlab.example.com/org/repo.git',
        undefined
      );
    });

    it('should not consider other sourceUrl entries deleted during deletion checks', async () => {
      vi.mocked(localLock.readLocalLock).mockResolvedValue({
        version: 1,
        skills: {
          'github-skill': {
            source: 'org/repo',
            skillPath: 'skills/github-skill/SKILL.md',
            sourceType: 'github',
            computedHash: 'aaa',
          },
          'gitlab-skill': {
            source: 'org/repo',
            sourceUrl: 'https://gitlab.example.com/org/repo.git',
            skillPath: 'skills/gitlab-skill/SKILL.md',
            sourceType: 'gitlab',
            computedHash: 'bbb',
          },
        },
      });

      vi.mocked(git.cloneRepo).mockImplementation(async (source) => {
        return source === 'org/repo' ? '/tmp/github' : '/tmp/gitlab';
      });
      vi.mocked(skills.discoverSkills).mockImplementation(async (root) => {
        if (root === '/tmp/github') {
          return [
            {
              name: 'github-skill',
              path: '/tmp/github/skills/github-skill',
              description: 'A',
              rawContent: '',
            },
          ];
        }
        return [
          {
            name: 'gitlab-skill',
            path: '/tmp/gitlab/skills/gitlab-skill',
            description: 'B',
            rawContent: '',
          },
        ];
      });
      vi.mocked(p.confirm).mockResolvedValue(true);
      vi.mocked(localLock.computeSkillFolderHash).mockResolvedValue('new-hash');

      await updateProjectSkills();

      expect(remove.removeCommand).not.toHaveBeenCalled();
    });
  });

  describe('printLegacyProjectSkills', () => {
    it('falls back to source when sourceUrl is not set', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      printLegacyProjectSkills([
        {
          name: 'github-skill',
          source: 'owner/repo',
          entry: {
            source: 'owner/repo',
            ref: 'v1',
            sourceType: 'github',
            computedHash: 'abc',
          },
        },
      ]);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('owner/repo#v1');
      expect(output).not.toContain('undefined');

      consoleSpy.mockRestore();
    });

    it('does not append legacy skillPath to GitHub reinstall command', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      printLegacyProjectSkills([
        {
          name: 'github-skill',
          source: 'owner/repo',
          entry: {
            source: 'owner/repo',
            ref: 'v1',
            sourceType: 'github',
            skillPath: 'skills/github-skill/SKILL.md',
            computedHash: 'abc',
          },
        },
      ]);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('owner/repo#v1');
      expect(output).not.toContain('owner/repo/skills/github-skill#v1');

      consoleSpy.mockRestore();
    });

    it('uses sourceUrl with ref when sourceUrl exists', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      printLegacyProjectSkills([
        {
          name: 'gitlab-skill',
          source: 'org/repo',
          entry: {
            source: 'org/repo',
            sourceUrl: 'https://gitlab.example.com/org/repo.git',
            ref: 'v1',
            sourceType: 'git',
            computedHash: 'abc',
          },
        },
      ]);

      const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
      expect(output).toContain('https://gitlab.example.com/org/repo.git#v1');

      consoleSpy.mockRestore();
    });
  });
});
