import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchSkillFolderHash, getGitHubToken } from '../src/skill-lock.ts';

const treeSha = 'abc123treeSha';
const folderSha = 'def456folderSha';

function mockFetchResponse(tree: Array<{ path: string; type: string; sha: string }>) {
  return {
    ok: true,
    json: async () => ({
      sha: treeSha,
      tree,
    }),
  } as Response;
}

describe('fetchSkillFolderHash', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      mockFetchResponse([
        { path: 'skills/my-skill', type: 'tree', sha: folderSha },
        { path: 'skills/my-skill/SKILL.md', type: 'blob', sha: 'blobsha' },
      ])
    );
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('should include Authorization header when token is provided', async () => {
    const token = 'ghp_testtoken123';
    await fetchSkillFolderHash('owner/repo', 'skills/my-skill/SKILL.md', token);

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('api.github.com/repos/owner/repo/git/trees/'),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: `Bearer ${token}`,
        }),
      })
    );
  });

  it('should NOT include Authorization header when token is null', async () => {
    await fetchSkillFolderHash('owner/repo', 'skills/my-skill/SKILL.md', null);

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('api.github.com/repos/owner/repo/git/trees/'),
      expect.objectContaining({
        headers: expect.not.objectContaining({
          Authorization: expect.any(String),
        }),
      })
    );
  });

  it('should NOT include Authorization header when token is undefined', async () => {
    await fetchSkillFolderHash('owner/repo', 'skills/my-skill/SKILL.md');

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('api.github.com/repos/owner/repo/git/trees/'),
      expect.objectContaining({
        headers: expect.not.objectContaining({
          Authorization: expect.any(String),
        }),
      })
    );
  });

  it('should return the folder SHA for a matching skill path', async () => {
    const result = await fetchSkillFolderHash('owner/repo', 'skills/my-skill/SKILL.md', 'token');
    expect(result).toBe(folderSha);
  });

  it('should return root tree SHA when skill path is empty', async () => {
    const result = await fetchSkillFolderHash('owner/repo', '', 'token');
    expect(result).toBe(treeSha);
  });
});

describe('getGitHubToken', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('should return GITHUB_TOKEN from env when set', () => {
    vi.stubEnv('GITHUB_TOKEN', 'env-github-token');
    vi.stubEnv('GH_TOKEN', '');
    expect(getGitHubToken()).toBe('env-github-token');
  });

  it('should return GH_TOKEN from env when GITHUB_TOKEN is not set', () => {
    vi.stubEnv('GITHUB_TOKEN', '');
    vi.stubEnv('GH_TOKEN', 'env-gh-token');
    expect(getGitHubToken()).toBe('env-gh-token');
  });

  it('should prefer GITHUB_TOKEN over GH_TOKEN', () => {
    vi.stubEnv('GITHUB_TOKEN', 'github-token');
    vi.stubEnv('GH_TOKEN', 'gh-token');
    expect(getGitHubToken()).toBe('github-token');
  });
});
