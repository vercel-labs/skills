import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentType } from './types.ts';

const { promptLog } = vi.hoisted(() => ({
  promptLog: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    message: vi.fn(),
  },
}));

vi.mock('@clack/prompts', () => ({
  log: promptLog,
  intro: vi.fn(),
  outro: vi.fn(),
  spinner: vi.fn(() => ({
    start: vi.fn(),
    stop: vi.fn(),
  })),
}));

vi.mock('./add.ts', async () => {
  const actual = await vi.importActual<typeof import('./add.ts')>('./add.ts');
  return {
    ...actual,
    runAdd: vi.fn(),
  };
});

vi.mock('./local-lock.ts', async () => {
  const actual = await vi.importActual<typeof import('./local-lock.ts')>('./local-lock.ts');
  return {
    ...actual,
    readLocalLock: vi.fn(),
  };
});

vi.mock('./skill-lock.ts', async () => {
  const actual = await vi.importActual<typeof import('./skill-lock.ts')>('./skill-lock.ts');
  return {
    ...actual,
    readSkillLock: vi.fn(),
  };
});

vi.mock('./sync.ts', async () => {
  const actual = await vi.importActual<typeof import('./sync.ts')>('./sync.ts');
  return {
    ...actual,
    parseSyncOptions: vi.fn(() => ({ options: {} })),
    runSync: vi.fn(),
  };
});

vi.mock('./agents.ts', async () => {
  const actual = await vi.importActual<typeof import('./agents.ts')>('./agents.ts');
  return {
    ...actual,
    detectInstalledAgents: vi.fn(),
  };
});

import { parseInstallFromLockOptions, runInstallFromLock } from './install.ts';
import { runAdd } from './add.ts';
import { readLocalLock } from './local-lock.ts';
import { readSkillLock } from './skill-lock.ts';
import { parseSyncOptions, runSync } from './sync.ts';
import * as agentsModule from './agents.ts';

describe('experimental_install', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null) => {
      throw Object.assign(new Error('process.exit'), { code });
    });

    vi.mocked(readLocalLock).mockResolvedValue({
      version: 1,
      skills: {},
    });
    vi.mocked(readSkillLock).mockResolvedValue({
      version: 3,
      skills: {},
      dismissed: {},
      lastSelectedAgents: [],
      lastSelectedGlobalAgents: [],
    });
    vi.mocked(agentsModule.detectInstalledAgents).mockResolvedValue([]);
    vi.mocked(parseSyncOptions).mockReturnValue({ options: {} });
    vi.mocked(runSync).mockResolvedValue();
    vi.mocked(runAdd).mockResolvedValue();
  });

  afterEach(() => {
    exitSpy.mockRestore();
  });

  describe('parseInstallFromLockOptions', () => {
    it('parses global and agent flags', () => {
      const options = parseInstallFromLockOptions(['-g', '--agent', 'codex', 'claude-code']);
      expect(options).toEqual({
        global: true,
        agent: ['codex', 'claude-code'],
      });
    });
  });

  it('warns when the project lock is empty', async () => {
    await runInstallFromLock([]);

    expect(promptLog.warn).toHaveBeenCalledWith('No project skills found in skills-lock.json');
    expect(promptLog.info).toHaveBeenCalledWith(
      expect.stringContaining('Add project-level skills with')
    );
    expect(runAdd).not.toHaveBeenCalled();
    expect(runSync).not.toHaveBeenCalled();
  });

  it('replays non-node_modules project skills through runAdd with universal agents', async () => {
    vi.mocked(readLocalLock).mockResolvedValue({
      version: 1,
      skills: {
        alpha: {
          source: 'vercel-labs/skills',
          sourceType: 'github',
          computedHash: 'alpha-hash',
        },
        beta: {
          source: 'vercel-labs/skills',
          sourceType: 'github',
          computedHash: 'beta-hash',
        },
      },
    });

    await runInstallFromLock([]);

    expect(runAdd).toHaveBeenCalledTimes(1);
    expect(runAdd).toHaveBeenCalledWith(['vercel-labs/skills'], {
      skill: ['alpha', 'beta'],
      agent: agentsModule.getUniversalAgents(),
      yes: true,
    });
    expect(runSync).not.toHaveBeenCalled();
  });

  it('replays node_modules project skills through runSync with universal agents', async () => {
    vi.mocked(readLocalLock).mockResolvedValue({
      version: 1,
      skills: {
        localSkill: {
          source: 'vercel-labs/skills',
          sourceType: 'github',
          computedHash: 'local-hash',
        },
        packageSkill: {
          source: '@acme/skills',
          sourceType: 'node_modules',
          computedHash: 'package-hash',
        },
      },
    });
    vi.mocked(parseSyncOptions).mockReturnValue({ options: { force: true } as any });

    await runInstallFromLock(['--force']);

    expect(runAdd).toHaveBeenCalledWith(['vercel-labs/skills'], {
      skill: ['localSkill'],
      agent: agentsModule.getUniversalAgents(),
      yes: true,
    });
    expect(runSync).toHaveBeenCalledWith(['--force'], {
      force: true,
      yes: true,
      agent: agentsModule.getUniversalAgents(),
    });
  });

  it('uses an explicit single global restore agent', async () => {
    vi.mocked(readSkillLock).mockResolvedValue(
      makeGlobalLock({
        syncedSkill: makeGlobalEntry('repo-one', 'https://example.com/repo-one.git'),
      })
    );

    await runInstallFromLock(['-g', '--agent', 'codex']);

    expect(runAdd).toHaveBeenCalledWith(['https://example.com/repo-one.git'], {
      global: true,
      skill: ['syncedSkill'],
      agent: ['codex'],
      yes: true,
    });
  });

  it('uses explicit multiple global restore agents', async () => {
    vi.mocked(readSkillLock).mockResolvedValue(
      makeGlobalLock({
        syncedSkill: makeGlobalEntry('repo-one', 'https://example.com/repo-one.git'),
      })
    );

    await runInstallFromLock(['-g', '--agent', 'codex', 'claude-code']);

    expect(runAdd).toHaveBeenCalledWith(['https://example.com/repo-one.git'], {
      global: true,
      skill: ['syncedSkill'],
      agent: ['codex', 'claude-code'],
      yes: true,
    });
  });

  it('expands wildcard global restore agents to all global-capable agents', async () => {
    vi.mocked(readSkillLock).mockResolvedValue(
      makeGlobalLock({
        syncedSkill: makeGlobalEntry('repo-one', 'https://example.com/repo-one.git'),
      })
    );

    await runInstallFromLock(['-g', '--agent', '*']);

    const allGlobalCapableAgents = (
      Object.entries(agentsModule.agents) as Array<
        [AgentType, (typeof agentsModule.agents)[AgentType]]
      >
    )
      .filter(([, agent]) => agent.globalSkillsDir !== undefined)
      .map(([agent]) => agent);

    expect(runAdd).toHaveBeenCalledWith(['https://example.com/repo-one.git'], {
      global: true,
      skill: ['syncedSkill'],
      agent: allGlobalCapableAgents,
      yes: true,
    });
  });

  it('rejects invalid explicit agents', async () => {
    vi.mocked(readSkillLock).mockResolvedValue(
      makeGlobalLock({
        syncedSkill: makeGlobalEntry('repo-one', 'https://example.com/repo-one.git'),
      })
    );

    await expect(runInstallFromLock(['-g', '--agent', 'invalid-agent'])).rejects.toThrow(
      'process.exit'
    );

    expect(promptLog.error).toHaveBeenCalledWith('Invalid agents: invalid-agent');
    expect(promptLog.info).toHaveBeenCalledWith(expect.stringContaining('Valid agents:'));
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(runAdd).not.toHaveBeenCalled();
  });

  it('prefers detected global agents over saved project history', async () => {
    vi.mocked(readSkillLock).mockResolvedValue(
      makeGlobalLock(
        {
          syncedSkill: makeGlobalEntry('repo-one', 'https://example.com/repo-one.git'),
        },
        { lastSelectedAgents: ['codex'] }
      )
    );
    vi.mocked(agentsModule.detectInstalledAgents).mockResolvedValue(['codex', 'claude-code']);

    await runInstallFromLock(['-g']);

    expect(runAdd).toHaveBeenCalledWith(['https://example.com/repo-one.git'], {
      global: true,
      skill: ['syncedSkill'],
      agent: ['codex', 'claude-code'],
      yes: true,
    });
  });

  it('falls back from stale saved agents to detected global agents', async () => {
    vi.mocked(readSkillLock).mockResolvedValue(
      makeGlobalLock(
        {
          syncedSkill: makeGlobalEntry('repo-one', 'https://example.com/repo-one.git'),
        },
        { lastSelectedGlobalAgents: ['openclaw'] }
      )
    );
    vi.mocked(agentsModule.detectInstalledAgents).mockResolvedValue(['codex']);

    await runInstallFromLock(['-g']);

    expect(runAdd).toHaveBeenCalledWith(['https://example.com/repo-one.git'], {
      global: true,
      skill: ['syncedSkill'],
      agent: ['codex'],
      yes: true,
    });
  });

  it('falls back to saved global-capable agents when detection finds no agent dirs', async () => {
    vi.mocked(readSkillLock).mockResolvedValue(
      makeGlobalLock(
        {
          syncedSkill: makeGlobalEntry('repo-one', 'https://example.com/repo-one.git'),
        },
        { lastSelectedGlobalAgents: ['codex'] }
      )
    );
    vi.mocked(agentsModule.detectInstalledAgents).mockResolvedValue([]);

    await runInstallFromLock(['-g']);

    expect(runAdd).toHaveBeenCalledWith(['https://example.com/repo-one.git'], {
      global: true,
      skill: ['syncedSkill'],
      agent: ['codex'],
      yes: true,
    });
  });

  it('ignores saved project history when detection finds no agent dirs', async () => {
    vi.mocked(readSkillLock).mockResolvedValue(
      makeGlobalLock(
        {
          syncedSkill: makeGlobalEntry('repo-one', 'https://example.com/repo-one.git'),
        },
        { lastSelectedAgents: ['codex'] }
      )
    );
    vi.mocked(agentsModule.detectInstalledAgents).mockResolvedValue([]);

    await expect(runInstallFromLock(['-g'])).rejects.toThrow('process.exit');

    expect(promptLog.warn).toHaveBeenCalledWith('No global-capable installed agents detected.');
    expect(runAdd).not.toHaveBeenCalled();
  });

  it('falls back from missing saved agents to detected global agents', async () => {
    vi.mocked(readSkillLock).mockResolvedValue(
      makeGlobalLock({
        syncedSkill: makeGlobalEntry('repo-one', 'https://example.com/repo-one.git'),
      })
    );
    vi.mocked(agentsModule.detectInstalledAgents).mockResolvedValue(['codex']);

    await runInstallFromLock(['-g']);

    expect(runAdd).toHaveBeenCalledWith(['https://example.com/repo-one.git'], {
      global: true,
      skill: ['syncedSkill'],
      agent: ['codex'],
      yes: true,
    });
  });

  it('exits when no saved or detected global-capable agents exist', async () => {
    vi.mocked(readSkillLock).mockResolvedValue(
      makeGlobalLock({
        syncedSkill: makeGlobalEntry('repo-one', 'https://example.com/repo-one.git'),
      })
    );
    vi.mocked(agentsModule.detectInstalledAgents).mockResolvedValue([]);

    await expect(runInstallFromLock(['-g'])).rejects.toThrow('process.exit');

    expect(promptLog.warn).toHaveBeenCalledWith('No global-capable installed agents detected.');
    expect(promptLog.info).toHaveBeenCalledWith(
      expect.stringContaining('skills experimental_install -g --agent <agent>')
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(runAdd).not.toHaveBeenCalled();
  });

  it('groups global restore entries by replay source', async () => {
    vi.mocked(readSkillLock).mockResolvedValue(
      makeGlobalLock(
        {
          alpha: makeGlobalEntry('repo-a', 'https://example.com/repo-a.git'),
          beta: makeGlobalEntry('repo-b', 'https://example.com/repo-a.git'),
          gamma: makeGlobalEntry('shared-local-source'),
          delta: makeGlobalEntry('shared-local-source'),
        },
        ['codex']
      )
    );
    vi.mocked(agentsModule.detectInstalledAgents).mockResolvedValue(['codex']);

    await runInstallFromLock(['-g']);

    expect(runAdd).toHaveBeenCalledTimes(2);
    expect(runAdd).toHaveBeenNthCalledWith(1, ['https://example.com/repo-a.git'], {
      global: true,
      skill: ['alpha', 'beta'],
      agent: ['codex'],
      yes: true,
    });
    expect(runAdd).toHaveBeenNthCalledWith(2, ['shared-local-source'], {
      global: true,
      skill: ['gamma', 'delta'],
      agent: ['codex'],
      yes: true,
    });
  });
});

function makeGlobalEntry(source: string, sourceUrl?: string) {
  return {
    source,
    sourceType: 'github',
    ...(sourceUrl ? { sourceUrl } : {}),
    skillFolderHash: '',
    installedAt: '2026-03-23T00:00:00.000Z',
    updatedAt: '2026-03-23T00:00:00.000Z',
  };
}

function makeGlobalLock(
  skills: Record<string, ReturnType<typeof makeGlobalEntry>>,
  selections: {
    lastSelectedAgents?: string[];
    lastSelectedGlobalAgents?: string[];
  } = {}
) {
  return {
    version: 3,
    skills,
    dismissed: {},
    lastSelectedAgents: selections.lastSelectedAgents ?? [],
    lastSelectedGlobalAgents: selections.lastSelectedGlobalAgents ?? [],
  };
}
