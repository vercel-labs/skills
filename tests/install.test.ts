import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runInstallFromLock } from '../src/install.ts';
import * as localLock from '../src/local-lock.ts';
import * as add from '../src/add.ts';
import { wellKnownProvider, type WellKnownSkill } from '../src/providers/index.ts';

vi.mock('../src/local-lock.ts');
vi.mock('../src/add.ts');
vi.mock('../src/sync.ts', () => ({
  runSync: vi.fn(),
  parseSyncOptions: vi.fn().mockReturnValue({ options: {} }),
}));
vi.mock('../src/agents.ts', () => ({
  getUniversalAgents: vi.fn().mockReturnValue(['cursor']),
}));
// The suite itself runs in CI, where --frozen-lockfile would otherwise default on
vi.mock('../src/ci.ts', () => ({ isCI: () => false }));

function installedSkill(name: string): add.InstalledSkill {
  return {
    skill: { name, description: name, path: `/tmp/${name}` },
    repoPath: `skills/${name}/SKILL.md`,
    hash: 'hash',
  };
}

describe('runInstallFromLock', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(add.fetchSources).mockImplementation(async (requests) =>
      requests.map(({ parsed }) => ({ parsed, resolved: null, error: 'not fetched' }))
    );
    vi.mocked(add.installFromSource).mockResolvedValue({
      installed: ['skill-a'],
      installedSkills: [installedSkill('skill-a')],
      failed: [],
    });
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
      expect.objectContaining({
        parsed: expect.objectContaining({ url: 'https://gitlab.example.com/acme/skills.git' }),
      }),
      expect.objectContaining({ agents: ['cursor'] })
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

    expect(add.installFromSource).not.toHaveBeenCalled();
  });

  it('restores well-known sources without exiting on a missing skill', async () => {
    vi.mocked(localLock.readLocalLock).mockResolvedValue({
      version: 1,
      skills: {
        'skill-a': {
          source: 'example.com',
          sourceUrl: 'https://example.com',
          sourceType: 'well-known',
          computedHash: 'hash',
          wellKnownDigest: 'sha256:old',
        },
      },
    });
    const fetchAllSkills = vi.spyOn(wellKnownProvider, 'fetchAllSkills').mockResolvedValue([
      {
        name: 'skill-a',
        installName: 'skill-a',
        indexEntry: { digest: 'sha256:new' },
      } as unknown as WellKnownSkill,
    ]);
    vi.mocked(add.installWellKnownToAgents).mockResolvedValue([
      {
        skill: 'skill-a',
        agent: 'Cursor',
        success: true,
        path: '/project/.agents/skills/skill-a',
        canonicalPath: '/project/.agents/skills/skill-a',
        mode: 'symlink',
      },
    ]);
    vi.mocked(localLock.computeSkillFolderHash).mockResolvedValue('new-hash');

    await runInstallFromLock([]);

    expect(add.installFromSource).not.toHaveBeenCalled();
    expect(fetchAllSkills).toHaveBeenCalledWith('https://example.com', { includeInternal: true });
    expect(localLock.addSkillsToLocalLock).toHaveBeenCalledWith(
      {
        'skill-a': expect.objectContaining({
          sourceType: 'well-known',
          computedHash: 'new-hash',
          wellKnownDigest: 'sha256:new',
        }),
      },
      expect.any(String)
    );
  });

  it('restores every skill from one repository with a single source install', async () => {
    const entry = {
      source: 'acme/skills',
      sourceType: 'github',
      computedHash: 'hash',
    };
    vi.mocked(localLock.readLocalLock).mockResolvedValue({
      version: 1,
      skills: {
        alpha: { ...entry, skillPath: 'skills/alpha/SKILL.md' },
        beta: { ...entry, skillPath: 'skills/beta/SKILL.md' },
      },
    });
    vi.mocked(add.installFromSource).mockResolvedValue({
      installed: ['alpha', 'beta'],
      installedSkills: [installedSkill('alpha'), installedSkill('beta')],
      failed: [],
    });

    await runInstallFromLock([]);

    expect(add.installFromSource).toHaveBeenCalledTimes(1);
  });
});
