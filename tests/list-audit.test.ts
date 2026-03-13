import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InstalledSkill } from '../src/installer.ts';
import type { SkillLockEntry } from '../src/skill-lock.ts';
import type { LocalSkillLock } from '../src/local-lock.ts';
import { stripAnsi } from '../src/test-utils.ts';

const mocks = vi.hoisted(() => ({
  listInstalledSkills: vi.fn(),
  getAllLockedSkills: vi.fn(),
  readLocalLock: vi.fn(),
  fetchAuditData: vi.fn(),
}));

vi.mock('../src/installer.ts', () => ({
  listInstalledSkills: mocks.listInstalledSkills,
}));

vi.mock('../src/skill-lock.ts', () => ({
  getAllLockedSkills: mocks.getAllLockedSkills,
}));

vi.mock('../src/local-lock.ts', () => ({
  readLocalLock: mocks.readLocalLock,
}));

vi.mock('../src/telemetry.ts', async () => {
  const actual = await vi.importActual<typeof import('../src/telemetry.ts')>('../src/telemetry.ts');
  return {
    ...actual,
    fetchAuditData: mocks.fetchAuditData,
  };
});

const listModulePromise = import('../src/list.ts');

describe('runList --audit', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  it('appends security audit output in text mode', async () => {
    const installedSkills: InstalledSkill[] = [
      {
        name: 'alpha',
        description: 'Alpha skill',
        path: '/tmp/alpha',
        canonicalPath: '/tmp/alpha',
        scope: 'project',
        agents: [],
      },
    ];

    const lockedSkills: Record<string, SkillLockEntry> = {
      alpha: {
        source: 'vercel-labs/agent-skills',
        sourceType: 'github',
        sourceUrl: 'https://github.com/vercel-labs/agent-skills',
        skillFolderHash: 'tree-alpha',
        installedAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
      },
    };

    const localLock: LocalSkillLock = {
      version: 1,
      skills: {},
    };

    mocks.listInstalledSkills.mockResolvedValue(installedSkills);
    mocks.getAllLockedSkills.mockResolvedValue(lockedSkills);
    mocks.readLocalLock.mockResolvedValue(localLock);
    mocks.fetchAuditData.mockResolvedValue({
      alpha: {
        ath: { risk: 'high', analyzedAt: '2025-01-01T00:00:00.000Z' },
        socket: { risk: 'safe', alerts: 0, analyzedAt: '2025-01-01T00:00:00.000Z' },
        snyk: { risk: 'medium', analyzedAt: '2025-01-01T00:00:00.000Z' },
      },
    });

    const { runList } = await listModulePromise;
    await runList(['--audit']);

    const output = stripAnsi(
      consoleLogSpy.mock.calls
        .flat()
        .map((value) => String(value))
        .join('\n')
    );

    expect(output).toContain('Project Skills');
    expect(output).toContain('Security audit');
    expect(output).toContain('alpha');
    expect(output).toContain('Details: https://skills.sh/vercel-labs/agent-skills');
    expect(mocks.fetchAuditData).toHaveBeenCalledWith('vercel-labs/agent-skills', ['alpha']);
  });

  it('keeps --json output unchanged when --audit is also set', async () => {
    const installedSkills: InstalledSkill[] = [
      {
        name: 'json-audit-skill',
        description: 'A skill for JSON audit testing',
        path: '/tmp/json-audit-skill',
        canonicalPath: '/tmp/json-audit-skill',
        scope: 'project',
        agents: [],
      },
    ];

    mocks.listInstalledSkills.mockResolvedValue(installedSkills);

    const { runList } = await listModulePromise;
    await runList(['--json', '--audit']);

    const output = consoleLogSpy.mock.calls
      .flat()
      .map((value) => String(value))
      .join('\n');
    const parsed = JSON.parse(output);

    expect(parsed).toEqual([
      {
        name: 'json-audit-skill',
        path: '/tmp/json-audit-skill',
        scope: 'project',
        agents: [],
      },
    ]);
    expect(output).not.toContain('Security audit');
    expect(mocks.getAllLockedSkills).not.toHaveBeenCalled();
    expect(mocks.readLocalLock).not.toHaveBeenCalled();
    expect(mocks.fetchAuditData).not.toHaveBeenCalled();
  });
});
