import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  readSkillLock,
  writeSkillLock,
  readGlobalManagementState,
  writeGlobalManagementState,
  getGlobalSkillGroups,
  getGlobalManagerSkill,
  scrubSkillFromGlobalManagement,
  getSkillLockPath,
} from '../src/skill-lock.ts';

describe('skill-lock', () => {
  let stateDir: string;
  let originalXdgStateHome: string | undefined;

  beforeEach(async () => {
    stateDir = await mkdtemp(join(tmpdir(), 'skill-lock-test-'));
    originalXdgStateHome = process.env.XDG_STATE_HOME;
    process.env.XDG_STATE_HOME = stateDir;
  });

  afterEach(async () => {
    if (originalXdgStateHome === undefined) {
      delete process.env.XDG_STATE_HOME;
    } else {
      process.env.XDG_STATE_HOME = originalXdgStateHome;
    }
    await rm(stateDir, { recursive: true, force: true });
  });

  describe('readSkillLock', () => {
    it('returns an empty v4 lock when the file does not exist', async () => {
      await expect(readSkillLock()).resolves.toEqual({
        version: 4,
        skills: {},
        dismissed: {},
        management: {
          groups: {},
        },
      });
    });

    it('migrates a v3 lock file to v4 without losing global state', async () => {
      const lockPath = getSkillLockPath();
      await mkdir(join(stateDir, 'skills'), { recursive: true });
      await writeFile(
        lockPath,
        JSON.stringify({
          version: 3,
          skills: {
            'api-design': {
              source: 'vercel-labs/skills',
              sourceType: 'github',
              sourceUrl: 'https://github.com/vercel-labs/skills',
              skillFolderHash: 'tree-sha',
              installedAt: '2026-04-07T00:00:00.000Z',
              updatedAt: '2026-04-07T00:00:00.000Z',
            },
          },
          dismissed: {
            findSkillsPrompt: true,
          },
          lastSelectedAgents: ['codex'],
        }),
        'utf-8'
      );

      await expect(readSkillLock()).resolves.toEqual({
        version: 4,
        skills: {
          'api-design': {
            source: 'vercel-labs/skills',
            sourceType: 'github',
            sourceUrl: 'https://github.com/vercel-labs/skills',
            skillFolderHash: 'tree-sha',
            installedAt: '2026-04-07T00:00:00.000Z',
            updatedAt: '2026-04-07T00:00:00.000Z',
          },
        },
        dismissed: {
          findSkillsPrompt: true,
        },
        lastSelectedAgents: ['codex'],
        management: {
          groups: {},
        },
      });
    });
  });

  describe('writeSkillLock', () => {
    it('writes deterministic management state', async () => {
      await writeSkillLock({
        version: 4,
        skills: {
          zebra: {
            source: 'org/z',
            sourceType: 'github',
            sourceUrl: 'https://github.com/org/z',
            skillFolderHash: 'zzz',
            installedAt: '2026-04-07T00:00:00.000Z',
            updatedAt: '2026-04-07T00:00:00.000Z',
          },
        },
        dismissed: {},
        management: {
          groups: {
            Architecture: ['zebra', 'alpha', 'zebra'],
            ai: ['middle', 'alpha'],
          },
          managerSkill: 'find-skills',
        },
      });

      const raw = await readFile(getSkillLockPath(), 'utf-8');
      const parsed = JSON.parse(raw);

      expect(Object.keys(parsed.management.groups)).toEqual(['ai', 'architecture']);
      expect(parsed.management.groups.ai).toEqual(['alpha', 'middle']);
      expect(parsed.management.groups.architecture).toEqual(['alpha', 'zebra']);
      expect(parsed.management.managerSkill).toBe('find-skills');
    });
  });

  describe('management helpers', () => {
    it('writes and reads normalized management state', async () => {
      await writeGlobalManagementState({
        groups: {
          Architecture: ['zebra', 'alpha', 'zebra'],
          ai: ['middle', 'alpha'],
        },
        managerSkill: 'find-skills',
      });

      await expect(readGlobalManagementState()).resolves.toEqual({
        groups: {
          ai: ['alpha', 'middle'],
          architecture: ['alpha', 'zebra'],
        },
        managerSkill: 'find-skills',
      });
    });

    it('resolves skill groups and manager skill from global management state', async () => {
      await writeGlobalManagementState({
        groups: {
          architecture: ['api-design', 'schema'],
          ai: ['api-design'],
        },
        managerSkill: 'find-skills',
      });

      await expect(getGlobalSkillGroups('api-design')).resolves.toEqual(['ai', 'architecture']);
      await expect(getGlobalSkillGroups('missing')).resolves.toEqual([]);
      await expect(getGlobalManagerSkill()).resolves.toBe('find-skills');
    });

    it('scrubs removed skills from groups and clears manager designation', async () => {
      await writeGlobalManagementState({
        groups: {
          ai: ['api-design'],
          architecture: ['api-design', 'schema'],
        },
        managerSkill: 'api-design',
      });

      await scrubSkillFromGlobalManagement('api-design');

      await expect(readGlobalManagementState()).resolves.toEqual({
        groups: {
          ai: [],
          architecture: ['schema'],
        },
      });
    });
  });
});
