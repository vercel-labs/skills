/**
 * Tests for the lazy auth fallback in `fetchRepoTree`.
 *
 * The key behavior under test: a token resolver is invoked ONLY after
 * GitHub returns a rate-limit response (403 + X-RateLimit-Remaining: 0).
 * On a successful unauth call, or on a non-rate-limit 403, the resolver
 * must not be called. This is what keeps `gh auth token` from running
 * during every install. See issue #523.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { fetchRepoTree, resetRepoTreeAuthState } from '../src/blob.ts';

const SAMPLE_TREE = {
  sha: 'deadbeef',
  tree: [
    { path: 'README.md', type: 'blob', sha: 'aaaa' },
    { path: 'skills', type: 'tree', sha: 'bbbb' },
  ],
};

function okResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function rateLimitResponse(): Response {
  return new Response(JSON.stringify({ message: 'API rate limit exceeded' }), {
    status: 403,
    headers: {
      'content-type': 'application/json',
      'x-ratelimit-remaining': '0',
    },
  });
}

function permissionDeniedResponse(): Response {
  return new Response(JSON.stringify({ message: 'Not Found' }), {
    status: 403,
    headers: {
      'content-type': 'application/json',
      'x-ratelimit-remaining': '59',
    },
  });
}

function notFoundResponse(): Response {
  return new Response(JSON.stringify({ message: 'Not Found' }), {
    status: 404,
    headers: { 'content-type': 'application/json' },
  });
}

describe('fetchRepoTree lazy auth fallback', () => {
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

  it('does not invoke the token resolver when the unauth request succeeds', async () => {
    fetchMock.mockResolvedValueOnce(okResponse(SAMPLE_TREE));
    const getToken = vi.fn(() => 'should-not-be-called');

    const result = await fetchRepoTree('vercel/skills', 'main', getToken);

    expect(result?.sha).toBe('deadbeef');
    expect(getToken).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const firstCallInit = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect((firstCallInit.headers as Record<string, string>)['Authorization']).toBeUndefined();
  });

  it('invokes the token resolver and retries with auth when rate-limited', async () => {
    fetchMock
      .mockResolvedValueOnce(rateLimitResponse())
      .mockResolvedValueOnce(okResponse(SAMPLE_TREE));
    const getToken = vi.fn(() => 'ghp_fake_token');

    const result = await fetchRepoTree('vercel/skills', 'main', getToken);

    expect(result?.sha).toBe('deadbeef');
    expect(getToken).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const retryInit = fetchMock.mock.calls[1]?.[1] as RequestInit;
    expect((retryInit.headers as Record<string, string>)['Authorization']).toBe(
      'Bearer ghp_fake_token'
    );
  });

  it('does not invoke the token resolver on a non-rate-limit 403', async () => {
    // A 403 for a private repo (permission denied) is not retryable.
    // The fallback should NOT trigger and should NOT spawn `gh auth token`.
    fetchMock
      .mockResolvedValueOnce(permissionDeniedResponse())
      .mockResolvedValueOnce(permissionDeniedResponse())
      .mockResolvedValueOnce(permissionDeniedResponse());
    const getToken = vi.fn(() => 'should-not-be-called');

    const result = await fetchRepoTree('private/repo', undefined, getToken);

    expect(result).toBeNull();
    expect(getToken).not.toHaveBeenCalled();
  });

  it('invokes the token resolver and retries with auth when a private repo 404s unauthenticated', async () => {
    // GitHub answers 404 (not 403) to anonymous requests for a private repo,
    // to avoid leaking its existence. The token must be tried on 404. See #1318.
    fetchMock
      .mockResolvedValueOnce(notFoundResponse())
      .mockResolvedValueOnce(okResponse(SAMPLE_TREE));
    const getToken = vi.fn(() => 'ghp_fake_token');

    const result = await fetchRepoTree('private/repo', 'master', getToken);

    expect(result?.sha).toBe('deadbeef');
    expect(getToken).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const retryInit = fetchMock.mock.calls[1]?.[1] as RequestInit;
    expect((retryInit.headers as Record<string, string>)['Authorization']).toBe(
      'Bearer ghp_fake_token'
    );
  });

  it('does not flip the session rate-limit flag on a private-repo 404', async () => {
    // A 404 is per-repo, not an IP-level rate limit, so a later source must
    // still attempt the unauthenticated request first.
    fetchMock
      .mockResolvedValueOnce(notFoundResponse()) // call 1: unauth → 404
      .mockResolvedValueOnce(okResponse(SAMPLE_TREE)) // call 1: auth retry → 200
      .mockResolvedValueOnce(okResponse({ ...SAMPLE_TREE, sha: 'public01' })); // call 2: unauth → 200
    const getToken = vi.fn(() => 'ghp_fake_token');

    const first = await fetchRepoTree('private/repo', 'master', getToken);
    const second = await fetchRepoTree('public/repo', 'main', getToken);

    expect(first?.sha).toBe('deadbeef');
    expect(second?.sha).toBe('public01');
    // call 1: unauth + auth = 2; call 2: unauth only = 1 → 3 total.
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const secondCallFirstInit = fetchMock.mock.calls[2]?.[1] as RequestInit;
    expect(
      (secondCallFirstInit.headers as Record<string, string>)['Authorization']
    ).toBeUndefined();
    // The token is consulted only for the private repo, not the public one.
    expect(getToken).toHaveBeenCalledTimes(1);
  });

  it('returns null gracefully when a private repo 404s and no token resolver is provided', async () => {
    fetchMock.mockResolvedValueOnce(notFoundResponse());

    const result = await fetchRepoTree('private/repo', 'master');

    expect(result).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns null gracefully when rate-limited and no token resolver is provided', async () => {
    fetchMock.mockResolvedValueOnce(rateLimitResponse());

    const result = await fetchRepoTree('vercel/skills', 'main');

    expect(result).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns null gracefully when rate-limited and the resolver returns null', async () => {
    fetchMock.mockResolvedValueOnce(rateLimitResponse());
    const getToken = vi.fn(() => null);

    const result = await fetchRepoTree('vercel/skills', 'main', getToken);

    expect(result).toBeNull();
    expect(getToken).toHaveBeenCalledTimes(1);
  });

  it('after a rate-limit hit, subsequent calls skip straight to authenticated', async () => {
    // First call: unauth 403 + auth 200
    fetchMock
      .mockResolvedValueOnce(rateLimitResponse())
      .mockResolvedValueOnce(okResponse(SAMPLE_TREE))
      // Second call: should go directly to auth, no unauth attempt
      .mockResolvedValueOnce(okResponse({ ...SAMPLE_TREE, sha: 'cafef00d' }));

    const getToken = vi.fn(() => 'ghp_fake_token');

    const first = await fetchRepoTree('vercel/skills', 'main', getToken);
    const second = await fetchRepoTree('vercel/agent-skills', 'main', getToken);

    expect(first?.sha).toBe('deadbeef');
    expect(second?.sha).toBe('cafef00d');
    // 2 calls for first (unauth then auth) + 1 call for second (auth only) = 3
    expect(fetchMock).toHaveBeenCalledTimes(3);
    // Both of getToken's calls should return the same token; called once per fetchRepoTree
    expect(getToken).toHaveBeenCalledTimes(2);
    // Verify the second fetchRepoTree call used Authorization on its FIRST request
    const secondCallFirstInit = fetchMock.mock.calls[2]?.[1] as RequestInit;
    expect((secondCallFirstInit.headers as Record<string, string>)['Authorization']).toBe(
      'Bearer ghp_fake_token'
    );
  });
});
