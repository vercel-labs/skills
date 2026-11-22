/**
 * `tryBlobInstall` says why the fast path gave up, but only when the user can
 * act on it. A failed repo-tree read is reported; the expected null returns
 * (explicit ref, repo without skills) stay silent, because falling back to a
 * clone is the normal outcome there.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFile } from 'node:child_process';

vi.mock('node:child_process', async (importActual) => {
  const actual = await importActual<typeof import('node:child_process')>();
  return { ...actual, execFile: vi.fn() };
});

import { resetRepoTreeAuthState, tryBlobInstall } from '../src/blob.ts';

function rateLimitResponse(): Response {
  return new Response(JSON.stringify({ message: 'API rate limit exceeded' }), {
    status: 403,
    headers: { 'content-type': 'application/json', 'x-ratelimit-remaining': '0' },
  });
}

function notFoundResponse(): Response {
  return new Response(JSON.stringify({ message: 'Not Found' }), {
    status: 404,
    headers: { 'content-type': 'application/json' },
  });
}

function treeWithoutSkills(): Response {
  return new Response(
    JSON.stringify({ sha: 'deadbeef', tree: [{ path: 'README.md', type: 'blob', sha: 'aaaa' }] }),
    { status: 200, headers: { 'content-type': 'application/json' } }
  );
}

// Persistent on purpose: without a ref the tree read tries HEAD, main and master,
// and each attempt asks `gh api` once.
function ghNotAuthenticated(): void {
  vi.mocked(execFile).mockImplementation(((...args: unknown[]) => {
    const callback = args.at(-1) as (error: Error | null, stdout: string, stderr: string) => void;
    callback(Object.assign(new Error('gh is not authenticated'), { code: 1 }), '', '');
  }) as typeof execFile);
}

describe('tryBlobInstall fallback reason', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let originalFetch: typeof globalThis.fetch;
  let onFallback: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetRepoTreeAuthState();
    originalFetch = globalThis.fetch;
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
    vi.mocked(execFile).mockReset();
    onFallback = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('reports rate-limited when the GitHub rate limit stops the tree read', async () => {
    fetchMock.mockResolvedValueOnce(rateLimitResponse());
    ghNotAuthenticated();

    const result = await tryBlobInstall('vercel/skills', { onFallback });

    expect(result).toBeNull();
    expect(onFallback).toHaveBeenCalledExactlyOnceWith({ reason: 'rate-limited' });
  });

  it('reports tree-unavailable, not rate-limited, when the tree cannot be read for another reason', async () => {
    fetchMock.mockResolvedValueOnce(notFoundResponse());
    ghNotAuthenticated();

    const result = await tryBlobInstall('vercel/skills', { onFallback });

    expect(result).toBeNull();
    expect(onFallback).toHaveBeenCalledExactlyOnceWith({ reason: 'tree-unavailable' });
  });

  it('stays silent for an explicit ref, which skips the fast path by design', async () => {
    const result = await tryBlobInstall('vercel/skills', { ref: 'v1.0.0', onFallback });

    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(onFallback).not.toHaveBeenCalled();
  });

  it('stays silent when the repository has no skills', async () => {
    fetchMock.mockResolvedValueOnce(treeWithoutSkills());

    const result = await tryBlobInstall('vercel/skills', { onFallback });

    expect(result).toBeNull();
    expect(onFallback).not.toHaveBeenCalled();
  });

  it('works without a callback', async () => {
    fetchMock.mockResolvedValueOnce(rateLimitResponse());
    ghNotAuthenticated();

    await expect(tryBlobInstall('vercel/skills')).resolves.toBeNull();
  });
});
