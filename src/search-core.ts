/**
 * Search outcome types and hardened search primitives.
 *
 * Motivation (see docs/find-skills-optimization.md):
 *  - The upstream `searchSkillsAPI` returns `[]` for HTTP errors, JSON parse
 *    failures AND network exceptions. A caller cannot distinguish "the service
 *    is down" from "nothing matches", which lets infrastructure failure be
 *    reported to the user as a factual "no skills found".
 *  - The upstream `fetch` has no timeout, unlike the sibling `download-source.ts`
 *    which uses `AbortSignal.timeout(30_000)`.
 *
 * This module keeps the exact same success-path behaviour (same URL, same
 * mapping, same field names) and only makes failure modes explicit.
 */

/** Raw skill shape as returned by the skills.sh search endpoint. */
export interface ApiSearchSkill {
  id: string;
  name: string;
  installs: number;
  source: string;
}

export interface SearchSkill {
  name: string;
  slug: string;
  source: string;
  installs: number;
  /**
   * Zero-based rank assigned by the server (its relevance ordering).
   * `undefined` when the server returns no usable array position.
   */
  relevanceRank?: number;
}

/**
 * Explicit outcome taxonomy.
 *
 * `empty` is the ONLY member that legitimately means "no match".
 * Every other member is a failure and must be surfaced as such.
 */
export type SearchOutcome =
  | { kind: 'ok'; skills: SearchSkill[] }
  | { kind: 'empty'; query: string }
  | { kind: 'timeout'; ms: number }
  | { kind: 'server-error'; status: number }
  | { kind: 'network-error'; cause: string };

export interface SearchParams {
  query: string;
  owner?: string;
  apiBase: string;
  limit: string;
  timeoutMs: number;
  /** Sanitizer applied to every untrusted string field. */
  sanitize: (input: string) => string;
}

/**
 * Performs a search and returns a typed outcome.
 *
 * Never throws for network/protocol level problems: those are reported through
 * the outcome discriminant so callers cannot accidentally treat them as an
 * empty result set.
 */
export async function searchSkills(params: SearchParams): Promise<SearchOutcome> {
  const { query, owner, apiBase, limit, timeoutMs, sanitize } = params;

  const searchParams = new URLSearchParams({ q: query, limit });
  if (owner) searchParams.set('owner', owner);
  const url = `${apiBase}/api/search?${searchParams.toString()}`;

  let res: Response;
  try {
    res = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { accept: 'application/json' },
    });
  } catch (error) {
    return classifyFetchError(error, timeoutMs);
  }

  if (!res.ok) {
    return { kind: 'server-error', status: res.status };
  }

  let payload: { skills?: ApiSearchSkill[] };
  try {
    payload = (await res.json()) as { skills?: ApiSearchSkill[] };
  } catch (error) {
    return { kind: 'network-error', cause: `malformed response: ${describe(error)}` };
  }

  const raw = payload.skills;
  if (!Array.isArray(raw)) {
    return { kind: 'network-error', cause: 'response is missing a "skills" array' };
  }

  if (raw.length === 0) {
    return { kind: 'empty', query };
  }

  return {
    kind: 'ok',
    skills: raw.map((skill, index) => ({
      name: sanitize(skill.name),
      slug: sanitize(skill.id),
      source: sanitize(skill.source || ''),
      installs: Number.isFinite(skill.installs) ? skill.installs : 0,
      // Preserve the server's relevance ordering as data, so downstream
      // ranking can use it instead of destroying it.
      relevanceRank: index,
    })),
  };
}

function classifyFetchError(error: unknown, timeoutMs: number): SearchOutcome {
  const name = error instanceof Error ? error.name : '';
  if (name === 'TimeoutError' || name === 'AbortError') {
    return { kind: 'timeout', ms: timeoutMs };
  }
  return { kind: 'network-error', cause: describe(error) };
}

function describe(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

/**
 * Ranks skills by popularity (primary) with server relevance as a secondary
 * signal.
 *
 * Product decision: installs-dominant, relevance-secondary. Weights are
 * deliberately conservative and are calibrated by tests rather than intuition
 * (see `find-ranking.test.ts`).
 *
 * Popularity is log-compressed because raw install counts span five orders of
 * magnitude (15 installs vs 452K installs); without compression the popularity
 * term would completely swamp the relevance term and the blend would
 * degenerate into the old pure-installs sort.
 */
export interface RankWeights {
  popularity: number;
  relevance: number;
}

export const DEFAULT_RANK_WEIGHTS: RankWeights = {
  popularity: 0.7,
  relevance: 0.3,
};

/** log10(1e6) — normalises installs into[0, 1] for practical skill sizes. */
const LOG_INSTALL_CEILING = Math.log10(1_000_001);

export function popularityScore(installs: number): number {
  if (!Number.isFinite(installs) || installs <= 0) return 0;
  return Math.min(1, Math.log10(1 + installs) / LOG_INSTALL_CEILING);
}

export function relevanceScore(rank: number | undefined, total: number): number {
  if (rank === undefined || total <= 1) return 0;
  const clamped = Math.min(Math.max(rank, 0), total - 1);
  return 1 - clamped / (total - 1);
}

export function rankSkills(
  skills: SearchSkill[],
  weights: RankWeights = DEFAULT_RANK_WEIGHTS
): SearchSkill[] {
  const total = skills.length;
  const scored = skills.map((skill) => ({
    skill,
    score:
      popularityScore(skill.installs) * weights.popularity +
      relevanceScore(skill.relevanceRank, total) * weights.relevance,
  }));

  // Secondary ordering: popularity, then original rank. Both are needed so the
  // result is deterministic for identical scores.
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.skill.installs !== a.skill.installs) return b.skill.installs - a.skill.installs;
    return (
      (a.skill.relevanceRank ?? Number.MAX_SAFE_INTEGER) -
      (b.skill.relevanceRank ?? Number.MAX_SAFE_INTEGER)
    );
  });

  return scored.map((entry) => entry.skill);
}
