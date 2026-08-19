import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { tryBlobInstall } from '../src/blob.ts';

interface FetchCall {
  url: string;
  init: RequestInit | undefined;
}

describe('tryBlobInstall — raw.githubusercontent.com authentication', () => {
  let calls: FetchCall[];
  let originalFetch: typeof globalThis.fetch;
  let rawRequiresAuth: boolean;

  const SKILL_MD = `---
name: probe-skill
description: a probe
---
body
`;

  const TREE_RESPONSE = {
    sha: 'tree-sha-1',
    tree: [{ path: 'SKILL.md', type: 'blob', sha: 'blob-sha-1' }],
  };

  const DOWNLOAD_RESPONSE = {
    files: [{ path: 'SKILL.md', contents: SKILL_MD }],
    hash: 'snapshot-hash-1',
  };

  function authHeaderOf(call: FetchCall): string | undefined {
    return ((call.init?.headers ?? {}) as Record<string, string>).Authorization;
  }

  beforeEach(() => {
    calls = [];
    rawRequiresAuth = false;
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      calls.push({ url, init });
      if (url.includes('api.github.com/repos/')) {
        return new Response(JSON.stringify(TREE_RESPONSE), { status: 200 });
      }
      if (url.includes('raw.githubusercontent.com/')) {
        // A private repo answers 404 to anonymous requests, 200 once authorised.
        const authorized = Boolean(
          (init?.headers as Record<string, string> | undefined)?.Authorization
        );
        if (rawRequiresAuth && !authorized) {
          return new Response('not found', { status: 404 });
        }
        return new Response(SKILL_MD, { status: 200 });
      }
      if (url.includes('/api/download/')) {
        return new Response(JSON.stringify(DOWNLOAD_RESPONSE), { status: 200 });
      }
      return new Response('not found', { status: 404 });
    }) as unknown as typeof globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('retries a private-repo miss with a Bearer token', async () => {
    rawRequiresAuth = true;
    const getToken = vi.fn(() => 'ghp_testtoken');

    const result = await tryBlobInstall('owner/repo', { getToken });
    expect(result).not.toBeNull();

    const rawCalls = calls.filter((c) => c.url.includes('raw.githubusercontent.com'));
    expect(rawCalls).toHaveLength(2);
    expect(authHeaderOf(rawCalls[0]!)).toBeUndefined();
    expect(authHeaderOf(rawCalls[1]!)).toBe('Bearer ghp_testtoken');
  });

  it('never asks for a token when the unauthenticated fetch succeeds', async () => {
    const getToken = vi.fn(() => 'ghp_testtoken');

    const result = await tryBlobInstall('owner/repo', { getToken });
    expect(result).not.toBeNull();

    expect(getToken).not.toHaveBeenCalled();
    const rawCalls = calls.filter((c) => c.url.includes('raw.githubusercontent.com'));
    expect(rawCalls).toHaveLength(1);
    expect(authHeaderOf(rawCalls[0]!)).toBeUndefined();
  });

  it('resolves the token once even when several skills miss', async () => {
    rawRequiresAuth = true;
    const getToken = vi.fn(() => 'ghp_testtoken');
    TREE_RESPONSE.tree = [
      { path: 'skills/one/SKILL.md', type: 'blob', sha: 'blob-sha-1' },
      { path: 'skills/two/SKILL.md', type: 'blob', sha: 'blob-sha-2' },
    ];

    try {
      const result = await tryBlobInstall('owner/repo', { getToken });
      expect(result).not.toBeNull();
      expect(getToken).toHaveBeenCalledTimes(1);
    } finally {
      TREE_RESPONSE.tree = [{ path: 'SKILL.md', type: 'blob', sha: 'blob-sha-1' }];
    }
  });

  it('does not set Authorization when no getToken callback is supplied', async () => {
    const result = await tryBlobInstall('owner/repo', {});
    expect(result).not.toBeNull();

    const rawCall = calls.find((c) => c.url.includes('raw.githubusercontent.com'));
    expect(rawCall).toBeDefined();
    expect(authHeaderOf(rawCall!)).toBeUndefined();
  });
});
