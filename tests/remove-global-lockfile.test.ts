import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { removeCommand } from '../src/remove.ts';

const {
  mockOutro,
  mockWarn,
  mockGetAllLockedSkills,
  mockGetSkillFromLock,
  mockRemoveSkillFromLock,
  mockDetectInstalledAgents,
  mockGetCanonicalSkillsDir,
  mockGetCanonicalPath,
  mockGetInstallPath,
  mockSanitizeName,
  mockTrack,
  mockReaddir,
  mockLstat,
  mockRm,
} = vi.hoisted(() => ({
  mockOutro: vi.fn(),
  mockWarn: vi.fn(),
  mockGetAllLockedSkills: vi.fn(),
  mockGetSkillFromLock: vi.fn(),
  mockRemoveSkillFromLock: vi.fn(),
  mockDetectInstalledAgents: vi.fn(),
  mockGetCanonicalSkillsDir: vi.fn(),
  mockGetCanonicalPath: vi.fn(),
  mockGetInstallPath: vi.fn(),
  mockSanitizeName: vi.fn((name: string) => name),
  mockTrack: vi.fn(),
  mockReaddir: vi.fn(),
  mockLstat: vi.fn(),
  mockRm: vi.fn(),
}));

vi.mock('@clack/prompts', async () => {
  const actual = await vi.importActual<typeof import('@clack/prompts')>('@clack/prompts');
  return {
    ...actual,
    outro: mockOutro,
    log: {
      ...actual.log,
      warn: mockWarn,
    },
  };
});

vi.mock('../src/skill-lock.ts', () => ({
  getAllLockedSkills: mockGetAllLockedSkills,
  getSkillFromLock: mockGetSkillFromLock,
  removeSkillFromLock: mockRemoveSkillFromLock,
}));

vi.mock('../src/agents.ts', () => ({
  agents: {
    codex: {
      displayName: 'Codex',
      skillsDir: '.codex/skills',
      globalSkillsDir: '/global/codex/skills',
    },
  },
  detectInstalledAgents: mockDetectInstalledAgents,
}));

vi.mock('../src/installer.ts', () => ({
  getCanonicalSkillsDir: mockGetCanonicalSkillsDir,
  getCanonicalPath: mockGetCanonicalPath,
  getInstallPath: mockGetInstallPath,
  sanitizeName: mockSanitizeName,
}));

vi.mock('../src/telemetry.ts', () => ({
  track: mockTrack,
}));

vi.mock('fs/promises', () => ({
  readdir: mockReaddir,
  lstat: mockLstat,
  rm: mockRm,
}));

describe('removeCommand global lockfile ownership', () => {
  const originalCwd = process.cwd();
  let testCwd: string;

  beforeEach(() => {
    vi.clearAllMocks();
    testCwd = join(tmpdir(), `skills-remove-global-lock-${Date.now()}`);
    mkdirSync(testCwd, { recursive: true });
    process.chdir(testCwd);

    mockGetCanonicalSkillsDir.mockReturnValue('/global/canonical/skills');
    mockGetCanonicalPath.mockImplementation(
      (skillName: string) => `/global/canonical/skills/${skillName}`
    );
    mockGetInstallPath.mockImplementation(
      (skillName: string) => `/global/canonical/skills/${skillName}`
    );
    mockDetectInstalledAgents.mockResolvedValue([]);
    mockGetSkillFromLock.mockResolvedValue({
      source: 'https://example.com/managed-skill',
      sourceType: 'url',
    });
    mockReaddir.mockImplementation(async (dir: string) => {
      if (dir === '/global/canonical/skills') {
        return [
          { name: 'managed-skill', isDirectory: () => true },
          { name: 'manual-skill', isDirectory: () => true },
        ];
      }
      return [];
    });
    mockLstat.mockResolvedValue({});
    mockRm.mockResolvedValue(undefined);
    mockGetAllLockedSkills.mockResolvedValue({
      'managed-skill': {
        source: 'https://example.com/managed-skill',
        agents: ['codex'],
        scope: 'global',
      },
    });
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(testCwd, { recursive: true, force: true });
    mockOutro.mockClear();
    mockWarn.mockClear();
  });

  it('should remove only lockfile-tracked skills for --all --global', async () => {
    await removeCommand([], { all: true, global: true, yes: true });

    expect(mockRm).toHaveBeenCalledWith('/global/canonical/skills/managed-skill', {
      recursive: true,
      force: true,
    });
    expect(mockRm).not.toHaveBeenCalledWith('/global/canonical/skills/manual-skill', {
      recursive: true,
      force: true,
    });
    expect(mockRemoveSkillFromLock).toHaveBeenCalledWith('managed-skill');
    expect(mockRemoveSkillFromLock).not.toHaveBeenCalledWith('manual-skill');
  });

  it('should still consult the lockfile when global directories are empty', async () => {
    mockReaddir.mockResolvedValue([]);

    await removeCommand([], { all: true, global: true, yes: true });

    expect(mockRm).toHaveBeenCalledWith('/global/canonical/skills/managed-skill', {
      recursive: true,
      force: true,
    });
    expect(mockRemoveSkillFromLock).toHaveBeenCalledWith('managed-skill');
    expect(mockOutro).not.toHaveBeenCalledWith('No skills found to remove.');
  });
});
