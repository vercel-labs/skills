/**
 * Tests for the lazy auth fallback in `fetchRepoTree`.
 *
 * The key behavior under test: authentication is attempted only after GitHub
 * returns a rate limit or an anonymous private-repository response. Explicit
 * tokens stay out of requests that do not need authentication, and stored
 * GitHub CLI credentials are used through `gh api` without being exported.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { execFile } from 'node:child_process';

vi.mock('node:child_process', async (importActual) => {
  const actual = await importActual<typeof import('node:child_process')>();
  return { ...actual, execFile: vi.fn() };
});

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

function mockGhApiError(message = 'gh is not authenticated'): void {
  vi.mocked(execFile).mockImplementationOnce(((...args: unknown[]) => {
    const callback = args.at(-1) as (error: Error | null, stdout: string, stderr: string) => void;
    callback(Object.assign(new Error(message), { code: 1 }), '', message);
  }) as typeof execFile);
}

function mockGhApiSuccess(body: unknown): void {
  vi.mocked(execFile).mockImplementationOnce(((...args: unknown[]) => {
    const callback = args.at(-1) as (error: Error | null, stdout: string, stderr: string) => void;
    callback(null, JSON.stringify(body), '');
  }) as typeof execFile);
}

describe('fetchRepoTree lazy auth fallback', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    resetRepoTreeAuthState();
    originalFetch = globalThis.fetch;
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
    vi.mocked(execFile).mockReset();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.unstubAllEnvs();
  });

  it('does not invoke the token resolver when the unauth request succeeds', async () => {
    fetchMock.mockResolvedValueOnce(okResponse(SAMPLE_TREE));
    const getToken = vi.fn(() => 'should-not-be-called');

    const result = await fetchRepoTree('vercel/skills', 'main', getToken);

    expect(result?.sha).toBe('deadbeef');
    expect(getToken).not.toHaveBeenCalled();
    expect(execFile).not.toHaveBeenCalled();
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
    expect(execFile).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const retryInit = fetchMock.mock.calls[1]?.[1] as RequestInit;
    expect((retryInit.headers as Record<string, string>)['Authorization']).toBe(
      'Bearer ghp_fake_token'
    );
  });

  it('does not invoke the token resolver on a non-rate-limit 403', async () => {
    // A 403 for a private repo (permission denied) is not retryable.
    // The explicit-token fallback should not trigger.
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
    expect(execFile).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const retryInit = fetchMock.mock.calls[1]?.[1] as RequestInit;
    expect((retryInit.headers as Record<string, string>)['Authorization']).toBe(
      'Bearer ghp_fake_token'
    );
  });

  it('returns a private tree through GitHub CLI auth without exporting its credential', async () => {
    fetchMock.mockResolvedValueOnce(notFoundResponse());
    const getToken = vi.fn(() => null);
    mockGhApiSuccess(SAMPLE_TREE);

    const result = await fetchRepoTree('private/repo', 'main', getToken);

    expect(execFile).toHaveBeenCalledTimes(1);
    const [file, args] = vi.mocked(execFile).mock.calls[0]!;
    expect(file).toBe('gh');
    expect(args).toContain('api');
    expect(args).toContain('repos/private/repo/git/trees/main?recursive=1');
    expect(args).not.toContain('auth');
    expect(args).not.toContain('token');
    expect(result).toEqual({ ...SAMPLE_TREE, branch: 'main' });
  });

  it('uses the configured GitHub Enterprise hostname for GitHub CLI API access', async () => {
    vi.stubEnv('GH_HOST', 'github.example.com');
    fetchMock.mockResolvedValueOnce(notFoundResponse());
    mockGhApiSuccess(SAMPLE_TREE);

    const result = await fetchRepoTree('private/repo', 'main', () => null);

    expect(result?.sha).toBe('deadbeef');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://github.example.com/api/v3/repos/private/repo/git/trees/main?recursive=1',
      expect.any(Object)
    );
    const [, args] = vi.mocked(execFile).mock.calls[0]!;
    expect(args).toEqual(expect.arrayContaining(['--hostname', 'github.example.com']));
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
    mockGhApiError();

    const result = await fetchRepoTree('private/repo', 'master');

    expect(result).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns null gracefully when rate-limited and no token resolver is provided', async () => {
    fetchMock.mockResolvedValueOnce(rateLimitResponse());
    mockGhApiError();

    const result = await fetchRepoTree('vercel/skills', 'main');

    expect(result).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns null gracefully when rate-limited and the resolver returns null', async () => {
    fetchMock.mockResolvedValueOnce(rateLimitResponse());
    const getToken = vi.fn(() => null);
    mockGhApiError();

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
