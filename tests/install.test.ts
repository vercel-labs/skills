import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runInstallFromLock } from '../src/install.ts';
import { getPresentAgents } from '../src/agents.ts';
import * as localLock from '../src/local-lock.ts';
import * as add from '../src/add.ts';

vi.mock('../src/local-lock.ts');
vi.mock('../src/add.ts');
vi.mock('../src/sync.ts', () => ({
  runSync: vi.fn(),
  parseSyncOptions: vi.fn().mockReturnValue({ options: {} }),
}));
vi.mock('../src/agents.ts', () => ({
  getPresentAgents: vi.fn(),
}));

describe('runInstallFromLock', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('restores self-hosted GitLab project locks from sourceUrl', async () => {
    vi.mocked(localLock.readLocalLock).mockResolvedValue({
      version: 1,
      skills: {
        'skill-a': {
          source: 'acme/skills',
          sourceUrl: 'https://gitlab.example.com/acme/skills.git',
          sourceType: 'git',
          skillPath: 'skills/skill-a/SKILL.md',
          computedHash: 'hash',
        },
      },
    });
    vi.mocked(getPresentAgents).mockReturnValue(['claude-code', 'cursor']);

    await runInstallFromLock([]);

    expect(add.runAdd).toHaveBeenCalledWith(
      ['https://gitlab.example.com/acme/skills.git'],
      expect.objectContaining({
        skill: ['skill-a'],
        agent: ['claude-code', 'cursor'],
        yes: true,
      })
    );
  });

  it('passes presentAgents to runAdd so non-universal agents like Claude Code are targeted', async () => {
    vi.mocked(localLock.readLocalLock).mockResolvedValue({
      version: 1,
      skills: {
        'skill-a': {
          source: 'acme/skills',
          sourceUrl: 'https://gitlab.example.com/acme/skills.git',
          sourceType: 'git',
          skillPath: 'skills/skill-a/SKILL.md',
          computedHash: 'hash',
        },
      },
    });
    // Simulate a project where only .claude/ is present — claude-code must be
    // in the agent list, not silently dropped.
    vi.mocked(getPresentAgents).mockReturnValue(['claude-code']);

    await runInstallFromLock([]);

    expect(add.runAdd).toHaveBeenCalledWith(
      ['https://gitlab.example.com/acme/skills.git'],
      expect.objectContaining({ agent: ['claude-code'] })
    );
  });

  it('falls back to empty agent list when no agent config roots are present', async () => {
    vi.mocked(localLock.readLocalLock).mockResolvedValue({
      version: 1,
      skills: {
        'skill-a': {
          source: 'acme/skills',
          sourceUrl: 'https://gitlab.example.com/acme/skills.git',
          sourceType: 'git',
          skillPath: 'skills/skill-a/SKILL.md',
          computedHash: 'hash',
        },
      },
    });
    vi.mocked(getPresentAgents).mockReturnValue([]);

    await runInstallFromLock([]);

    // runAdd receives an empty agent list; it falls through to its own
    // auto-detect branch (or no-op for selection) -- the contract here is
    // simply that the spawn happens, not that specific agents are picked.
    expect(add.runAdd).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ agent: [] })
    );
  });

  it('does not restore generic git shorthands as GitHub without sourceUrl', async () => {
    vi.mocked(localLock.readLocalLock).mockResolvedValue({
      version: 1,
      skills: {
        'skill-a': {
          source: 'acme/skills',
          sourceType: 'git',
          skillPath: 'skills/skill-a/SKILL.md',
          computedHash: 'hash',
        },
      },
    });
    vi.mocked(getPresentAgents).mockReturnValue(['claude-code']);

    await runInstallFromLock([]);

    expect(add.runAdd).not.toHaveBeenCalled();
  });

  it('returns early without spawning when the lock is empty', async () => {
    vi.mocked(localLock.readLocalLock).mockResolvedValue({ version: 1, skills: {} });
    vi.mocked(getPresentAgents).mockReturnValue(['claude-code']);

    await runInstallFromLock([]);

    expect(add.runAdd).not.toHaveBeenCalled();
  });

  it('routes node_modules skills to runSync instead of runAdd', async () => {
    const { runSync } = await import('../src/sync.ts');
    vi.mocked(localLock.readLocalLock).mockResolvedValue({
      version: 1,
      skills: {
        'pkg-skill': {
          source: 'some-npm-package',
          sourceType: 'node_modules',
          computedHash: 'hash',
        },
      },
    });
    vi.mocked(getPresentAgents).mockReturnValue(['claude-code']);

    await runInstallFromLock([]);

    expect(add.runAdd).not.toHaveBeenCalled();
    expect(runSync).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ agent: ['claude-code'] })
    );
  });

  it('does not throw when a remote skill reinstall fails (errors are caught and logged)', async () => {
    vi.mocked(localLock.readLocalLock).mockResolvedValue({
      version: 1,
      skills: {
        'skill-a': {
          source: 'acme/skills',
          sourceUrl: 'https://gitlab.example.com/acme/skills.git',
          sourceType: 'git',
          skillPath: 'skills/skill-a/SKILL.md',
          computedHash: 'hash',
        },
      },
    });
    vi.mocked(getPresentAgents).mockReturnValue(['claude-code']);
    vi.mocked(add.runAdd).mockRejectedValueOnce(new Error('network down'));

    // The function should swallow the error and return normally rather
    // than crashing the CLI.
    await expect(runInstallFromLock([])).resolves.toBeUndefined();
  });
});
