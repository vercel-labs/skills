import { describe, it, expect, vi } from 'vitest';
import { evaluateSkillStatus } from '../src/status.ts';
import type { InstalledSkill } from '../src/installer.ts';
import type { LocalSkillLockFile } from '../src/local-lock.ts';
import type { SkillLockFile } from '../src/skill-lock.ts';

const baseLocalSkill: InstalledSkill = {
  name: 'local-skill',
  description: 'Local skill for testing',
  path: '/tmp/local',
  canonicalPath: '/tmp/local',
  scope: 'project',
  agents: [],
};

const baseGlobalSkill: InstalledSkill = {
  name: 'global-skill',
  description: 'Global skill for testing',
  path: '/tmp/global',
  canonicalPath: '/tmp/global',
  scope: 'global',
  agents: [],
};

const emptyGlobalLock: SkillLockFile = {
  version: 3,
  skills: {},
  dismissed: {},
};

const localLock: LocalSkillLockFile = {
  version: 1,
  skills: {
    'local-skill': {
      source: 'local',
      sourceType: 'local',
      computedHash: 'expected-hash',
    },
  },
};

describe('evaluateSkillStatus', () => {
  it('flags a tracked skill when the lock hash matches', async () => {
    const hashFn = vi.fn(async () => 'expected-hash');

    const statuses = await evaluateSkillStatus([baseLocalSkill], emptyGlobalLock, localLock, {
      hashFn,
    });

    expect(statuses).toHaveLength(1);
    expect(statuses[0]).toEqual({
      name: 'local-skill',
      scope: 'project',
      status: 'tracked',
      installedPath: '/tmp/local',
      canonicalPath: '/tmp/local',
      lockType: 'local',
      expectedHash: 'expected-hash',
      actualHash: 'expected-hash',
    });
    expect(hashFn).toHaveBeenCalledTimes(1);
  });

  it('reports missing lock entry when the skill is not tracked', async () => {
    const statuses = await evaluateSkillStatus([baseLocalSkill], emptyGlobalLock, {
      version: 1,
      skills: {},
    });

    expect(statuses).toEqual([
      {
        name: 'local-skill',
        scope: 'project',
        status: 'missing-lock-entry',
        installedPath: '/tmp/local',
        canonicalPath: '/tmp/local',
      },
    ]);
  });

  it('flags hash mismatch for global skills when hashes diverge', async () => {
    const hashFn = vi.fn(async () => 'local-hash');
    const statuses = await evaluateSkillStatus(
      [baseGlobalSkill],
      {
        version: 3,
        skills: {
          'global-skill': {
            source: 'owner/repo',
            sourceType: 'github',
            sourceUrl: 'https://github.com/owner/repo',
            skillPath: 'skills/global-skill',
            skillFolderHash: 'remote-hash',
            installedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        },
        dismissed: {},
      },
      { version: 1, skills: {} },
      { hashFn }
    );

    expect(statuses).toHaveLength(1);
    expect(statuses[0]?.status).toBe('hash-mismatch');
    expect(statuses[0]?.expectedHash).toBe('remote-hash');
    expect(statuses[0]?.actualHash).toBe('local-hash');
  });
});
