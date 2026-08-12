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

    expect(add.runAdd).toHaveBeenCalledWith(
      ['https://gitlab.example.com/acme/skills.git'],
      expect.objectContaining({
        skill: ['skill-a'],
        agent: ['cursor'],
        yes: true,
      })
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

    await runInstallFromLock([]);

    expect(add.runAdd).not.toHaveBeenCalled();
  });
});
