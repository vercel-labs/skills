import { afterEach, describe, it, expect, vi, beforeEach } from 'vitest';
import { updateProjectSkills, updateGlobalSkills, runUpdate } from '../src/update.ts';
import * as add from '../src/add.ts';
import * as git from '../src/git.ts';
import * as skills from '../src/skills.ts';
import * as blob from '../src/blob.ts';
import * as localLock from '../src/local-lock.ts';
import * as skillLock from '../src/skill-lock.ts';
import * as remove from '../src/remove.ts';
import * as installer from '../src/installer.ts';
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
vi.mock('../src/installer.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/installer.ts')>()),
  listInstalledSkills: vi.fn(),
}));
vi.mock('@clack/prompts');

// Stub the network and disk seams of add.ts; keep its pure helpers real.
vi.mock('../src/add.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/add.ts')>();
  return {
    ...actual,
    nonInteractiveTargetAgents: vi.fn(),
    fetchSources: vi.fn(),
    installFetched: vi.fn(),
    installToTargets: vi.fn(),
    releaseSource: vi.fn(),
    recordProjectLock: vi.fn(),
    recordGlobalWellKnownLock: vi.fn(),
  };
});

// Mock fs to prevent actual file checks during test
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    existsSync: vi.fn().mockReturnValue(true),
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

/** Every target accepts every skill unless a test says otherwise. */
function acceptAll(): void {
  vi.mocked(add.installToTargets).mockImplementation(async (_resolved, skills, placement) =>
    skills.flatMap((skill) =>
      placement.targets.map((target) => ({
        skill: skill.name,
        agent: target.agent,
        success: true,
        path: `/installed/${skill.name}`,
        mode: placement.mode,
      }))
    )
  );
  vi.mocked(add.installFetched).mockImplementation(async (_fetched, { skills }) => ({
    installed: skills.map((name) => ({ skill: { name, description: '', path: '' }, hash: 'h' })),
    failed: [],
  }));
}

/** The parsed sources `fetchSources` was asked for, in order. */
function fetchedParsed() {
  return vi.mocked(add.fetchSources).mock.calls.flatMap(([requests]) => requests);
}

describe('Update Cleanup Unit Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.exitCode = undefined;
    process.env.DISABLE_TELEMETRY = '1';
    vi.mocked(add.nonInteractiveTargetAgents).mockResolvedValue(['cursor']);
    vi.mocked(add.fetchSources).mockImplementation(async (requests) =>
      requests.map(({ parsed }) => ({
        parsed,
        resolved: { skills: [], tempDir: null, blobResult: null },
      }))
    );
    acceptAll();
    // Every locked skill is on disk unless a test says otherwise.
    vi.mocked(installer.listInstalledSkills).mockImplementation(async ({ global } = {}) => {
      const lock = global ? await skillLock.readSkillLock() : await localLock.readLocalLock();
      return Object.keys(lock.skills).map((name) => ({
        name,
        description: '',
        path: '',
        canonicalPath: '',
        scope: global ? 'global' : 'project',
        agents: [],
      }));
    });
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
        includeDuplicateNames: true,
      });
      expect(p.confirm).not.toHaveBeenCalled();
      expect(remove.removeCommand).not.toHaveBeenCalled();
    });

    it('updates a relocated project skill from its canonical path', async () => {
      vi.mocked(localLock.readLocalLock).mockResolvedValue({
        version: 1,
        skills: {
          'swiftui-expert-skill': {
            source: 'owner/repo',
            sourceType: 'github',
            skillPath: 'swiftui-expert-skill/SKILL.md',
            computedHash: 'same-hash',
          },
        },
      });
      vi.mocked(git.cloneRepo).mockResolvedValue('/tmp/repo');
      vi.mocked(skills.discoverSkills).mockResolvedValue([
        {
          name: 'swiftui-expert-skill',
          path: '/tmp/repo/skills/swiftui-expert-skill',
          description: 'SwiftUI guidance',
          rawContent: '',
        },
      ]);
      // Content is unchanged; the relocation alone must trigger the reinstall.
      vi.mocked(localLock.computeSkillFolderHash).mockResolvedValue('same-hash');

      await updateProjectSkills({ yes: true });

      expect(p.confirm).not.toHaveBeenCalled();
      expect(remove.removeCommand).not.toHaveBeenCalled();
      expect(add.installToTargets).toHaveBeenCalledWith(
        expect.objectContaining({ tempDir: '/tmp/repo' }),
        [expect.objectContaining({ path: '/tmp/repo/skills/swiftui-expert-skill' })],
        expect.anything()
      );
      expect(localLock.addSkillToLocalLock).toHaveBeenCalledWith(
        'swiftui-expert-skill',
        expect.objectContaining({
          skillPath: 'skills/swiftui-expert-skill/SKILL.md',
          computedHash: 'same-hash',
        })
      );
    });

    it('does not reinstall a project skill whose content hash is unchanged', async () => {
      vi.mocked(localLock.readLocalLock).mockResolvedValue({
        version: 1,
        skills: {
          'skill-a': {
            source: 'owner/repo',
            sourceType: 'github',
            skillPath: 'skills/skill-a/SKILL.md',
            computedHash: 'same-hash',
          },
        },
      });
      vi.mocked(git.cloneRepo).mockResolvedValue('/tmp/repo');
      vi.mocked(skills.discoverSkills).mockResolvedValue([
        { name: 'skill-a', path: '/tmp/repo/skills/skill-a', description: 'A', rawContent: '' },
      ]);
      vi.mocked(localLock.computeSkillFolderHash).mockResolvedValue('same-hash');
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const result = await updateProjectSkills({ yes: true });

      expect(localLock.computeSkillFolderHash).toHaveBeenCalledWith('/tmp/repo/skills/skill-a');
      expect(add.installToTargets).not.toHaveBeenCalled();
      expect(result).toEqual({ successCount: 0, failCount: 0, foundCount: 1 });
      expect(logSpy.mock.calls.flat().join('\n')).toContain('All project skills are up to date');
      logSpy.mockRestore();
    });

    it('reinstalls only the project skills whose content hash changed', async () => {
      vi.mocked(localLock.readLocalLock).mockResolvedValue({
        version: 1,
        skills: {
          'skill-a': {
            source: 'owner/repo',
            sourceType: 'github',
            skillPath: 'skills/skill-a/SKILL.md',
            computedHash: 'hash-a',
          },
          'skill-b': {
            source: 'owner/repo',
            sourceType: 'github',
            skillPath: 'skills/skill-b/SKILL.md',
            computedHash: 'hash-b-old',
          },
        },
      });
      vi.mocked(git.cloneRepo).mockResolvedValue('/tmp/repo');
      vi.mocked(skills.discoverSkills).mockResolvedValue([
        { name: 'skill-a', path: '/tmp/repo/skills/skill-a', description: 'A', rawContent: '' },
        { name: 'skill-b', path: '/tmp/repo/skills/skill-b', description: 'B', rawContent: '' },
      ]);
      vi.mocked(localLock.computeSkillFolderHash).mockImplementation(async (dir) =>
        dir.endsWith('skill-a') ? 'hash-a' : 'hash-b-new'
      );

      const result = await updateProjectSkills({ yes: true });

      expect(add.installToTargets).toHaveBeenCalledTimes(1);
      expect(add.installToTargets).toHaveBeenCalledWith(
        expect.anything(),
        [expect.objectContaining({ name: 'skill-b' })],
        expect.anything()
      );
      expect(localLock.addSkillToLocalLock).toHaveBeenCalledWith(
        'skill-b',
        expect.objectContaining({ computedHash: 'hash-b-new' })
      );
      expect(result.successCount).toBe(1);
    });

    it('skips an ambiguous relocated project skill without deleting it', async () => {
      vi.mocked(localLock.readLocalLock).mockResolvedValue({
        version: 1,
        skills: {
          'skill-a': {
            source: 'owner/repo',
            sourceType: 'github',
            skillPath: 'old/skill-a/SKILL.md',
            computedHash: 'old-hash',
          },
        },
      });
      vi.mocked(git.cloneRepo).mockResolvedValue('/tmp/repo');
      vi.mocked(skills.discoverSkills).mockResolvedValue([
        {
          name: 'skill-a',
          path: '/tmp/repo/skills/skill-a',
          description: 'First',
          rawContent: '',
        },
        {
          name: 'skill-a',
          path: '/tmp/repo/plugins/example/skill-a',
          description: 'Second',
          rawContent: '',
        },
      ]);

      await updateProjectSkills({ yes: true });

      expect(p.confirm).not.toHaveBeenCalled();
      expect(remove.removeCommand).not.toHaveBeenCalled();
      expect(add.installToTargets).not.toHaveBeenCalled();
    });

    it('updates a GitHub skill from its locked path when a same-name mirror exists', async () => {
      vi.mocked(localLock.readLocalLock).mockResolvedValue({
        version: 1,
        skills: {
          'skill-a': {
            source: 'owner/repo',
            sourceType: 'github',
            skillPath: 'skills/skill-a/SKILL.md',
            computedHash: 'old-hash',
          },
        },
      });
      vi.mocked(git.cloneRepo).mockResolvedValue('/tmp/repo');
      vi.mocked(skills.discoverSkills).mockResolvedValue([
        {
          name: 'skill-a',
          path: '/tmp/repo/skills/skill-a',
          description: 'Locked location',
          rawContent: '',
        },
        {
          name: 'skill-a',
          path: '/tmp/repo/.openclaw/skills/skill-a',
          description: 'Mirror',
          rawContent: '',
        },
      ]);

      await updateProjectSkills({ yes: true });

      expect(add.installToTargets).toHaveBeenCalledTimes(1);
      expect(add.installToTargets).toHaveBeenCalledWith(
        expect.anything(),
        [expect.objectContaining({ path: '/tmp/repo/skills/skill-a' })],
        expect.anything()
      );
    });

    it('does not reinstall an ambiguous exact-path skill from a generic Git source', async () => {
      vi.mocked(localLock.readLocalLock).mockResolvedValue({
        version: 1,
        skills: {
          'skill-a': {
            source: 'owner/repo',
            sourceUrl: 'git@example.com:owner/repo.git',
            sourceType: 'git',
            skillPath: 'skills/skill-a/SKILL.md',
            computedHash: 'old-hash',
          },
        },
      });
      vi.mocked(git.cloneRepo).mockResolvedValue('/tmp/repo');
      vi.mocked(skills.discoverSkills).mockResolvedValue([
        {
          name: 'skill-a',
          path: '/tmp/repo/skills/skill-a',
          description: 'Locked location',
          rawContent: '',
        },
        {
          name: 'skill-a',
          path: '/tmp/repo/plugins/example/skill-a',
          description: 'Conflicting location',
          rawContent: '',
        },
      ]);

      await updateProjectSkills({ yes: true });

      expect(p.confirm).not.toHaveBeenCalled();
      expect(remove.removeCommand).not.toHaveBeenCalled();
      expect(add.installToTargets).not.toHaveBeenCalled();
    });

    it('does not reinstall project skills when source discovery fails', async () => {
      vi.mocked(localLock.readLocalLock).mockResolvedValue({
        version: 1,
        skills: {
          'skill-a': {
            source: 'owner/repo',
            sourceUrl: 'git@example.com:owner/repo.git',
            sourceType: 'git',
            skillPath: 'skills/skill-a/SKILL.md',
            computedHash: 'old-hash',
          },
        },
      });
      vi.mocked(git.cloneRepo).mockRejectedValue(new Error('clone failed'));

      const result = await updateProjectSkills({ yes: true });

      expect(result.failCount).toBe(1);
      expect(add.installToTargets).not.toHaveBeenCalled();
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
      expect(add.installToTargets).toHaveBeenCalledWith(
        expect.objectContaining({ tempDir: '/tmp/repo' }),
        [expect.objectContaining({ path: '/tmp/repo/plugins/example/skills/skill-a' })],
        expect.anything()
      );
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
      expect(add.installToTargets).toHaveBeenCalledWith(
        expect.anything(),
        [expect.objectContaining({ path: '/tmp/repo/plugins/example/skills/skill-a' })],
        expect.anything()
      );
    });

    it('reinstalls into the Eve subagents recorded at install time', async () => {
      vi.mocked(localLock.readLocalLock).mockResolvedValue({
        version: 1,
        skills: {
          'skill-a': {
            source: 'owner/repo',
            sourceType: 'github',
            skillPath: 'skills/skill-a/SKILL.md',
            computedHash: 'old-hash',
            subagents: ['', 'research'],
          },
        },
      });
      vi.mocked(git.cloneRepo).mockResolvedValue('/tmp/repo');
      vi.mocked(skills.discoverSkills).mockResolvedValue([
        { name: 'skill-a', path: '/tmp/repo/skills/skill-a', description: 'A', rawContent: '' },
      ]);
      vi.mocked(localLock.computeSkillFolderHash).mockResolvedValue('new-hash');

      await updateProjectSkills({ yes: true });

      expect(add.installToTargets).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({
          global: false,
          targets: [
            { agent: 'cursor' },
            { agent: 'eve', subagent: undefined },
            { agent: 'eve', subagent: 'research' },
          ],
        })
      );
      expect(localLock.addSkillToLocalLock).toHaveBeenCalledWith(
        'skill-a',
        expect.objectContaining({ subagents: ['', 'research'], computedHash: 'new-hash' })
      );
    });

    it('counts a skill no target accepted as failed and prints why', async () => {
      vi.mocked(localLock.readLocalLock).mockResolvedValue({
        version: 1,
        skills: {
          'skill-a': {
            source: 'owner/repo',
            sourceType: 'github',
            skillPath: 'skills/skill-a/SKILL.md',
            computedHash: 'old-hash',
          },
        },
      });
      vi.mocked(git.cloneRepo).mockResolvedValue('/tmp/repo');
      vi.mocked(skills.discoverSkills).mockResolvedValue([
        { name: 'skill-a', path: '/tmp/repo/skills/skill-a', description: 'A', rawContent: '' },
      ]);
      vi.mocked(add.installToTargets).mockResolvedValue([
        {
          skill: 'skill-a',
          agent: 'cursor',
          success: false,
          path: '',
          mode: 'copy',
          error: 'EACCES',
        },
      ]);
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      const result = await updateProjectSkills({ yes: true });

      expect(result.failCount).toBe(1);
      expect(localLock.addSkillToLocalLock).not.toHaveBeenCalled();
      expect(logSpy.mock.calls.flat().join('\n')).toContain('cursor: EACCES');
      logSpy.mockRestore();
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

      expect(git.cloneRepo).toHaveBeenCalledWith('https://github.com/owner/repo.git', undefined);
      expect(add.installToTargets).toHaveBeenCalledTimes(1);
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
      expect(add.installToTargets).not.toHaveBeenCalled();
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
      vi.mocked(git.cloneRepo).mockResolvedValue('/tmp/repo');
      vi.mocked(skills.discoverSkills).mockResolvedValue([
        { name: 'skill-a', path: '/tmp/repo/skills/skill-a', description: 'A', rawContent: '' },
      ]);

      vi.mocked(p.confirm).mockResolvedValue(true);

      await updateGlobalSkills();

      expect(p.confirm).toHaveBeenCalled();
      expect(remove.removeCommand).toHaveBeenCalledWith(
        ['skill-b'],
        expect.objectContaining({ yes: true, global: true })
      );
    });

    it('updates an exact-path global GitHub skill when fallback discovery finds a mirror', async () => {
      const oldHash = 'a'.repeat(40);
      const newHash = 'b'.repeat(40);
      vi.mocked(skillLock.readSkillLock).mockResolvedValue({
        version: 3,
        skills: {
          'skill-a': {
            source: 'owner/repo',
            sourceType: 'github',
            sourceUrl: 'https://github.com/owner/repo',
            skillPath: 'skills/skill-a/SKILL.md',
            skillFolderHash: oldHash,
            installedAt: '',
            updatedAt: '',
          },
        },
      });
      vi.mocked(blob.fetchRepoTree).mockResolvedValue(null);
      vi.mocked(git.cloneRepo).mockResolvedValue('/tmp/repo');
      vi.mocked(skills.discoverSkills).mockResolvedValue([
        {
          name: 'skill-a',
          path: '/tmp/repo/skills/skill-a',
          description: 'Locked location',
          rawContent: '',
        },
        {
          name: 'skill-a',
          path: '/tmp/repo/.openclaw/skills/skill-a',
          description: 'Mirror',
          rawContent: '',
        },
      ]);
      vi.mocked(git.getGitTreeHash).mockResolvedValue(newHash);

      await updateGlobalSkills({ yes: true });

      expect(git.getGitTreeHash).toHaveBeenCalledWith('/tmp/repo', 'skills/skill-a/SKILL.md');
      expect(fetchedParsed()).toEqual([
        expect.objectContaining({
          parsed: expect.objectContaining({ subpath: 'skills/skill-a' }),
          skills: ['skill-a'],
        }),
      ]);
      expect(skillLock.addSkillToLock).toHaveBeenCalledWith(
        'skill-a',
        expect.objectContaining({ skillFolderHash: newHash })
      );
    });

    it('reinstalls a relocated global skill even when its content hash is unchanged', async () => {
      const treeHash = 'a'.repeat(40);
      vi.mocked(skillLock.readSkillLock).mockResolvedValue({
        version: 3,
        skills: {
          'swiftui-expert-skill': {
            source: 'owner/repo',
            sourceType: 'github',
            skillPath: 'swiftui-expert-skill/SKILL.md',
            skillFolderHash: treeHash,
            installedAt: '',
            updatedAt: '',
          },
        },
      });
      vi.mocked(blob.fetchRepoTree).mockResolvedValue({
        sha: 'rootsha',
        branch: 'main',
        tree: [
          {
            path: 'skills/swiftui-expert-skill/SKILL.md',
            type: 'blob',
            sha: 'blobsha',
          },
          {
            path: 'skills/swiftui-expert-skill',
            type: 'tree',
            sha: treeHash,
          },
        ],
      });
      vi.mocked(git.cloneRepo).mockResolvedValue('/tmp/repo');
      vi.mocked(skills.discoverSkills).mockResolvedValue([
        {
          name: 'swiftui-expert-skill',
          path: '/tmp/repo/skills/swiftui-expert-skill',
          description: 'SwiftUI guidance',
          rawContent: '',
        },
      ]);
      vi.mocked(git.getGitTreeHash).mockResolvedValue(treeHash);

      await updateGlobalSkills({ yes: true });

      expect(p.confirm).not.toHaveBeenCalled();
      expect(remove.removeCommand).not.toHaveBeenCalled();
      expect(git.getGitTreeHash).toHaveBeenCalledWith(
        '/tmp/repo',
        'skills/swiftui-expert-skill/SKILL.md'
      );
      expect(fetchedParsed()).toEqual([
        expect.objectContaining({
          parsed: expect.objectContaining({ subpath: 'skills/swiftui-expert-skill' }),
        }),
      ]);
      expect(skillLock.addSkillToLock).toHaveBeenCalledWith(
        'swiftui-expert-skill',
        expect.objectContaining({ skillPath: 'skills/swiftui-expert-skill/SKILL.md' })
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

    it('does not delete a skill from the same repo pinned to a different ref', async () => {
      vi.mocked(skillLock.readSkillLock).mockResolvedValue({
        version: 3,
        skills: {
          'skill-a': {
            source: 'owner/repo',
            ref: 'v1',
            skillPath: 'skills/skill-a/SKILL.md',
            sourceType: 'github',
            skillFolderHash: 'abc',
            installedAt: '',
            updatedAt: '',
          },
          'skill-b': {
            source: 'owner/repo',
            ref: 'v2',
            skillPath: 'skills/skill-b/SKILL.md',
            sourceType: 'github',
            skillFolderHash: 'def',
            installedAt: '',
            updatedAt: '',
          },
        },
      });

      // Each ref exposes only its own skill.
      vi.mocked(blob.fetchRepoTree).mockImplementation(async (_source, ref) => {
        const isV2 = ref === 'v2';
        const dir = isV2 ? 'skills/skill-b' : 'skills/skill-a';
        return {
          sha: 'rootsha',
          branch: 'main',
          tree: [
            { path: `${dir}/SKILL.md`, type: 'blob', sha: 'blobsha' },
            { path: dir, type: 'tree', sha: isV2 ? 'def' : 'abc' },
          ],
        };
      });
      vi.mocked(p.confirm).mockResolvedValue(true);

      await updateGlobalSkills();

      // Before the fix, skill-b was grouped with skill-a by source alone and
      // checked against v1's tree, then reported deleted upstream and removed.
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
      expect(add.installFetched).toHaveBeenCalledTimes(1);
      expect(skillLock.addSkillToLock).toHaveBeenCalledWith(
        'skill-a',
        expect.objectContaining({ skillFolderHash: 'new-content-hash' })
      );
    });

    it.each([
      ['does not report an unchanged Git tree SHA as updated after an API fallback', true, 0],
      ['reinstalls an unchanged missing skill after an API fallback', false, 1],
    ])('%s', async (_title, onDisk, installs) => {
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
      if (!onDisk) vi.mocked(installer.listInstalledSkills).mockResolvedValue([]);

      await updateGlobalSkills({ yes: true });

      expect(git.getGitTreeHash).toHaveBeenCalledWith(
        '/tmp/private-repo',
        'skills/skill-a/SKILL.md'
      );
      expect(add.installFetched).toHaveBeenCalledTimes(installs);
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
        includeDuplicateNames: true,
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
      // The whole repo is fetched and the skill picked out by name, since an
      // SSH URL cannot carry a subpath.
      expect(fetchedParsed()).toEqual([
        expect.objectContaining({ skills: ['skill-a'], fullDepth: true }),
      ]);
      expect(fetchedParsed()[0]!.parsed.subpath).toBeUndefined();
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
      expect(fetchedParsed()).toEqual([
        expect.objectContaining({
          parsed: expect.objectContaining({ url: 'https://gitlab.example.com/acme/skills.git' }),
          skills: ['skill-a'],
        }),
      ]);
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

      expect(fetchedParsed()).toEqual([
        expect.objectContaining({
          parsed: expect.objectContaining({
            type: 'github',
            url: 'https://github.com/owner/repo.git',
            subpath: 'skills/skill-a',
          }),
        }),
      ]);
      expect(skillLock.addSkillToLock).toHaveBeenCalledWith(
        'skill-a',
        expect.objectContaining({ skillFolderHash: 'new-hash' })
      );
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

      expect(fetchedParsed()).toEqual([
        expect.objectContaining({
          parsed: expect.objectContaining({ url: 'https://github.example.com/acme/skills.git' }),
          skills: ['skill-a'],
        }),
      ]);
    });

    it('keeps the locked ref when refetching a global update', async () => {
      vi.mocked(skillLock.readSkillLock).mockResolvedValue({
        version: 3,
        skills: {
          'skill-a': {
            source: 'owner/repo',
            skillPath: 'skills/skill-a/SKILL.md',
            sourceType: 'github',
            skillFolderHash: 'old-hash',
            ref: 'v2',
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
      vi.mocked(blob.getSkillFolderHashFromTree).mockReturnValue('new-hash');

      await updateGlobalSkills({ yes: true });

      expect(fetchedParsed()).toEqual([
        expect.objectContaining({ parsed: expect.objectContaining({ ref: 'v2' }) }),
      ]);
    });

    it('reinstalls an unchanged global skill whose folder is missing', async () => {
      vi.mocked(skillLock.readSkillLock).mockResolvedValue({
        version: 3,
        skills: {
          'skill-a': {
            source: 'owner/repo',
            skillPath: 'skills/skill-a/SKILL.md',
            sourceType: 'github',
            skillFolderHash: 'same',
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
      vi.mocked(blob.getSkillFolderHashFromTree).mockReturnValue('same');
      vi.mocked(installer.listInstalledSkills).mockResolvedValue([]);

      const result = await updateGlobalSkills({ yes: true });

      expect(result.successCount).toBe(1);
    });

    it('reinstalls a copied global skill as a copy', async () => {
      // Two target dirs, so the default would be a symlink.
      vi.mocked(add.nonInteractiveTargetAgents).mockResolvedValue(['cursor', 'claude-code']);
      vi.mocked(skillLock.readSkillLock).mockResolvedValue({
        version: 3,
        skills: {
          'skill-a': {
            source: 'owner/repo',
            skillPath: 'skills/skill-a/SKILL.md',
            sourceType: 'github',
            skillFolderHash: 'old',
            installedAt: '',
            updatedAt: '',
            installMode: 'copy',
          },
        },
      });
      vi.mocked(blob.fetchRepoTree).mockResolvedValue({
        sha: 'rootsha',
        branch: 'main',
        tree: [{ path: 'skills/skill-a/SKILL.md', type: 'blob', sha: 'sha1' }],
      });
      vi.mocked(blob.getSkillFolderHashFromTree).mockReturnValue('new');

      await updateGlobalSkills({ yes: true });

      expect(vi.mocked(add.installFetched).mock.calls[0]![1].placement.mode).toBe('copy');
    });

    it('fetches every global update before installing any', async () => {
      vi.mocked(skillLock.readSkillLock).mockResolvedValue({
        version: 3,
        skills: {
          'skill-a': {
            source: 'owner/repo',
            skillPath: 'skills/skill-a/SKILL.md',
            sourceType: 'github',
            skillFolderHash: 'old-a',
            installedAt: '',
            updatedAt: '',
          },
          'skill-b': {
            source: 'other/repo',
            skillPath: 'skills/skill-b/SKILL.md',
            sourceType: 'github',
            skillFolderHash: 'old-b',
            installedAt: '',
            updatedAt: '',
          },
        },
      });
      vi.mocked(blob.fetchRepoTree).mockImplementation(async (source) => ({
        sha: 'rootsha',
        branch: 'main',
        tree: [
          {
            path: source === 'owner/repo' ? 'skills/skill-a/SKILL.md' : 'skills/skill-b/SKILL.md',
            type: 'blob',
            sha: 'sha1',
          },
        ],
      }));
      vi.mocked(blob.getSkillFolderHashFromTree).mockReturnValue('new-hash');

      const result = await updateGlobalSkills({ yes: true });

      const batches = vi.mocked(add.fetchSources).mock.calls.filter(([r]) => r.length > 0);
      expect(batches).toHaveLength(1);
      expect(batches[0]![0].map((r) => r.skills)).toEqual([['skill-a'], ['skill-b']]);
      expect(add.installFetched).toHaveBeenCalledTimes(2);
      expect(result.successCount).toBe(2);
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
      vi.mocked(add.installToTargets).mockResolvedValue([
        {
          skill: 'skill-a',
          agent: 'cursor',
          success: false,
          path: '',
          mode: 'copy',
          error: 'boom',
        },
      ]);

      await runUpdate(['--project', '--yes']);

      expect(process.exitCode).toBe(1);
    });

    it('does not set a failure exit code when requested updates succeed', async () => {
      await runUpdate(['--project', '--yes']);

      expect(process.exitCode).toBeUndefined();
    });
  });

  describe('check', () => {
    it('picks a scope without prompting and installs no project update', async () => {
      vi.mocked(localLock.readLocalLock).mockResolvedValue({
        version: 1,
        skills: {
          'skill-a': {
            source: 'owner/repo',
            skillPath: 'skills/skill-a/SKILL.md',
            sourceType: 'github',
            computedHash: 'old',
          },
        },
      });
      vi.mocked(git.cloneRepo).mockResolvedValue('/tmp/repo');
      vi.mocked(skills.discoverSkills).mockResolvedValue([
        { name: 'skill-a', path: '/tmp/repo/skills/skill-a', description: 'A', rawContent: '' },
      ]);
      vi.mocked(localLock.computeSkillFolderHash).mockResolvedValue('new');

      await runUpdate([], 'check');

      expect(p.select).not.toHaveBeenCalled();
      expect(add.installToTargets).not.toHaveBeenCalled();
    });

    it('installs no global update', async () => {
      vi.mocked(skillLock.readSkillLock).mockResolvedValue({
        version: 3,
        skills: {
          'skill-a': {
            source: 'owner/repo',
            skillPath: 'skills/skill-a/SKILL.md',
            sourceType: 'github',
            skillFolderHash: 'old',
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
      vi.mocked(blob.getSkillFolderHashFromTree).mockReturnValue('new');

      await runUpdate(['-g'], 'check');

      expect(add.installFetched).not.toHaveBeenCalled();
    });
  });
});
