import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as blob from './blob.ts';
import * as git from './git.ts';
import * as localLock from './local-lock.ts';
import * as skillLock from './skill-lock.ts';
import * as skills from './skills.ts';
import * as update from './update.ts';
import { checkAvailableSkillUpdates, type SkillUpdateCheckProgress } from './update-check.ts';

vi.mock('./blob.ts');
vi.mock('./git.ts');
vi.mock('./local-lock.ts');
vi.mock('./skill-lock.ts');
vi.mock('./skills.ts');
vi.mock('./update.ts');

describe('checkAvailableSkillUpdates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(skillLock.getGitHubToken).mockReturnValue(null);
    vi.mocked(git.cleanupTempDir).mockResolvedValue(undefined);
    vi.mocked(update.checkWellKnownForUpdates).mockResolvedValue({
      status: 'current',
      newSkills: [],
    });
  });

  it('reports real per-skill progress and returns only changed global skills', async () => {
    vi.mocked(skillLock.readSkillLock).mockResolvedValue({
      version: 3,
      skills: {
        alpha: {
          source: 'owner/repo',
          sourceUrl: 'https://github.com/owner/repo',
          sourceType: 'github',
          skillPath: 'skills/alpha/SKILL.md',
          skillFolderHash: 'alpha-current',
          installedAt: '',
          updatedAt: '',
        },
        beta: {
          source: 'owner/repo',
          sourceUrl: 'https://github.com/owner/repo',
          sourceType: 'github',
          skillPath: 'skills/beta/SKILL.md',
          skillFolderHash: 'beta-current',
          installedAt: '',
          updatedAt: '',
        },
      },
    });
    vi.mocked(blob.fetchRepoTree).mockResolvedValue({
      sha: 'root',
      branch: 'main',
      tree: [],
    });
    vi.mocked(blob.getSkillFolderHashFromTree).mockImplementation((_tree, path) =>
      path.includes('alpha') ? 'alpha-latest' : 'beta-current'
    );
    const progress: SkillUpdateCheckProgress[] = [];

    const result = await checkAvailableSkillUpdates({
      scope: 'global',
      onProgress: (value) => progress.push(value),
    });

    expect(result.updates).toEqual([
      {
        name: 'alpha',
        scope: 'global',
        source: 'owner/repo',
        sourceType: 'github',
      },
    ]);
    expect(result).toMatchObject({
      checkedCount: 2,
      totalCount: 2,
      failedCount: 0,
      skippedCount: 0,
    });
    expect(progress).toEqual([
      { checked: 0, total: 2, current: null },
      { checked: 1, total: 2, current: 'alpha' },
      { checked: 2, total: 2, current: 'beta' },
    ]);
    expect(blob.fetchRepoTree).toHaveBeenCalledTimes(1);
  });

  it('checks project skills from a shared clone without installing them', async () => {
    vi.mocked(localLock.readLocalLock).mockResolvedValue({
      version: 1,
      skills: {
        alpha: {
          source: 'owner/repo',
          sourceType: 'github',
          skillPath: 'skills/alpha/SKILL.md',
          computedHash: 'alpha-current',
        },
        beta: {
          source: 'owner/repo',
          sourceType: 'github',
          skillPath: 'skills/beta/SKILL.md',
          computedHash: 'beta-current',
        },
      },
    });
    vi.mocked(git.cloneRepo).mockResolvedValue('/tmp/repo');
    vi.mocked(skills.discoverSkills).mockResolvedValue([
      {
        name: 'alpha',
        path: '/tmp/repo/skills/alpha',
        description: 'Alpha',
        rawContent: '',
      },
      {
        name: 'beta',
        path: '/tmp/repo/skills/beta',
        description: 'Beta',
        rawContent: '',
      },
    ]);
    vi.mocked(localLock.computeSkillFolderHash).mockImplementation(async (path) =>
      path.endsWith('/alpha') ? 'alpha-latest' : 'beta-current'
    );
    const progress: SkillUpdateCheckProgress[] = [];

    const result = await checkAvailableSkillUpdates({
      scope: 'project',
      onProgress: (value) => progress.push(value),
    });

    expect(result.updates.map((item) => item.name)).toEqual(['alpha']);
    expect(progress.at(-1)).toEqual({ checked: 2, total: 2, current: 'beta' });
    expect(git.cloneRepo).toHaveBeenCalledTimes(1);
    expect(git.cleanupTempDir).toHaveBeenCalledWith('/tmp/repo');
  });

  it('includes changed well-known skills in the available list', async () => {
    vi.mocked(localLock.readLocalLock).mockResolvedValue({
      version: 1,
      skills: {
        alpha: {
          source: 'https://example.com',
          sourceUrl: 'https://example.com',
          sourceType: 'well-known',
          computedHash: '',
          wellKnownDigest: 'old-digest',
        },
      },
    });
    vi.mocked(update.checkWellKnownForUpdates).mockResolvedValue({
      status: 'changed',
      changedSkills: ['alpha'],
      removedSkills: [],
      newSkills: [],
    });

    const result = await checkAvailableSkillUpdates({ scope: 'project' });

    expect(result.updates).toEqual([
      {
        name: 'alpha',
        scope: 'project',
        source: 'https://example.com',
        sourceType: 'well-known',
      },
    ]);
  });

  it('combines project and global updates with aggregate progress', async () => {
    vi.mocked(localLock.readLocalLock).mockResolvedValue({
      version: 1,
      skills: {
        project_alpha: {
          source: 'owner/project-repo',
          sourceType: 'github',
          skillPath: 'skills/project-alpha/SKILL.md',
          computedHash: 'project-current',
        },
      },
    });
    vi.mocked(skillLock.readSkillLock).mockResolvedValue({
      version: 3,
      skills: {
        global_beta: {
          source: 'owner/global-repo',
          sourceUrl: 'https://github.com/owner/global-repo',
          sourceType: 'github',
          skillPath: 'skills/global-beta/SKILL.md',
          skillFolderHash: 'global-current',
          installedAt: '',
          updatedAt: '',
        },
      },
    });
    vi.mocked(git.cloneRepo).mockResolvedValue('/tmp/project-repo');
    vi.mocked(skills.discoverSkills).mockResolvedValue([
      {
        name: 'project_alpha',
        path: '/tmp/project-repo/skills/project-alpha',
        description: 'Project alpha',
        rawContent: '',
      },
    ]);
    vi.mocked(localLock.computeSkillFolderHash).mockResolvedValue('project-latest');
    vi.mocked(blob.fetchRepoTree).mockResolvedValue({ sha: 'root', branch: 'main', tree: [] });
    vi.mocked(blob.getSkillFolderHashFromTree).mockReturnValue('global-latest');
    const progress: SkillUpdateCheckProgress[] = [];

    const result = await checkAvailableSkillUpdates({
      scope: 'all',
      onProgress: (value) => progress.push(value),
    });

    expect(result).toEqual({
      updates: [
        {
          name: 'global_beta',
          scope: 'global',
          source: 'owner/global-repo',
          sourceType: 'github',
        },
        {
          name: 'project_alpha',
          scope: 'project',
          source: 'owner/project-repo',
          sourceType: 'github',
        },
      ],
      checkedCount: 2,
      totalCount: 2,
      failedCount: 0,
      skippedCount: 0,
    });
    expect(progress.at(-1)).toMatchObject({ checked: 2, total: 2 });
    expect(progress.at(-1)?.current).toBeTruthy();
    expect(localLock.readLocalLock).toHaveBeenCalledOnce();
    expect(skillLock.readSkillLock).toHaveBeenCalledOnce();
  });

  it('checks independent global repositories concurrently', async () => {
    vi.mocked(skillLock.readSkillLock).mockResolvedValue({
      version: 3,
      skills: {
        alpha: {
          source: 'owner/alpha-repo',
          sourceUrl: 'https://github.com/owner/alpha-repo',
          sourceType: 'github',
          skillPath: 'skills/alpha/SKILL.md',
          skillFolderHash: 'alpha-current',
          installedAt: '',
          updatedAt: '',
        },
        beta: {
          source: 'owner/beta-repo',
          sourceUrl: 'https://github.com/owner/beta-repo',
          sourceType: 'github',
          skillPath: 'skills/beta/SKILL.md',
          skillFolderHash: 'beta-current',
          installedAt: '',
          updatedAt: '',
        },
      },
    });
    let activeChecks = 0;
    let peakChecks = 0;
    vi.mocked(blob.fetchRepoTree).mockImplementation(async () => {
      activeChecks++;
      peakChecks = Math.max(peakChecks, activeChecks);
      await new Promise((resolve) => setTimeout(resolve, 10));
      activeChecks--;
      return { sha: 'root', branch: 'main', tree: [] };
    });
    vi.mocked(blob.getSkillFolderHashFromTree).mockImplementation((_tree, path) =>
      path.includes('alpha') ? 'alpha-current' : 'beta-current'
    );

    const result = await checkAvailableSkillUpdates({ scope: 'global' });

    expect(result.failedCount).toBe(0);
    expect(peakChecks).toBe(2);
  });
});
