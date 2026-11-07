import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchConcurrency, mapConcurrent } from '../src/concurrency.ts';

describe('mapConcurrent', () => {
  it('keeps input order even when later items finish first', async () => {
    const result = await mapConcurrent(
      [30, 10, 20],
      (ms) => new Promise<number>((resolve) => setTimeout(() => resolve(ms), ms)),
      3
    );
    expect(result).toEqual([30, 10, 20]);
  });

  it('never runs more than `limit` items at once', async () => {
    let inFlight = 0;
    let peak = 0;
    await mapConcurrent(
      Array.from({ length: 6 }, (_, i) => i),
      async () => {
        peak = Math.max(peak, ++inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight--;
      },
      2
    );
    expect(peak).toBe(2);
  });

  it('returns an empty array for no items', async () => {
    await expect(mapConcurrent([], async () => 1)).resolves.toEqual([]);
  });
});

describe('fetchConcurrency', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('defaults to 4', () => {
    vi.stubEnv('SKILLS_CLONE_CONCURRENCY', '');
    expect(fetchConcurrency()).toBe(4);
  });

  it('honours SKILLS_CLONE_CONCURRENCY', () => {
    vi.stubEnv('SKILLS_CLONE_CONCURRENCY', '8');
    expect(fetchConcurrency()).toBe(8);
  });

  it('ignores values that are not positive integers', () => {
    vi.stubEnv('SKILLS_CLONE_CONCURRENCY', '0');
    expect(fetchConcurrency()).toBe(4);
    vi.stubEnv('SKILLS_CLONE_CONCURRENCY', 'many');
    expect(fetchConcurrency()).toBe(4);
  });
});
