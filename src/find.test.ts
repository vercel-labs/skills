import { describe, it, expect, vi, afterEach } from 'vitest';
import { parseFindArgs, searchSkillsAPI } from './find.ts';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('parseFindArgs', () => {
  it('parses --unsafe flag and query terms', () => {
    expect(parseFindArgs(['typescript', '--unsafe'])).toEqual({
      query: 'typescript',
      allowUnsafe: true,
    });
  });

  it('defaults to safe filtering without --unsafe', () => {
    expect(parseFindArgs(['react', 'performance'])).toEqual({
      query: 'react performance',
      allowUnsafe: false,
    });
  });
});

describe('searchSkillsAPI audit integration', () => {
  it('attaches audit data to search results', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/api/search')) {
          return {
            ok: true,
            json: async () => ({
              skills: [
                {
                  id: 'react-hooks',
                  name: 'react-hooks',
                  installs: 100,
                  source: 'acme/skills',
                },
              ],
            }),
          } as Response;
        }

        if (url.includes('/audit')) {
          return {
            ok: true,
            json: async () => ({
              'react-hooks': {
                ath: { risk: 'safe', analyzedAt: '2026-03-01T00:00:00.000Z' },
                socket: { risk: 'safe', alerts: 0, analyzedAt: '2026-03-01T00:00:00.000Z' },
              },
            }),
          } as Response;
        }

        return { ok: false } as Response;
      })
    );

    const results = await searchSkillsAPI('react');

    expect(results).toHaveLength(1);
    expect(results[0]?.audit).toBeDefined();
    expect(results[0]?.audit?.ath?.risk).toBe('safe');
  });

  it('filters out risky and unknown results by default (safe mode)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/api/search')) {
          return {
            ok: true,
            json: async () => ({
              skills: [
                { id: 'safe-skill', name: 'safe-skill', installs: 100, source: 'acme/skills' },
                { id: 'risky-skill', name: 'risky-skill', installs: 50, source: 'acme/skills' },
                { id: 'unknown-skill', name: 'unknown-skill', installs: 10, source: 'acme/skills' },
              ],
            }),
          } as Response;
        }

        if (url.includes('/audit')) {
          return {
            ok: true,
            json: async () => ({
              'safe-skill': {
                ath: { risk: 'safe', analyzedAt: '2026-03-01T00:00:00.000Z' },
              },
              'risky-skill': {
                ath: { risk: 'high', analyzedAt: '2026-03-01T00:00:00.000Z' },
              },
            }),
          } as Response;
        }

        return { ok: false } as Response;
      })
    );

    const results = await searchSkillsAPI('skill', { allowUnsafe: false });

    expect(results.map((r) => r.name)).toEqual(['safe-skill']);
  });

  it('treats low risk (e.g. Snyk "all clear") as passing the safe filter', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/api/search')) {
          return {
            ok: true,
            json: async () => ({
              skills: [{ id: 'low-skill', name: 'low-skill', installs: 80, source: 'acme/skills' }],
            }),
          } as Response;
        }

        if (url.includes('/audit')) {
          return {
            ok: true,
            json: async () => ({
              'low-skill': {
                ath: { risk: 'safe', analyzedAt: '2026-03-01T00:00:00.000Z' },
                socket: { risk: 'safe', alerts: 0, analyzedAt: '2026-03-01T00:00:00.000Z' },
                snyk: { risk: 'low', analyzedAt: '2026-03-01T00:00:00.000Z' },
              },
            }),
          } as Response;
        }

        return { ok: false } as Response;
      })
    );

    const results = await searchSkillsAPI('skill', { allowUnsafe: false });

    expect(results.map((r) => r.name)).toEqual(['low-skill']);
  });
});
