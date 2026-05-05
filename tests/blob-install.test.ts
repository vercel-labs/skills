import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tryBlobInstall } from '../src/blob.ts';

describe('tryBlobInstall', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    globalThis.fetch = originalFetch;
  });

  it('reports invalid SKILL.md YAML while still returning valid blob-discovered skills', async () => {
    const fetchMock = vi.mocked(globalThis.fetch);

    fetchMock.mockImplementation(async (input) => {
      const url = String(input);

      if (url.includes('/git/trees/')) {
        return new Response(
          JSON.stringify({
            sha: 'tree-sha',
            tree: [
              { path: 'skills/valid-skill/SKILL.md', type: 'blob', sha: '1' },
              { path: 'skills/broken-skill/SKILL.md', type: 'blob', sha: '2' },
            ],
          }),
          { status: 200 }
        );
      }

      if (url.endsWith('/skills/valid-skill/SKILL.md')) {
        return new Response(
          `---
name: valid-skill
description: A valid skill
---

# Valid Skill
`,
          { status: 200 }
        );
      }

      if (url.endsWith('/skills/broken-skill/SKILL.md')) {
        return new Response(
          `---
name: broken-skill
description: Configure the harness: Hooks, MCP Servers, Skills
---

# Broken Skill
`,
          { status: 200 }
        );
      }

      if (url.includes('/api/download/owner/repo/valid-skill')) {
        return new Response(
          JSON.stringify({
            hash: 'snapshot-hash',
            files: [{ path: 'SKILL.md', contents: '# Valid Skill' }],
          }),
          { status: 200 }
        );
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    const invalid: Array<{ path: string; message: string }> = [];
    const result = await tryBlobInstall('owner/repo', {
      onInvalid: (details) => invalid.push(details),
    });

    expect(result).not.toBeNull();
    expect(result?.skills).toHaveLength(1);
    expect(result?.skills[0]?.name).toBe('valid-skill');
    expect(invalid).toEqual([
      expect.objectContaining({
        path: 'skills/broken-skill/SKILL.md',
      }),
    ]);
    expect(invalid[0]?.message).toContain('YAML parse error:');
  });
});
