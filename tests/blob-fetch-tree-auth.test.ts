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
  // GitHub returns 404 for a private repo accessed without credentials.
  return new Response(JSON.stringify({ message: 'Not Found' }), {
    status: 404,
    headers: {
      'content-type': 'application/json',
      'x-ratelimit-remaining': '59',
    },
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

  it('invokes the token resolver and retries with auth on a 404 (private repo)', async () => {
    // Private repos 404 unauthenticated, then resolve once a token is sent.
    fetchMock
      .mockResolvedValueOnce(notFoundResponse())
      .mockResolvedValueOnce(okResponse(SAMPLE_TREE));
    const getToken = vi.fn(() => 'ghp_fake_token');

    const result = await fetchRepoTree('owner/private-repo', 'main', getToken);

    expect(result?.sha).toBe('deadbeef');
    expect(getToken).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const retryInit = fetchMock.mock.calls[1]?.[1] as RequestInit;
    expect((retryInit.headers as Record<string, string>)['Authorization']).toBe(
      'Bearer ghp_fake_token'
    );
  });

  it('does not memoize the auth fast path after a 404 (404 is repo-specific)', async () => {
    // A 404-driven auth retry must not flip the process-wide rate-limit memo,
    // so an unrelated public repo still gets its unauthenticated first pass.
    fetchMock
      // First repo: private — unauth 404, then auth 200.
      .mockResolvedValueOnce(notFoundResponse())
      .mockResolvedValueOnce(okResponse(SAMPLE_TREE))
      // Second repo: public — must be attempted unauthenticated first.
      .mockResolvedValueOnce(okResponse({ ...SAMPLE_TREE, sha: 'cafef00d' }));
    const getToken = vi.fn(() => 'ghp_fake_token');

    const first = await fetchRepoTree('owner/private-repo', 'main', getToken);
    const second = await fetchRepoTree('owner/public-repo', 'main', getToken);

    expect(first?.sha).toBe('deadbeef');
    expect(second?.sha).toBe('cafef00d');
    expect(getToken).toHaveBeenCalledTimes(1); // only the private repo needed it
    const secondCallInit = fetchMock.mock.calls[2]?.[1] as RequestInit;
    expect((secondCallInit.headers as Record<string, string>)['Authorization']).toBeUndefined();
  });

  it('returns null on a 404 when no token resolver is provided', async () => {
    fetchMock
      .mockResolvedValueOnce(notFoundResponse())
      .mockResolvedValueOnce(notFoundResponse())
      .mockResolvedValueOnce(notFoundResponse());

    const result = await fetchRepoTree('owner/private-repo');

    expect(result).toBeNull();
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
