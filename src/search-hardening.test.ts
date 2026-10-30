/**
 * Failure-mode and coordinator tests.
 *
 * Core intent: prove that "service is broken" can never be observed as
 * "no matching skills" — the defect documented as risk B in the optimization
 * proposal.
 */

import { describe, expect, it, vi } from 'vitest';
import { searchSkills, type SearchParams } from './search-core.ts';
import { SearchCoordinator, describeFailure } from './search-coordinator.ts';

const baseParams = {
  query: 'paper',
  apiBase: 'https://skills.sh',
  limit: '20',
  timeoutMs: 50,
  sanitize: (s: string): string => s,
};

function okResponse(skills: unknown[]): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({ skills }),
  } as unknown as Response;
}

describe('searchSkills — failure taxonomy', () => {
  it('returns "ok" with server relevance ranks preserved', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        okResponse([
          { id: 'a/one', name: 'one', installs: 10, source: 'a' },
          { id: 'a/two', name: 'two', installs: 99, source: 'a' },
        ])
      )
    );

    const outcome = await searchSkills({ ...baseParams });
    expect(outcome.kind).toBe('ok');
    if (outcome.kind !== 'ok') return;
    expect(outcome.skills.map((s) => s.relevanceRank)).toEqual([0, 1]);
  });

  it('distinguishes a genuine empty result from every failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse([])));
    const outcome = await searchSkills({ ...baseParams });
    expect(outcome.kind).toBe('empty');
    expect(describeFailure(outcome)).toBeNull();
  });

  it('reports server errors distinctly (not as empty)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({}) })
    );
    const outcome = await searchSkills({ ...baseParams });
    expect(outcome).toEqual({ kind: 'server-error', status: 503 });
    expect(describeFailure(outcome)).toContain('HTTP 503');
  });

  it('reports malformed JSON distinctly (not as empty)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError('Unexpected token <');
        },
      })
    );
    const outcome = await searchSkills({ ...baseParams });
    expect(outcome.kind).toBe('network-error');
  });

  it('reports a response missing the skills array distinctly', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ oops: true }) })
    );
    const outcome = await searchSkills({ ...baseParams });
    expect(outcome.kind).toBe('network-error');
    expect(describeFailure(outcome)).toContain('skills');
  });

  it('reports network exceptions distinctly (not as empty)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    const outcome = await searchSkills({ ...baseParams });
    expect(outcome.kind).toBe('network-error');
  });

  it('converts a hung request into a timeout outcome', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(
        (_url: string, init: { signal: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            init.signal.addEventListener('abort', () => {
              reject(Object.assign(new Error('aborted'), { name: 'TimeoutError' }));
            });
          })
      )
    );

    const outcome = await searchSkills({
      ...baseParams,
      timeoutMs: 20,
      sanitize: (s) => s,
    });
    expect(outcome.kind).toBe('timeout');
    expect(describeFailure(outcome)).toContain('NOT proof');
  });

  it('always passes an abort signal so the request can be bounded', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse([]));
    vi.stubGlobal('fetch', fetchMock);
    await searchSkills({ ...baseParams });
    const init = fetchMock.mock.calls[0]![1] as { signal: AbortSignal };
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('never throws for any network-level problem', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('boom')));
    await expect(searchSkills({ ...baseParams })).resolves.toBeDefined();
  });
});

describe('SearchCoordinator', () => {
  it('discards stale responses so a slow old query cannot overwrite a newer one', async () => {
    const resolvers: Array<(value: unknown) => void> = [];
    const coordinator = new SearchCoordinator({
      runSearch: () =>
        new Promise((resolve) => {
          resolvers.push(resolve as (value: unknown) => void);
        }),
    });

    const slow = coordinator.search('pap', { ...baseParams, query: 'pap' });
    const fast = coordinator.search('paper', { ...baseParams, query: 'paper' });

    // Resolve the *newer* request first, then let the older one land late.
    resolvers[1]!({ kind: 'ok', skills: [] });
    const fastResult = await fast;
    resolvers[0]!({ kind: 'ok', skills: [] });
    const slowResult = await slow;

    expect(coordinator.isCurrent(fastResult.seq)).toBe(true);
    expect(coordinator.isCurrent(slowResult.seq)).toBe(false);
    expect(slowResult.seq).not.toBe(fastResult.seq);
  });

  it('serves repeated queries from cache without hitting the network', async () => {
    const runSearch = vi.fn().mockResolvedValue({ kind: 'ok', skills: [] });
    const coordinator = new SearchCoordinator({ runSearch });

    const first = await coordinator.search('paper', { ...baseParams });
    const second = await coordinator.search('paper', { ...baseParams });

    expect(first.fromCache).toBe(false);
    expect(second.fromCache).toBe(true);
    expect(runSearch).toHaveBeenCalledTimes(1);
  });

  it('treats queries as case-insensitive for cache purposes', async () => {
    const runSearch = vi.fn().mockResolvedValue({ kind: 'ok', skills: [] });
    const coordinator = new SearchCoordinator({ runSearch });
    await coordinator.search('Paper', { ...baseParams, query: 'Paper' });
    await coordinator.search('paper', { ...baseParams, query: 'paper' });
    expect(runSearch).toHaveBeenCalledTimes(1);
  });

  it('does not share cache entries across owners', async () => {
    const runSearch = vi.fn().mockResolvedValue({ kind: 'ok', skills: [] });
    const coordinator = new SearchCoordinator({ runSearch });
    await coordinator.search('paper', { ...baseParams, owner: 'vercel' });
    await coordinator.search('paper', { ...baseParams, owner: 'anthropics' });
    expect(runSearch).toHaveBeenCalledTimes(2);
  });

  it('expires cache entries after the TTL', async () => {
    let clock = 0;
    const runSearch = vi.fn().mockResolvedValue({ kind: 'ok', skills: [] });
    const coordinator = new SearchCoordinator({
      runSearch,
      now: () => clock,
      cacheTtlMs: 100,
    });

    await coordinator.search('paper', { ...baseParams });
    clock = 150;
    const after = await coordinator.search('paper', { ...baseParams });

    expect(after.fromCache).toBe(false);
    expect(runSearch).toHaveBeenCalledTimes(2);
  });

  it('caches failures too, so a dead service is not hammered on every keystroke', async () => {
    const runSearch = vi.fn().mockResolvedValue({ kind: 'timeout', ms: 50 });
    const coordinator = new SearchCoordinator({ runSearch });
    await coordinator.search('paper', { ...baseParams });
    const second = await coordinator.search('paper', { ...baseParams });
    expect(second.fromCache).toBe(true);
    expect(runSearch).toHaveBeenCalledTimes(1);
  });

  it('evicts the oldest entry when the cache is full', async () => {
    const runSearch = vi.fn().mockResolvedValue({ kind: 'ok', skills: [] });
    const coordinator = new SearchCoordinator({ runSearch, cacheMaxEntries: 2 });

    await coordinator.search('a', { ...baseParams, query: 'a' });
    await coordinator.search('b', { ...baseParams, query: 'b' });
    await coordinator.search('c', { ...baseParams, query: 'c' });
    await coordinator.search('a', { ...baseParams, query: 'a' });

    expect(runSearch).toHaveBeenCalledTimes(4);
  });

  it('passes non-ok outcomes through ranked() untouched', () => {
    const coordinator = new SearchCoordinator({
      runSearch: vi.fn(),
    });
    const outcome = { kind: 'server-error', status: 500 } as const;
    expect(coordinator.ranked(outcome)).toBe(outcome);
  });
});
