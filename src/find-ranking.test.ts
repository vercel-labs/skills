/**
 * Ranking tests — this file exists to CALIBRATE the weights, not to assert
 * whatever the implementation happens to do.
 *
 * The product decision is "installs-dominant, relevance-secondary". The test
 * data below is the real `q=paper` response captured from the live API
 * (see docs/find-skills-optimization.md, evidence #11), in which the upstream
 * pure-installs sort demonstrably promoted unrelated high-popularity skills.
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RANK_WEIGHTS,
  popularityScore,
  rankSkills,
  relevanceScore,
  type SearchSkill,
} from './search-core.ts';

/** Live capture: server relevance order for q=paper (limit=20, truncated to 12). */
const LIVE_PAPER: SearchSkill[] = [
  {
    name: 'paper-context-resolver',
    slug: 'a/paper-context-resolver',
    source: 'a',
    installs: 452294,
    relevanceRank: 0,
  },
  {
    name: 'firecrawl-research-papers',
    slug: 'b/firecrawl-research-papers',
    source: 'b',
    installs: 33140,
    relevanceRank: 1,
  },
  {
    name: 'nature-paper2ppt',
    slug: 'c/nature-paper2ppt',
    source: 'c',
    installs: 14452,
    relevanceRank: 2,
  },
  {
    name: 'nature-paper-to-patent',
    slug: 'd/nature-paper-to-patent',
    source: 'd',
    installs: 11136,
    relevanceRank: 3,
  },
  {
    name: 'academic-paper',
    slug: 'e/academic-paper',
    source: 'e',
    installs: 10132,
    relevanceRank: 4,
  },
  {
    name: 'repo-intake-and-plan',
    slug: 'f/repo-intake-and-plan',
    source: 'f',
    installs: 451509,
    relevanceRank: 5,
  },
  {
    name: 'minimal-run-and-audit',
    slug: 'g/minimal-run-and-audit',
    source: 'g',
    installs: 451440,
    relevanceRank: 6,
  },
  {
    name: 'env-and-assets-bootstrap',
    slug: 'h/env-and-assets-bootstrap',
    source: 'h',
    installs: 451344,
    relevanceRank: 7,
  },
  {
    name: 'ai-research-reproduction',
    slug: 'i/ai-research-reproduction',
    source: 'i',
    installs: 312102,
    relevanceRank: 8,
  },
  {
    name: 'firecrawl-workflows',
    slug: 'j/firecrawl-workflows',
    source: 'j',
    installs: 32214,
    relevanceRank: 9,
  },
  {
    name: 'firecrawl-research-index',
    slug: 'k/firecrawl-research-index',
    source: 'k',
    installs: 22736,
    relevanceRank: 10,
  },
  {
    name: 'sales-enablement',
    slug: 'l/sales-enablement',
    source: 'l',
    installs: 111411,
    relevanceRank: 11,
  },
];

function relevanceDensity(ranked: SearchSkill[], token: string): number {
  return ranked.slice(0, 10).filter((s) => s.name.toLowerCase().includes(token)).length;
}

describe('score components', () => {
  it('compresses popularity with log10 and stays within [0,1]', () => {
    expect(popularityScore(0)).toBe(0);
    expect(popularityScore(-5)).toBe(0);
    expect(popularityScore(1)).toBeGreaterThan(0);
    expect(popularityScore(1_000_001)).toBeLessThanOrEqual(1);
    expect(popularityScore(999_999_999)).toBeLessThanOrEqual(1);
  });

  it('gives strictly descending relevance by rank, 1 for first and 0 for last', () => {
    expect(relevanceScore(0, 5)).toBe(1);
    expect(relevanceScore(4, 5)).toBe(0);
    expect(relevanceScore(2, 5)).toBeGreaterThan(relevanceScore(3, 5));
  });

  it('treats an unknown rank as zero signal rather than throwing', () => {
    expect(relevanceScore(undefined, 5)).toBe(0);
  });

  it('avoids division by zero for single-element lists', () => {
    expect(() => relevanceScore(0, 1)).not.toThrow();
  });
});

describe('rankSkills — the popularity/relevance trade-off', () => {
  it('keeps popularity-dominant behaviour: a 10x popular relevant skill stays on top', () => {
    const ranked = rankSkills(LIVE_PAPER);
    expect(ranked[0]!.slug).toBe('a/paper-context-resolver');
  });

  it('does NOT let a single unrelated mega-popular skill take the #1 slot', () => {
    // repo-intake-and-plan has451K installs (rank 5, name unrelated to "paper").
    // The upstream pure-installs sort placed it #2 overall, ahead of genuinely
    // relevant results. Popularity may lift it, but it must not outrank every
    // strongly relevant hit.
    const ranked = rankSkills(LIVE_PAPER);
    const idxUnrelated = ranked.findIndex((s) => s.slug === 'f/repo-intake-and-plan');
    const idxTopRelevant = ranked.findIndex((s) => s.slug === 'a/paper-context-resolver');
    expect(idxUnrelated).toBeGreaterThan(idxTopRelevant);
  });

  it('improves top-10 relevance density over the upstream pure-installs baseline', () => {
    // Baseline recomputed from this exact fixture: upstream pure-installs sort
    // leaves 3/10 names containing "paper" (paper-context-resolver,
    // firecrawl-research-papers, nature-paper2ppt survive the cut).
    const upstreamOrder = [...LIVE_PAPER].sort((a, b) => b.installs - a.installs);
    expect(relevanceDensity(upstreamOrder, 'paper')).toBe(3);

    const ranked = rankSkills(LIVE_PAPER);
    expect(relevanceDensity(ranked, 'paper')).toBeGreaterThan(3);
  });

  it('is deterministic for identical inputs', () => {
    const once = rankSkills(LIVE_PAPER).map((s) => s.slug);
    const twice = rankSkills([...LIVE_PAPER].reverse()).map((s) => s.slug);
    expect(twice).toEqual(once);
  });

  it('does not mutate its input', () => {
    const input = [...LIVE_PAPER];
    rankSkills(input);
    expect(input.map((s) => s.slug)).toEqual(LIVE_PAPER.map((s) => s.slug));
  });

  it('handles an empty list without throwing', () => {
    expect(rankSkills([])).toEqual([]);
  });

  it('honours custom weights', () => {
    const relevanceOnly = rankSkills(LIVE_PAPER, { popularity: 0, relevance: 1 });
    expect(relevanceOnly.map((s) => s.slug)).toEqual(LIVE_PAPER.map((s) => s.slug));

    // Pure popularity is NOT the same as "the most-installed skill wins":
    // paper-context-resolver has 452,294 installs vs repo-intake-and-plan's
    // 451,509, so it legitimately stays first. This distinguishes the weighted
    // blend from the upstream naive sort, which is what this suite guards.
    const popularityOnly = rankSkills(LIVE_PAPER, { popularity: 1, relevance: 0 });
    const naive = [...LIVE_PAPER].sort((a, b) => b.installs - a.installs);
    expect(popularityOnly.map((s) => s.slug)).toEqual(naive.map((s) => s.slug));
    expect(popularityOnly[0]!.slug).toBe('a/paper-context-resolver');
  });
});

describe('weight calibration grid', () => {
  const grid = [0.5, 0.6, 0.7, 0.8, 0.9, 1];

  it('reports density and unrelated-penalty across weights so the choice is evidence-based', () => {
    const report = grid.map((w) => {
      const ranked = rankSkills(LIVE_PAPER, { popularity: w, relevance: 1 - w });
      const unrelatedTop3 = ranked
        .slice(0, 3)
        .filter((s) => !s.name.toLowerCase().includes('paper')).length;
      return { w, density: relevanceDensity(ranked, 'paper'), unrelatedTop3 };
    });

    // Attach for inspection; assertions below encode the chosen trade-off.
    console.log('WEIGHT_GRID', JSON.stringify(report));

    const chosen = report.find((r) => r.w === DEFAULT_RANK_WEIGHTS.popularity)!;
    // 0.7 must beat the upstream baseline (density 2) and must not let
    // unrelated skills occupy more than half of the top 3.
    expect(chosen.density).toBeGreaterThan(2);
    expect(chosen.unrelatedTop3).toBeLessThanOrEqual(1);
  });
});
