import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runInstallFromLock } from '../src/install.ts';
import * as localLock from '../src/local-lock.ts';
import * as add from '../src/add.ts';

vi.mock('../src/local-lock.ts');
vi.mock('../src/add.ts');
vi.mock('../src/sync.ts', () => ({
  runSync: vi.fn(),
  parseSyncOptions: vi.fn().mockReturnValue({ options: {} }),
}));
vi.mock('../src/agents.ts', () => ({
  getUniversalAgents: vi.fn().mockReturnValue(['cursor']),
}));

describe('runInstallFromLock', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(add.installFromSource).mockResolvedValue({ installed: ['skill-a'], failed: [] });
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

    await runInstallFromLock([]);

    expect(add.installFromSource).toHaveBeenCalledWith(
      'https://gitlab.example.com/acme/skills.git',
      { skills: ['skill-a'], agents: ['cursor'], fullDepth: true }
    );
  });

  it('searches full depth when any skill in a shared Git source requires it', async () => {
    vi.mocked(localLock.readLocalLock).mockResolvedValue({
      version: 1,
      skills: {
        root: {
          source: 'acme/skills',
          sourceUrl: 'ssh://git@example.com/acme/skills.git',
          sourceType: 'git',
          computedHash: 'hash',
        },
        nested: {
          source: 'acme/skills',
          sourceUrl: 'ssh://git@example.com/acme/skills.git',
          sourceType: 'git',
          skillPath: 'skills/nested/SKILL.md',
          computedHash: 'hash',
        },
      },
    });

    await runInstallFromLock([]);

    expect(add.installFromSource).toHaveBeenCalledExactlyOnceWith(
      'ssh://git@example.com/acme/skills.git',
      { skills: ['root', 'nested'], agents: ['cursor'], fullDepth: true }
    );
  });

  it('keeps path-targeted GitHub restores on ordinary discovery', async () => {
    vi.mocked(localLock.readLocalLock).mockResolvedValue({
      version: 1,
      skills: {
        review: {
          source: 'acme/skills',
          sourceType: 'github',
          skillPath: 'skills/review/SKILL.md',
          computedHash: 'hash',
        },
      },
    });

    await runInstallFromLock([]);

    expect(add.installFromSource).toHaveBeenCalledExactlyOnceWith('acme/skills/skills/review', {
      skills: ['review'],
      agents: ['cursor'],
      fullDepth: false,
    });
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

    await runInstallFromLock([]);

    expect(add.installFromSource).not.toHaveBeenCalled();
  });
});
