import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockSpinnerStart,
  mockSpinnerStop,
  mockCloneRepo,
  mockCleanupTempDir,
  mockDiscoverSkills,
  mockInstallSkillForAgent,
  mockIsSkillInstalled,
  mockGetCanonicalPath,
  mockDetectInstalledAgents,
  mockTrack,
  mockFetchAuditData,
  mockAddSkillToLock,
  mockGetGitHubToken,
} = vi.hoisted(() => ({
  mockSpinnerStart: vi.fn(),
  mockSpinnerStop: vi.fn(),
  mockCloneRepo: vi.fn(),
  mockCleanupTempDir: vi.fn(),
  mockDiscoverSkills: vi.fn(),
  mockInstallSkillForAgent: vi.fn(),
  mockIsSkillInstalled: vi.fn(),
  mockGetCanonicalPath: vi.fn(),
  mockDetectInstalledAgents: vi.fn(),
  mockTrack: vi.fn(),
  mockFetchAuditData: vi.fn(),
  mockAddSkillToLock: vi.fn(),
  mockGetGitHubToken: vi.fn(),
}));

vi.mock('@clack/prompts', () => ({
  intro: vi.fn(),
  outro: vi.fn(),
  note: vi.fn(),
  cancel: vi.fn(),
  isCancel: vi.fn(() => false),
  log: {
    info: vi.fn(),
    message: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    step: vi.fn(),
  },
  spinner: vi.fn(() => ({
    start: mockSpinnerStart,
    stop: mockSpinnerStop,
  })),
}));

vi.mock('../src/git.ts', () => ({
  GitCloneError: class GitCloneError extends Error {},
  cloneRepo: mockCloneRepo,
  cleanupTempDir: mockCleanupTempDir,
}));

vi.mock('../src/skills.ts', () => ({
  discoverSkills: mockDiscoverSkills,
  getSkillDisplayName: (skill: { name: string }) => skill.name,
  filterSkills: (skills: Array<{ name: string }>, names: string[]) =>
    skills.filter((skill) => names.includes(skill.name)),
}));

vi.mock('../src/installer.ts', () => ({
  installSkillForAgent: mockInstallSkillForAgent,
  isSkillInstalled: mockIsSkillInstalled,
  getInstallPath: vi.fn(),
  getCanonicalPath: mockGetCanonicalPath,
}));

vi.mock('../src/agents.ts', () => ({
  detectInstalledAgents: mockDetectInstalledAgents,
  agents: {
    codex: {
      displayName: 'Codex',
      skillsDir: '.codex/skills',
      globalSkillsDir: '/fake/home/.codex/skills',
    },
  },
  getUniversalAgents: vi.fn(() => []),
  getNonUniversalAgents: vi.fn(() => ['codex']),
  isUniversalAgent: vi.fn(() => false),
}));

vi.mock('../src/telemetry.ts', () => ({
  track: mockTrack,
  setVersion: vi.fn(),
  fetchAuditData: mockFetchAuditData,
}));

vi.mock('../src/skill-lock.ts', async () => {
  const actual = await vi.importActual<typeof import('../src/skill-lock.ts')>(
    '../src/skill-lock.ts'
  );

  return {
    ...actual,
    addSkillToLock: mockAddSkillToLock,
    getGitHubToken: mockGetGitHubToken,
    isPromptDismissed: vi.fn(),
    dismissPrompt: vi.fn(),
    getLastSelectedAgents: vi.fn(),
    saveSelectedAgents: vi.fn(),
  };
});

vi.mock('../src/local-lock.ts', () => ({
  addSkillToLocalLock: vi.fn(),
  computeSkillFolderHash: vi.fn(),
}));

vi.mock('../src/source-parser.ts', () => ({
  parseSource: vi.fn(() => ({
    type: 'github',
    url: 'https://github.com/org/repo.git',
  })),
  getOwnerRepo: vi.fn(() => 'org/repo'),
  parseOwnerRepo: vi.fn(() => ({ owner: 'org', repo: 'repo' })),
  isRepoPrivate: vi.fn(async () => false),
}));

vi.mock('../src/prompts/search-multiselect.ts', () => ({
  searchMultiselect: vi.fn(),
  cancelSymbol: Symbol('cancel'),
}));

import { runAdd } from '../src/add.ts';

describe('runAdd global hash fetching', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();

    mockCloneRepo.mockResolvedValue('/tmp/cloned-repo');
    mockCleanupTempDir.mockResolvedValue(undefined);
    mockDiscoverSkills.mockResolvedValue([
      {
        name: 'alpha',
        description: 'Alpha skill',
        path: '/tmp/cloned-repo/skills/alpha',
      },
      {
        name: 'beta',
        description: 'Beta skill',
        path: '/tmp/cloned-repo/skills/beta',
      },
    ]);
    mockDetectInstalledAgents.mockResolvedValue(['codex']);
    mockIsSkillInstalled.mockResolvedValue(false);
    mockInstallSkillForAgent.mockResolvedValue({
      success: true,
      path: '/fake/path',
      canonicalPath: '/fake/canonical',
      mode: 'symlink',
    });
    mockGetCanonicalPath.mockImplementation((skillName: string) => `/fake/canonical/${skillName}`);
    mockFetchAuditData.mockResolvedValue(null);
    mockAddSkillToLock.mockResolvedValue(undefined);
    mockGetGitHubToken.mockReturnValue(null);

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        sha: 'root-tree-sha',
        tree: [
          { path: 'skills/alpha', type: 'tree', sha: 'tree-alpha' },
          { path: 'skills/beta', type: 'tree', sha: 'tree-beta' },
        ],
      }),
    }) as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('should fetch repo tree data only once for multiple global skills from the same source', async () => {
    await runAdd(['org/repo'], {
      global: true,
      yes: true,
      agent: ['codex'],
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
