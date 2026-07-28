import { afterEach, describe, it, expect, vi, beforeEach } from 'vitest';
import { spawnSync } from 'child_process';
import {
  resolveUpdateScope,
  updateProjectSkills,
  updateGlobalSkills,
  runUpdate,
} from '../src/update.ts';
import * as git from '../src/git.ts';
import * as skills from '../src/skills.ts';
import * as blob from '../src/blob.ts';
import * as localLock from '../src/local-lock.ts';
import * as skillLock from '../src/skill-lock.ts';
import * as remove from '../src/remove.ts';
import * as installer from '../src/installer.ts';
import * as p from '@clack/prompts';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

// Mock dependencies
vi.mock('../src/git.ts');
vi.mock('../src/skills.ts');
vi.mock('../src/blob.ts');
vi.mock('../src/local-lock.ts');
vi.mock('../src/skill-lock.ts');
vi.mock('../src/remove.ts');
vi.mock('../src/installer.ts');
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
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(installer.sanitizeName).mockImplementation((name) => name);
    vi.mocked(installer.stripIgnoredEveFrontmatter).mockImplementation((content) => content);
    // Default mock for isTTY
    Object.defineProperty(process.stdin, 'isTTY', {
      value: true,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('updateProjectSkills', () => {
    it('reports project updates without reinstalling skills in check mode', async () => {
      vi.mocked(localLock.readLocalLock).mockResolvedValue({
        version: 1,
        skills: {
          'skill-a': {
            source: 'owner/repo',
            skillPath: 'skills/skill-a/SKILL.md',
            sourceType: 'github',
            computedHash: 'old-hash',
          },
        },
      });
      vi.mocked(git.cloneRepo).mockResolvedValue('/tmp/repo');
      vi.mocked(skills.discoverSkills).mockResolvedValue([
        { name: 'skill-a', path: '/tmp/repo/skills/skill-a', description: 'A', rawContent: '' },
      ]);
      vi.mocked(localLock.computeSkillFolderHash)
        .mockResolvedValueOnce('new-hash')
        .mockResolvedValueOnce('old-hash');

      const result = await updateProjectSkills({ checkOnly: true, yes: true });

      expect(result.updateCount).toBe(1);
      expect(git.cloneRepo).toHaveBeenCalledWith('https://github.com/owner/repo.git', undefined);
      expect(localLock.computeSkillFolderHash).toHaveBeenCalledWith(
        join('/tmp/repo', 'skills/skill-a'),
        expect.any(Object)
      );
      expect(localLock.computeSkillFolderHash).toHaveBeenCalledWith(
        join(process.cwd(), '.agents/skills/skill-a')
      );
      expect(spawnSync).not.toHaveBeenCalled();
      expect(remove.removeCommand).not.toHaveBeenCalled();

      vi.mocked(localLock.computeSkillFolderHash).mockReset().mockResolvedValue('same-hash');
      const upToDateResult = await updateProjectSkills({ checkOnly: true, yes: true });
      expect(upToDateResult.updateCount).toBe(0);
    });

    it('checks every copied project installation', async () => {
      const canonicalPath = join(process.cwd(), '.agents/skills/skill-a');
      const claudePath = join(process.cwd(), '.claude/skills/skill-a');
      vi.mocked(existsSync).mockImplementation(
        (path) =>
          path === canonicalPath ||
          path === claudePath ||
          (typeof path === 'string' && path.endsWith('/bin/cli.mjs'))
      );
      vi.mocked(localLock.readLocalLock).mockResolvedValue({
        version: 1,
        skills: {
          'skill-a': {
            source: 'owner/repo',
            skillPath: 'skills/skill-a/SKILL.md',
            sourceType: 'github',
            computedHash: 'installed-hash',
          },
        },
      });
      vi.mocked(git.cloneRepo).mockResolvedValue('/tmp/repo');
      vi.mocked(skills.discoverSkills).mockResolvedValue([
        { name: 'skill-a', path: '/tmp/repo/skills/skill-a', description: 'A', rawContent: '' },
      ]);
      vi.mocked(localLock.computeSkillFolderHash)
        .mockResolvedValueOnce('remote-hash')
        .mockResolvedValueOnce('remote-hash')
        .mockResolvedValueOnce('changed-copy-hash');

      const result = await updateProjectSkills({ checkOnly: true, yes: true });

      expect(result.updateCount).toBe(1);
      expect(localLock.computeSkillFolderHash).toHaveBeenCalledWith(canonicalPath);
      expect(localLock.computeSkillFolderHash).toHaveBeenCalledWith(claudePath);
    });

    it('checks separate refs from the same project source independently', async () => {
      vi.mocked(localLock.readLocalLock).mockResolvedValue({
        version: 1,
        skills: {
          'skill-a': {
            source: 'owner/repo',
            ref: 'main',
            skillPath: 'skills/skill-a/SKILL.md',
            sourceType: 'github',
            computedHash: 'same-hash',
          },
          'skill-b': {
            source: 'owner/repo',
            ref: 'beta',
            skillPath: 'skills/skill-b/SKILL.md',
            sourceType: 'github',
            computedHash: 'same-hash',
          },
        },
      });
      vi.mocked(git.cloneRepo).mockImplementation(async (_source, ref) => `/tmp/repo-${ref}`);
      vi.mocked(skills.discoverSkills).mockImplementation(async (path) => {
        const name = path.endsWith('main') ? 'skill-a' : 'skill-b';
        return [
          {
            name,
            path: join(path, 'skills', name),
            description: name,
            rawContent: '',
          },
        ];
      });
      vi.mocked(localLock.computeSkillFolderHash).mockResolvedValue('same-hash');

      const result = await updateProjectSkills({ checkOnly: true, yes: true });

      expect(result.updateCount).toBe(0);
      expect(git.cloneRepo).toHaveBeenCalledWith('https://github.com/owner/repo.git', 'main');
      expect(git.cloneRepo).toHaveBeenCalledWith('https://github.com/owner/repo.git', 'beta');
    });

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

    it('normalizes GitHub shorthand for deletion checks and keeps updates path-targeted', async () => {
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

      expect(git.cloneRepo).toHaveBeenCalledWith('https://github.com/owner/repo.git', undefined);
      const installCall = vi
        .mocked(spawnSync)
        .mock.calls.find((call) => Array.isArray(call[1]) && call[1].includes('add'));
      expect(installCall).toBeDefined();
      const [, argv] = installCall!;
      expect(argv).toContain('owner/repo/plugins/example/skills/skill-a');
      expect(argv).not.toContain('--full-depth');
    });

    it('pins public GitHub project updates to github.com when GH_HOST points elsewhere', async () => {
      vi.stubEnv('GH_HOST', 'github.example.com');
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

      await updateProjectSkills({ yes: true });

      const installCall = vi
        .mocked(spawnSync)
        .mock.calls.find((call) => Array.isArray(call[1]) && call[1].includes('add'));
      expect(installCall).toBeDefined();
      const [, argv, options] = installCall!;
      expect(argv).toEqual(
        expect.arrayContaining(['add', 'owner/repo/skills/skill-a', '--skill', 'skill-a'])
      );
      expect((options as { env?: NodeJS.ProcessEnv }).env?.GH_HOST).toBe('github.com');
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
    it('checks separate refs from the same global source independently', async () => {
      vi.mocked(skillLock.readSkillLock).mockResolvedValue({
        version: 3,
        skills: {
          'skill-a': {
            source: 'owner/repo',
            ref: 'main',
            skillPath: 'skills/skill-a/SKILL.md',
            sourceType: 'github',
            skillFolderHash: 'hash-a',
            installedAt: '',
            updatedAt: '',
          },
          'skill-b': {
            source: 'owner/repo',
            ref: 'beta',
            skillPath: 'skills/skill-b/SKILL.md',
            sourceType: 'github',
            skillFolderHash: 'hash-b',
            installedAt: '',
            updatedAt: '',
          },
        },
      });
      vi.mocked(blob.fetchRepoTree).mockImplementation(async (_source, ref) => {
        const name = ref === 'main' ? 'skill-a' : 'skill-b';
        return {
          sha: `root-${ref}`,
          branch: ref!,
          tree: [
            { path: `skills/${name}/SKILL.md`, type: 'blob', sha: `blob-${ref}` },
            { path: `skills/${name}`, type: 'tree', sha: `hash-${name.slice(-1)}` },
          ],
        };
      });
      vi.mocked(blob.getSkillFolderHashFromTree).mockImplementation((_tree, skillPath) =>
        skillPath.includes('skill-a') ? 'hash-a' : 'hash-b'
      );

      const result = await updateGlobalSkills({ checkOnly: true, yes: true });

      expect(result.updateCount).toBe(0);
      expect(blob.fetchRepoTree).toHaveBeenCalledWith(
        'owner/repo',
        'main',
        skillLock.getGitHubToken
      );
      expect(blob.fetchRepoTree).toHaveBeenCalledWith(
        'owner/repo',
        'beta',
        skillLock.getGitHubToken
      );
    });

    it('reports global updates without reinstalling skills in check mode', async () => {
      vi.mocked(skillLock.readSkillLock).mockResolvedValue({
        version: 3,
        skills: {
          'skill-a': {
            source: 'owner/repo',
            sourceUrl: 'https://github.com/owner/repo.git',
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
          { path: 'skills/skill-a/SKILL.md', type: 'blob', sha: 'skill-md-sha' },
          { path: 'skills/skill-a', type: 'tree', sha: 'new-hash' },
        ],
      });
      vi.mocked(blob.getSkillFolderHashFromTree).mockReturnValue('new-hash');

      const result = await updateGlobalSkills({ checkOnly: true, yes: true });

      expect(result.updateCount).toBe(1);
      expect(spawnSync).not.toHaveBeenCalled();
      expect(remove.removeCommand).not.toHaveBeenCalled();
    });

    it('does not remove skills deleted upstream in check mode', async () => {
      vi.mocked(skillLock.readSkillLock).mockResolvedValue({
        version: 3,
        skills: {
          'skill-a': {
            source: 'owner/repo',
            sourceUrl: 'https://github.com/owner/repo.git',
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
        tree: [],
      });
      vi.mocked(p.confirm).mockResolvedValue(true);

      await updateGlobalSkills({ checkOnly: true });

      expect(p.confirm).not.toHaveBeenCalled();
      expect(remove.removeCommand).not.toHaveBeenCalled();
      expect(spawnSync).not.toHaveBeenCalled();
    });

    it('reports a failed remote check when the API and clone fallback both fail', async () => {
      vi.mocked(skillLock.readSkillLock).mockResolvedValue({
        version: 3,
        skills: {
          'skill-a': {
            source: 'owner/repo',
            sourceUrl: 'https://github.com/owner/repo.git',
            skillPath: 'skills/skill-a/SKILL.md',
            sourceType: 'github',
            skillFolderHash: 'old-hash',
            installedAt: '',
            updatedAt: '',
          },
        },
      });
      vi.mocked(blob.fetchRepoTree).mockResolvedValue(null);
      vi.mocked(git.cloneRepo).mockRejectedValueOnce(new Error('clone failed'));

      const result = await updateGlobalSkills({ checkOnly: true, yes: true });

      expect(result.failCount).toBe(1);
      expect(result.updateCount).toBe(0);
      expect(spawnSync).not.toHaveBeenCalled();
    });

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

    it('checks a private GitHub update by cloning when authenticated API access is unavailable', async () => {
      vi.mocked(skillLock.readSkillLock).mockResolvedValue({
        version: 3,
        skills: {
          'skill-a': {
            source: 'owner/private-repo',
            sourceUrl: 'https://github.com/owner/private-repo.git',
            sourceType: 'github',
            skillPath: 'skills/skill-a/SKILL.md',
            skillFolderHash: 'old-content-hash',
            installedAt: '',
            updatedAt: '',
          },
        },
      });
      vi.mocked(blob.fetchRepoTree).mockResolvedValue(null);
      vi.mocked(git.cloneRepo).mockResolvedValue('/tmp/private-repo');
      vi.mocked(skills.discoverSkills).mockResolvedValue([
        {
          name: 'skill-a',
          path: '/tmp/private-repo/skills/skill-a',
          description: 'Private skill',
          rawContent: '',
        },
      ]);
      vi.mocked(localLock.computeSkillFolderHash).mockResolvedValue('new-content-hash');

      await updateGlobalSkills({ yes: true });

      expect(git.cloneRepo).toHaveBeenCalledWith(
        'https://github.com/owner/private-repo.git',
        undefined
      );
      expect(localLock.computeSkillFolderHash).toHaveBeenCalledWith(
        join('/tmp/private-repo', 'skills/skill-a')
      );
      const installCall = vi
        .mocked(spawnSync)
        .mock.calls.find((call) => Array.isArray(call[1]) && call[1].includes('add'));
      expect(installCall).toBeDefined();
    });

    it('does not report an unchanged Git tree SHA as updated after an API fallback', async () => {
      const treeHash = 'a'.repeat(40);
      vi.mocked(skillLock.readSkillLock).mockResolvedValue({
        version: 3,
        skills: {
          'skill-a': {
            source: 'owner/private-repo',
            sourceUrl: 'git@github.com:owner/private-repo.git',
            sourceType: 'github',
            skillPath: 'skills/skill-a/SKILL.md',
            skillFolderHash: treeHash,
            installedAt: '',
            updatedAt: '',
          },
        },
      });
      vi.mocked(blob.fetchRepoTree).mockResolvedValue(null);
      vi.mocked(git.cloneRepo).mockResolvedValue('/tmp/private-repo');
      vi.mocked(skills.discoverSkills).mockResolvedValue([
        {
          name: 'skill-a',
          path: '/tmp/private-repo/skills/skill-a',
          description: 'Private skill',
          rawContent: '',
        },
      ]);
      vi.mocked(git.getGitTreeHash).mockResolvedValue(treeHash);
      vi.mocked(localLock.computeSkillFolderHash).mockResolvedValue('b'.repeat(64));

      await updateGlobalSkills({ yes: true });

      expect(git.getGitTreeHash).toHaveBeenCalledWith(
        '/tmp/private-repo',
        'skills/skill-a/SKILL.md'
      );
      expect(spawnSync).not.toHaveBeenCalled();
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
        expect.arrayContaining([
          'add',
          'https://gitlab.example.com/acme/skills.git',
          '--skill',
          'skill-a',
        ])
      );
      expect(argv).not.toEqual(expect.arrayContaining(['acme/skills']));
    });

    it('pins public GitHub global updates to github.com when GH_HOST points elsewhere', async () => {
      vi.stubEnv('GH_HOST', 'github.example.com');
      vi.mocked(skillLock.readSkillLock).mockResolvedValue({
        version: 3,
        skills: {
          'skill-a': {
            source: 'owner/repo',
            sourceUrl: 'https://github.com/owner/repo.git',
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
        tree: [{ path: 'skills/skill-a/SKILL.md', type: 'blob', sha: 'new-hash' }],
      });
      vi.mocked(blob.findSkillMdPaths).mockReturnValue(['skills/skill-a/SKILL.md']);
      vi.mocked(blob.getSkillFolderHashFromTree).mockReturnValue('new-hash');

      await updateGlobalSkills({ yes: true });

      const installCall = vi
        .mocked(spawnSync)
        .mock.calls.find((call) => Array.isArray(call[1]) && call[1].includes('add'));
      expect(installCall).toBeDefined();
      const [, argv, options] = installCall!;
      expect(argv).toEqual(
        expect.arrayContaining(['add', 'owner/repo/skills/skill-a', '--skill', 'skill-a'])
      );
      expect((options as { env?: NodeJS.ProcessEnv }).env?.GH_HOST).toBe('github.com');
    });

    it('keeps GitHub Enterprise updates on their recorded URL and targets one skill', async () => {
      vi.stubEnv('GH_HOST', 'github.example.com');
      vi.mocked(skillLock.readSkillLock).mockResolvedValue({
        version: 3,
        skills: {
          'skill-a': {
            source: 'https://github.example.com/acme/skills.git',
            sourceUrl: 'https://github.example.com/acme/skills.git',
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

      const installCall = vi
        .mocked(spawnSync)
        .mock.calls.find((call) => Array.isArray(call[1]) && call[1].includes('add'));
      expect(installCall).toBeDefined();
      const [, argv, options] = installCall!;
      expect(argv).toEqual(
        expect.arrayContaining([
          'add',
          'https://github.example.com/acme/skills.git',
          '--skill',
          'skill-a',
        ])
      );
      expect((options as { env?: NodeJS.ProcessEnv }).env).toBeUndefined();
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
    it('respects both explicit scopes when filtering by skill name', async () => {
      await expect(
        resolveUpdateScope({
          global: true,
          project: true,
          skills: ['skill-a'],
        })
      ).resolves.toBe('both');
    });

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

    it('checks both project and global scopes without applying updates', async () => {
      vi.mocked(skillLock.readSkillLock).mockResolvedValue({
        version: 3,
        skills: {
          'global-skill': {
            source: 'owner/global',
            sourceUrl: 'https://github.com/owner/global.git',
            skillPath: 'skills/global-skill/SKILL.md',
            sourceType: 'github',
            skillFolderHash: 'old-global-hash',
            installedAt: '',
            updatedAt: '',
          },
        },
      });
      vi.mocked(localLock.readLocalLock).mockResolvedValue({
        version: 1,
        skills: {
          'project-skill': {
            source: 'owner/project',
            skillPath: 'skills/project-skill/SKILL.md',
            sourceType: 'github',
            computedHash: 'old-project-hash',
          },
        },
      });
      vi.mocked(blob.fetchRepoTree).mockResolvedValue({
        sha: 'rootsha',
        branch: 'main',
        tree: [
          {
            path: 'skills/global-skill/SKILL.md',
            type: 'blob',
            sha: 'global-skill-md-sha',
          },
          { path: 'skills/global-skill', type: 'tree', sha: 'new-global-hash' },
        ],
      });
      vi.mocked(blob.getSkillFolderHashFromTree).mockReturnValue('new-global-hash');
      vi.mocked(git.cloneRepo).mockResolvedValue('/tmp/project-repo');
      vi.mocked(skills.discoverSkills).mockResolvedValue([
        {
          name: 'project-skill',
          path: '/tmp/project-repo/skills/project-skill',
          description: 'Project skill',
          rawContent: '',
        },
      ]);
      vi.mocked(localLock.computeSkillFolderHash)
        .mockResolvedValueOnce('new-project-hash')
        .mockResolvedValueOnce('old-project-hash');

      await runUpdate(['--global', '--project', '--yes'], 'check');

      expect(skillLock.readSkillLock).toHaveBeenCalled();
      expect(localLock.readLocalLock).toHaveBeenCalled();
      expect(spawnSync).not.toHaveBeenCalled();
      expect(remove.removeCommand).not.toHaveBeenCalled();
      expect(p.confirm).not.toHaveBeenCalled();
      expect(process.exitCode).toBeUndefined();
    });
  });
});
