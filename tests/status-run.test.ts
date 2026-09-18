import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InstalledSkill } from '../src/installer.ts';
import type { LocalSkillLockFile } from '../src/local-lock.ts';
import type { SkillLockFile } from '../src/skill-lock.ts';
import { stripAnsi } from '../src/test-utils.ts';

const mocks = vi.hoisted(() => ({
  listInstalledSkills: vi.fn(),
  getAllLockedSkills: vi.fn(),
  readLocalLock: vi.fn(),
  computeSkillFolderHash: vi.fn(),
}));

vi.mock('../src/installer.ts', async () => {
  const actual = await vi.importActual<typeof import('../src/installer.ts')>('../src/installer.ts');
  return {
    ...actual,
    listInstalledSkills: mocks.listInstalledSkills,
  };
});

vi.mock('../src/skill-lock.ts', async () => {
  const actual =
    await vi.importActual<typeof import('../src/skill-lock.ts')>('../src/skill-lock.ts');
  return {
    ...actual,
    getAllLockedSkills: mocks.getAllLockedSkills,
  };
});

vi.mock('../src/local-lock.ts', async () => {
  const actual =
    await vi.importActual<typeof import('../src/local-lock.ts')>('../src/local-lock.ts');
  return {
    ...actual,
    readLocalLock: mocks.readLocalLock,
    computeSkillFolderHash: mocks.computeSkillFolderHash,
  };
});

const statusModulePromise = import('../src/status.ts');

describe('runStatus', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  it('prints tracked, missing, and mismatched skills in text mode', async () => {
    const installedSkills: InstalledSkill[] = [
      {
        name: 'tracked-skill',
        description: 'Tracked',
        path: '/tmp/tracked',
        canonicalPath: '/tmp/tracked',
        scope: 'project',
        agents: [],
      },
      {
        name: 'missing-skill',
        description: 'Missing',
        path: '/tmp/missing',
        canonicalPath: '/tmp/missing',
        scope: 'project',
        agents: [],
      },
      {
        name: 'mismatched-skill',
        description: 'Mismatch',
        path: '/tmp/mismatch',
        canonicalPath: '/tmp/mismatch',
        scope: 'global',
        agents: [],
      },
    ];

    const globalLock: SkillLockFile = {
      version: 3,
      skills: {
        'mismatched-skill': {
          source: 'owner/repo',
          sourceType: 'github',
          sourceUrl: 'https://github.com/owner/repo',
          skillFolderHash: 'remote-hash',
          installedAt: '2025-01-01T00:00:00.000Z',
          updatedAt: '2025-01-01T00:00:00.000Z',
        },
      },
      dismissed: {},
    };

    const localLock: LocalSkillLockFile = {
      version: 1,
      skills: {
        'tracked-skill': {
          source: 'local',
          sourceType: 'local',
          computedHash: 'tracked-hash',
        },
      },
    };

    mocks.listInstalledSkills.mockResolvedValue(installedSkills);
    mocks.getAllLockedSkills.mockResolvedValue(globalLock.skills);
    mocks.readLocalLock.mockResolvedValue(localLock);
    mocks.computeSkillFolderHash.mockImplementation(async (skillDir: string) => {
      if (skillDir === '/tmp/tracked') return 'tracked-hash';
      if (skillDir === '/tmp/mismatch') return 'local-hash';
      return 'unknown-hash';
    });

    const { runStatus } = await statusModulePromise;
    await runStatus([]);

    const output = stripAnsi(
      consoleLogSpy.mock.calls
        .flat()
        .map((value) => String(value))
        .join('\n')
    );

    expect(output).toContain('Project Status');
    expect(output).toContain('Tracked');
    expect(output).toContain('tracked-skill');
    expect(output).toContain('Missing lock entry');
    expect(output).toContain('missing-skill');
    expect(output).toContain('Hash mismatch');
    expect(output).toContain('mismatched-skill');
    expect(output).toContain('Expected: remote-hash');
    expect(mocks.listInstalledSkills).toHaveBeenCalledWith({ global: false });
  });

  it('keeps JSON output machine-readable', async () => {
    const installedSkills: InstalledSkill[] = [
      {
        name: 'json-skill',
        description: 'JSON',
        path: '/tmp/json',
        canonicalPath: '/tmp/json',
        scope: 'project',
        agents: [],
      },
    ];

    const localLock: LocalSkillLockFile = {
      version: 1,
      skills: {
        'json-skill': {
          source: 'local',
          sourceType: 'local',
          computedHash: 'json-hash',
        },
      },
    };

    mocks.listInstalledSkills.mockResolvedValue(installedSkills);
    mocks.getAllLockedSkills.mockResolvedValue({});
    mocks.readLocalLock.mockResolvedValue(localLock);
    mocks.computeSkillFolderHash.mockResolvedValue('json-hash');

    const { runStatus } = await statusModulePromise;
    await runStatus(['--json']);

    const output = consoleLogSpy.mock.calls
      .flat()
      .map((value) => String(value))
      .join('\n');
    const parsed = JSON.parse(output);

    expect(parsed).toEqual([
      {
        name: 'json-skill',
        scope: 'project',
        status: 'tracked',
        installedPath: '/tmp/json',
        canonicalPath: '/tmp/json',
        lockType: 'local',
        expectedHash: 'json-hash',
        actualHash: 'json-hash',
      },
    ]);
    expect(output).not.toContain('Project Status');
  });

  it('uses global scope when -g is provided', async () => {
    mocks.listInstalledSkills.mockResolvedValue([]);
    mocks.getAllLockedSkills.mockResolvedValue({});
    mocks.readLocalLock.mockResolvedValue({ version: 1, skills: {} });

    const { runStatus } = await statusModulePromise;
    await runStatus(['-g']);

    expect(mocks.listInstalledSkills).toHaveBeenCalledWith({ global: true });
  });
});
