import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('fetchSkillFolderHash retry behavior', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('does not memoize non-ok tree fetch failures', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          sha: 'root-tree-sha',
          tree: [{ path: 'skills/alpha', type: 'tree', sha: 'tree-alpha' }],
        }),
      }) as typeof fetch;

    const { fetchSkillFolderHash } = await import('../src/skill-lock.ts');

    expect(await fetchSkillFolderHash('org/repo', 'skills/alpha/SKILL.md')).toBeNull();
    expect(await fetchSkillFolderHash('org/repo', 'skills/alpha/SKILL.md')).toBe('tree-alpha');
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });

  it('does not memoize thrown tree fetch failures', async () => {
    global.fetch = vi
      .fn()
      .mockRejectedValueOnce(new Error('network down'))
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          sha: 'root-tree-sha',
          tree: [{ path: 'skills/alpha', type: 'tree', sha: 'tree-alpha' }],
        }),
      }) as typeof fetch;

    const { fetchSkillFolderHash } = await import('../src/skill-lock.ts');

    expect(await fetchSkillFolderHash('org/repo', 'skills/alpha/SKILL.md')).toBeNull();
    expect(await fetchSkillFolderHash('org/repo', 'skills/alpha/SKILL.md')).toBe('tree-alpha');
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });
});
