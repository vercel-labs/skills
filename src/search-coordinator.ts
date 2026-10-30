/**
 * Request de-duplication, TTL cache and stale-response guard for interactive
 * search.
 *
 * Three problems this solves, all verified empirically against the upstream
 * implementation (docs/find-skills-optimization.md):
 *
 *  1. `debounce` only lowers the request *rate*; it does not prevent *out-of-
 *     order* responses from overwriting fresher results. A slow response for an
 *     older query can land after a fast response for a newer one.
 *  2. Every keystroke burst produced a fresh HTTPS round trip with no reuse.
 *  3. There was no timeout, so a hung request blocked the UI indefinitely.
 *
 * `SearchCoordinator` keeps those three concerns separate and independently
 * testable.
 */

import {
  rankSkills,
  type RankWeights,
  type SearchOutcome,
  type SearchParams,
  type SearchSkill,
} from './search-core.ts';

export interface SearchCoordinatorOptions {
  /** Runs the actual search. Injected so tests never touch the network. */
  runSearch: (params: SearchParams) => Promise<SearchOutcome>;
  /** Wall-clock provider, injectable for deterministic cache tests. */
  now?: () => number;
  /** Time-to-live for cached results in ms. Search freshness is not critical. */
  cacheTtlMs?: number;
  /** Maximum number of cached queries before the oldest is evicted. */
  cacheMaxEntries?: number;
  weights?: RankWeights;
}

interface CacheEntry {
  at: number;
  outcome: SearchOutcome;
}

export class SearchCoordinator {
  private readonly runSearch: SearchCoordinatorOptions['runSearch'];
  private readonly now: () => number;
  private readonly cacheTtlMs: number;
  private readonly cacheMaxEntries: number;
  private readonly weights: RankWeights | undefined;
  private readonly cache = new Map<string, CacheEntry>();

  /** Monotonic request counter used to discard stale responses. */
  private requestSeq = 0;

  constructor(options: SearchCoordinatorOptions) {
    this.runSearch = options.runSearch;
    this.now = options.now ?? Date.now;
    this.cacheTtlMs = options.cacheTtlMs ?? 60_000;
    this.cacheMaxEntries = options.cacheMaxEntries ?? 50;
    this.weights = options.weights;
  }

  /**
   * Issues a search identified by `key`.
   *
   * Returns the sequence number assigned to this request together with its
   * settled outcome. The caller must check `isCurrent(seq)` before applying the
   * result to any shared state.
   */
  async search(
    key: string,
    params: Omit<SearchParams, 'sanitize'> & { sanitize: SearchParams['sanitize'] }
  ): Promise<{
    seq: number;
    outcome: SearchOutcome;
    fromCache: boolean;
  }> {
    const seq = ++this.requestSeq;
    const cacheKey = cacheKeyFor(key, params.owner);

    const cached = this.readCache(cacheKey);
    if (cached) {
      return { seq, outcome: cached, fromCache: true };
    }

    const outcome = await this.runSearch(params);
    this.writeCache(cacheKey, outcome);

    return { seq, outcome, fromCache: false };
  }

  /** True when `seq` is the most recently issued request. */
  isCurrent(seq: number): boolean {
    return seq === this.requestSeq;
  }

  /**
   * Ranks an outcome's skills according to the configured weights.
   * Non-ok outcomes pass through untouched.
   */
  ranked(outcome: SearchOutcome): SearchOutcome {
    if (outcome.kind !== 'ok') return outcome;
    return { kind: 'ok', skills: rankSkills(outcome.skills, this.weights) };
  }

  private readCache(key: string): SearchOutcome | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (this.now() - entry.at > this.cacheTtlMs) {
      this.cache.delete(key);
      return null;
    }
    return entry.outcome;
  }

  private writeCache(key: string, outcome: SearchOutcome): void {
    if (this.cache.size >= this.cacheMaxEntries) {
      const oldest = this.cache.keys().next();
      if (!oldest.done) this.cache.delete(oldest.value);
    }
    this.cache.set(key, { at: this.now(), outcome });
  }
}

function cacheKeyFor(query: string, owner?: string): string {
  return `${owner ?? '*'}::${query.toLowerCase()}`;
}

/**
 * Human-readable, actionable description of a failure outcome.
 *
 * The whole point of P0-1: never let an infrastructure failure be phrased as
 * "no skills found".
 */
export function describeFailure(outcome: SearchOutcome): string | null {
  switch (outcome.kind) {
    case 'ok':
    case 'empty':
      return null;
    case 'timeout':
      return `Search timed out after ${outcome.ms}ms. This is a network/service problem, NOT proof that no matching skill exists. Retry, or browse https://skills.sh/ directly.`;
    case 'server-error':
      return `Search service returned HTTP ${outcome.status}. This is a service-side problem, NOT proof that no matching skill exists. Retry later, or browse https://skills.sh/ directly.`;
    case 'network-error':
      return `Could not reach the search service (${outcome.cause}). This is a network problem, NOT proof that no matching skill exists. Check connectivity, or browse https://skills.sh/ directly.`;
  }
}
