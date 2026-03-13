import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computeTextFileHash, computeTrackedSkillDirectoryHash } from '../src/skill-hash.ts';

const {
  cloneRepoMock,
  cleanupTempDirMock,
  fetchIndexMock,
  fetchSkillByEntryMock,
  fetchAllSkillsMock,
} = vi.hoisted(() => ({
  cloneRepoMock: vi.fn(),
  cleanupTempDirMock: vi.fn(),
  fetchIndexMock: vi.fn(),
  fetchSkillByEntryMock: vi.fn(),
  fetchAllSkillsMock: vi.fn(),
}));

vi.mock('../src/git.ts', () => ({
  cloneRepo: cloneRepoMock,
  cleanupTempDir: cleanupTempDirMock,
}));

vi.mock('../src/providers/index.ts', () => ({
  wellKnownProvider: {
    fetchIndex: fetchIndexMock,
    fetchSkillByEntry: fetchSkillByEntryMock,
    fetchAllSkills: fetchAllSkillsMock,
  },
}));

import {
  buildUpdateCommandArgs,
  getInstalledTrackingHash,
  getLatestTrackingHash,
} from '../src/update-tracking.ts';

describe('update tracking', () => {
  let tempHome: string;
  let originalHome: string | undefined;

  beforeEach(async () => {
    tempHome = await mkdtemp(join(tmpdir(), 'skills-update-tracking-'));
    originalHome = process.env.HOME;
    process.env.HOME = tempHome;
    cloneRepoMock.mockReset();
    cleanupTempDirMock.mockReset();
    fetchIndexMock.mockReset();
    fetchSkillByEntryMock.mockReset();
    fetchAllSkillsMock.mockReset();
  });

  afterEach(async () => {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    await rm(tempHome, { recursive: true, force: true });
  });

  it('backfills installed hashes for non-GitHub skills from the canonical install directory', async () => {
    const installDir = join(tempHome, '.agents', 'skills', 'gitlab-skill');
    await mkdir(installDir, { recursive: true });
    await writeFile(
      join(installDir, 'SKILL.md'),
      '---\nname: gitlab-skill\ndescription: Test skill\n---\n'
    );
    await writeFile(join(installDir, 'guide.md'), 'hello world');

    const currentHash = await getInstalledTrackingHash('gitlab-skill', {
      sourceType: 'gitlab',
      skillFolderHash: '',
    });

    expect(currentHash).toBe(await computeTrackedSkillDirectoryHash(installDir));
  });

  it('does not synthesize GitHub hashes when the lock entry is missing one', async () => {
    const currentHash = await getInstalledTrackingHash('github-skill', {
      sourceType: 'github',
      skillFolderHash: '',
    });

    expect(currentHash).toBeNull();
  });

  it('computes the latest hash for well-known skills from fetched skill files', async () => {
    const files = new Map<string, string>([
      ['SKILL.md', '---\nname: test-skill\ndescription: Test skill\n---\n'],
      ['guide.md', 'latest content'],
    ]);

    fetchIndexMock.mockResolvedValue({
      index: {
        skills: [
          { name: 'test-skill', description: 'Test skill', files: ['SKILL.md', 'guide.md'] },
        ],
      },
      resolvedBaseUrl: 'https://docs.example.com',
    });
    fetchSkillByEntryMock.mockResolvedValue({ files });

    const latestHash = await getLatestTrackingHash(
      'test-skill',
      {
        source: 'docs.example.com',
        sourceType: 'well-known',
        sourceUrl: 'https://docs.example.com/.well-known/skills/test-skill/SKILL.md',
      },
      null
    );

    expect(latestHash).toBe(computeTextFileHash(files));
    expect(fetchAllSkillsMock).not.toHaveBeenCalled();
  });

  it('computes the latest hash for GitLab skills from cloned repository contents', async () => {
    const repoDir = await mkdtemp(join(tmpdir(), 'skills-update-repo-'));
    const skillDir = join(repoDir, 'skills', 'gitlab-skill');
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, 'SKILL.md'),
      '---\nname: gitlab-skill\ndescription: Test skill\n---\n'
    );
    await writeFile(join(skillDir, 'guide.md'), 'latest content');

    cloneRepoMock.mockResolvedValue(repoDir);

    const latestHash = await getLatestTrackingHash(
      'gitlab-skill',
      {
        source: 'group/repo',
        sourceType: 'gitlab',
        sourceUrl: 'https://gitlab.com/group/repo.git',
      },
      null
    );

    expect(latestHash).toBe(await computeTrackedSkillDirectoryHash(skillDir));
    expect(cloneRepoMock).toHaveBeenCalledWith('https://gitlab.com/group/repo.git');
    expect(cleanupTempDirMock).toHaveBeenCalledWith(repoDir);

    await rm(repoDir, { recursive: true, force: true });
  });

  it('builds update commands that reinstall only the selected skill', () => {
    expect(buildUpdateCommandArgs('test-skill', 'https://example.com/source')).toEqual([
      'add',
      'https://example.com/source',
      '-g',
      '-y',
      '--skill',
      'test-skill',
    ]);
  });
});
