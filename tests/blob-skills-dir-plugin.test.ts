/**
 * The blob fast path installs per-skill snapshots, so it cannot carry a
 * skills-dir plugin's manifest and hooks. Those repos must use the clone path.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { resetRepoTreeAuthState, tryBlobInstall } from '../src/blob.ts';

function okResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('tryBlobInstall with skills-dir plugins', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    resetRepoTreeAuthState();
    originalFetch = globalThis.fetch;
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('falls back to the clone path when a skill belongs to a skills-dir plugin', async () => {
    fetchMock.mockResolvedValueOnce(
      okResponse({
        sha: 'plugin-tree-sha',
        tree: [
          { path: 'skills/my-plugin/.claude-plugin/plugin.json', type: 'blob', sha: 'manifest' },
          { path: 'skills/my-plugin/hooks/hooks.json', type: 'blob', sha: 'hooks' },
          { path: 'skills/my-plugin/skills/my-skill/SKILL.md', type: 'blob', sha: 'skill' },
        ],
      })
    );

    const result = await tryBlobInstall('vercel-labs/example');

    expect(result).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
