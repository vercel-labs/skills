import { describe, it, expect, vi, beforeEach } from 'vitest';
import { spawnSync } from 'child_process';
import { updateProjectSkills, updateGlobalSkills, runUpdate } from '../src/update.ts';
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
    process.exitCode = undefined;
    process.env.DISABLE_TELEMETRY = '1';
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

    it('uses full-depth discovery for project deletion checks', async () => {
      vi.mocked(localLock.readLocalLock).mockResolvedValue({
        version: 1,
        skills: {
          'help-me-read': {
            source: 'owner/repo',
            sourceType: 'github',
            skillPath: 'plugins/help-me-read/skills/help-me-read/SKILL.md',
            computedHash: 'old-hash',
          },
        },
      });
      vi.mocked(git.cloneRepo).mockResolvedValue('/tmp/repo');
      vi.mocked(skills.discoverSkills).mockImplementation(async (_path, _subpath, options) =>
        options?.fullDepth
          ? [
              {
                name: 'help-me-read',
                path: '/tmp/repo/plugins/help-me-read/skills/help-me-read',
                description: 'Deep skill',
                rawContent: '',
              },
            ]
          : []
      );

      await updateProjectSkills();

      expect(skills.discoverSkills).toHaveBeenCalledWith('/tmp/repo', undefined, {
        fullDepth: true,
      });
      expect(p.confirm).not.toHaveBeenCalled();
      expect(remove.removeCommand).not.toHaveBeenCalled();
    });

    it('uses sourceUrl for self-hosted GitLab project updates', async () => {
      vi.mocked(localLock.readLocalLock).mockResolvedValue({
        version: 1,
        skills: {
          'skill-a': {
            source: 'acme/skills',
            sourceUrl: 'https://gitlab.example.com/acme/skills.git',
            skillPath: 'plugins/example/skills/skill-a/SKILL.md',
            sourceType: 'git',
            computedHash: 'abc',
          },
        },
      });

      vi.mocked(git.cloneRepo).mockResolvedValue('/tmp/repo');
      vi.mocked(skills.discoverSkills).mockResolvedValue([
        {
          name: 'skill-a',
          path: '/tmp/repo/plugins/example/skills/skill-a',
          description: 'Deep skill',
          rawContent: '',
        },
      ]);

      await updateProjectSkills({ yes: true });

      expect(git.cloneRepo).toHaveBeenCalledWith(
        'https://gitlab.example.com/acme/skills.git',
        undefined
      );
      const installCall = vi
        .mocked(spawnSync)
        .mock.calls.find((call) => Array.isArray(call[1]) && call[1].includes('add'));
      expect(installCall).toBeDefined();
      const [, argv] = installCall!;
      expect(argv).toEqual(
        expect.arrayContaining(['add', 'https://gitlab.example.com/acme/skills.git', '--skill'])
      );
      expect(argv).not.toEqual(expect.arrayContaining(['acme/skills']));
      expect(argv).toContain('--full-depth');
    });

    it('keeps GitHub project updates path-targeted without full-depth discovery', async () => {
      vi.mocked(localLock.readLocalLock).mockResolvedValue({
        version: 1,
        skills: {
          'skill-a': {
            source: 'owner/repo',
            sourceType: 'github',
            skillPath: 'plugins/example/skills/skill-a/SKILL.md',
            computedHash: 'abc',
          },
        },
      });
      vi.mocked(git.cloneRepo).mockResolvedValue('/tmp/repo');
      vi.mocked(skills.discoverSkills).mockResolvedValue([
        {
          name: 'skill-a',
          path: '/tmp/repo/plugins/example/skills/skill-a',
          description: 'Deep skill',
          rawContent: '',
        },
      ]);

      await updateProjectSkills({ yes: true });

      const installCall = vi
        .mocked(spawnSync)
        .mock.calls.find((call) => Array.isArray(call[1]) && call[1].includes('add'));
      expect(installCall).toBeDefined();
      const [, argv] = installCall!;
      expect(argv).toContain('owner/repo/plugins/example/skills/skill-a');
      expect(argv).not.toContain('--full-depth');
    });

    it('does not reinterpret generic git shorthands as GitHub during project update', async () => {
      vi.mocked(localLock.readLocalLock).mockResolvedValue({
        version: 1,
        skills: {
          'skill-a': {
            source: 'acme/skills',
            skillPath: 'skills/skill-a/SKILL.md',
            sourceType: 'git',
            computedHash: 'abc',
          },
        },
      });

      const result = await updateProjectSkills({ yes: true });

      expect(result.failCount).toBe(1);
      expect(git.cloneRepo).not.toHaveBeenCalled();
      expect(spawnSync).not.toHaveBeenCalled();
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

    it('does not report a locked plugin skill as deleted when it exists in the GitHub tree', async () => {
      vi.mocked(skillLock.readSkillLock).mockResolvedValue({
        version: 3,
        skills: {
          'help-me-read': {
            source: 'owner/repo',
            sourceUrl: 'https://github.com/owner/repo.git',
            sourceType: 'github',
            skillPath: 'plugins/help-me-read/skills/help-me-read/SKILL.md',
            skillFolderHash: 'deep-tree-sha',
            installedAt: '',
            updatedAt: '',
          },
        },
      });
      vi.mocked(blob.fetchRepoTree).mockResolvedValue({
        sha: 'rootsha',
        branch: 'main',
        tree: [
          { path: '.claude/skills/shallow/SKILL.md', type: 'blob', sha: 'shallow-blob' },
          {
            path: 'plugins/help-me-read/skills/help-me-read/SKILL.md',
            type: 'blob',
            sha: 'deep-blob',
          },
          {
            path: 'plugins/help-me-read/skills/help-me-read',
            type: 'tree',
            sha: 'deep-tree-sha',
          },
        ],
      });
      vi.mocked(blob.findSkillMdPaths).mockReturnValue(['.claude/skills/shallow/SKILL.md']);
      vi.mocked(p.confirm).mockResolvedValue(false);

      await updateGlobalSkills();

      expect(p.confirm).not.toHaveBeenCalled();
      expect(remove.removeCommand).not.toHaveBeenCalled();
    });

    it('uses full-depth discovery for non-GitHub global deletion checks', async () => {
      vi.mocked(skillLock.readSkillLock).mockResolvedValue({
        version: 3,
        skills: {
          'deep-skill': {
            source: 'git@gitea.example.com:owner/repo.git',
            sourceUrl: 'git@gitea.example.com:owner/repo.git',
            sourceType: 'git',
            skillPath: 'plugins/example/skills/deep-skill/SKILL.md',
            skillFolderHash: 'same-hash',
            installedAt: '',
            updatedAt: '',
          },
        },
      });
      vi.mocked(git.cloneRepo).mockResolvedValue('/tmp/repo');
      vi.mocked(skills.discoverSkills).mockImplementation(async (_path, _subpath, options) =>
        options?.fullDepth
          ? [
              {
                name: 'deep-skill',
                path: '/tmp/repo/plugins/example/skills/deep-skill',
                description: 'Deep skill',
                rawContent: '',
              },
            ]
          : []
      );
      vi.mocked(localLock.computeSkillFolderHash).mockResolvedValue('same-hash');

      await updateGlobalSkills();

      expect(skills.discoverSkills).toHaveBeenCalledWith('/tmp/repo', undefined, {
        fullDepth: true,
      });
      expect(p.confirm).not.toHaveBeenCalled();
      expect(remove.removeCommand).not.toHaveBeenCalled();
    });

    it('should check global non-GitHub git sources by cloning', async () => {
      vi.mocked(skillLock.readSkillLock).mockResolvedValue({
        version: 3,
        skills: {
          'skill-a': {
            source: 'ssh://git@github.com/owner/repo',
            sourceUrl: 'ssh://git@github.com/owner/repo',
            skillPath: 'plugins/example/skills/skill-a/SKILL.md',
            sourceType: 'git',
            skillFolderHash: 'old-hash',
            installedAt: '',
            updatedAt: '',
          },
        },
      });

      vi.mocked(git.cloneRepo).mockResolvedValue('/tmp/repo');
      vi.mocked(skills.discoverSkills).mockResolvedValue([
        {
          name: 'skill-a',
          path: '/tmp/repo/plugins/example/skills/skill-a',
          description: 'Deep skill',
          rawContent: '',
        },
      ]);
      vi.mocked(localLock.computeSkillFolderHash).mockResolvedValue('new-hash');

      await updateGlobalSkills({ yes: true });

      expect(git.cloneRepo).toHaveBeenCalledWith('ssh://git@github.com/owner/repo', undefined);
      expect(localLock.computeSkillFolderHash).toHaveBeenCalledWith(
        join('/tmp/repo', 'plugins/example/skills/skill-a')
      );
      const installCall = vi
        .mocked(spawnSync)
        .mock.calls.find((call) => Array.isArray(call[1]) && call[1].includes('add'));
      expect(installCall).toBeDefined();
      const [, argv] = installCall!;
      expect(argv).toContain('ssh://git@github.com/owner/repo');
      expect(argv).not.toContain('ssh://git@github.com/owner/repo/plugins/example/skills/skill-a');
      expect(argv).toContain('--full-depth');
    });

    it('uses sourceUrl when updating global non-GitHub sources with host-stripped source', async () => {
      vi.mocked(skillLock.readSkillLock).mockResolvedValue({
        version: 3,
        skills: {
          'skill-a': {
            source: 'acme/skills',
            sourceUrl: 'https://gitlab.example.com/acme/skills.git',
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

      expect(git.cloneRepo).toHaveBeenCalledWith(
        'https://gitlab.example.com/acme/skills.git',
        undefined
      );
      const installCall = vi
        .mocked(spawnSync)
        .mock.calls.find((call) => Array.isArray(call[1]) && call[1].includes('add'));
      expect(installCall).toBeDefined();
      const [, argv] = installCall!;
      expect(argv).toEqual(
        expect.arrayContaining(['add', 'https://gitlab.example.com/acme/skills.git'])
      );
      expect(argv).not.toEqual(expect.arrayContaining(['acme/skills']));
    });

    it('spawns the update without a shell so a crafted ref cannot inject commands', async () => {
      // Force the Windows code path so this regression fails on the old
      // `shell: process.platform === 'win32'` even when the test host is not
      // Windows. The value is read inside spawnSync's options at call time.
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });

      try {
        vi.mocked(skillLock.readSkillLock).mockResolvedValue({
          version: 3,
          skills: {
            'skill-a': {
              source: 'owner/repo',
              skillPath: 'skills/skill-a/SKILL.md',
              sourceType: 'github',
              skillFolderHash: 'old-hash',
              // Attacker-influenceable ref carrying a shell metacharacter.
              ref: 'main&calc',
              installedAt: '',
              updatedAt: '',
            },
          },
        });

        vi.mocked(blob.fetchRepoTree).mockResolvedValue({
          sha: 'rootsha',
          branch: 'main',
          tree: [{ path: 'skills/skill-a/SKILL.md', type: 'blob', sha: 'sha1' }],
        });
        vi.mocked(blob.findSkillMdPaths).mockReturnValue(['skills/skill-a/SKILL.md']);
        // Latest hash differs from the lock -> an update is queued -> spawnSync runs.
        vi.mocked(blob.getSkillFolderHashFromTree).mockReturnValue('new-hash');

        await updateGlobalSkills({ yes: true });

        const installCall = vi
          .mocked(spawnSync)
          .mock.calls.find((call) => Array.isArray(call[1]) && call[1].includes('add'));
        expect(installCall).toBeDefined();

        const [, argv, options] = installCall!;
        // The security invariant: no shell, so argv is passed to execvp verbatim.
        expect((options as { shell?: boolean }).shell).toBe(false);
        // The crafted ref rides inside a discrete argv element, never a command string.
        expect(argv).toEqual(expect.arrayContaining([expect.stringContaining('main&calc')]));
      } finally {
        Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
      }
    });
  });

  describe('runUpdate exit status', () => {
    beforeEach(() => {
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
    });

    it('sets a non-zero exit code when requested updates fail', async () => {
      vi.mocked(spawnSync).mockReturnValue({ status: 1 } as ReturnType<typeof spawnSync>);

      await runUpdate(['--project', '--yes']);

      expect(process.exitCode).toBe(1);
    });

    it('does not set a failure exit code when requested updates succeed', async () => {
      vi.mocked(spawnSync).mockReturnValue({ status: 0 } as ReturnType<typeof spawnSync>);

      await runUpdate(['--project', '--yes']);

      expect(process.exitCode).toBeUndefined();
    });
  });
});
