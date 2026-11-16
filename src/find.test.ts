import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseFindOptions, runFind, searchSkills, searchSkillsAPI } from './find.ts';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('parseFindOptions', () => {
  it('separates and normalizes an owner from a multi-word query', () => {
    expect(parseFindOptions(['react', 'native', '--owner', 'Vercel'])).toEqual({
      query: 'react native',
      options: { owner: 'vercel' },
      errors: [],
    });
  });

  it('supports the --owner=value form', () => {
    expect(parseFindOptions(['--owner=vercel-labs', 'next'])).toEqual({
      query: 'next',
      options: { owner: 'vercel-labs' },
      errors: [],
    });
  });

  it('rejects missing and invalid owners', () => {
    expect(parseFindOptions(['react', '--owner']).errors.map((e) => e.message)).toEqual([
      '--owner requires a GitHub owner',
    ]);
    expect(
      parseFindOptions(['react', '--owner', 'not/an/owner']).errors.map((e) => e.message)
    ).toEqual(['--owner must be a valid GitHub owner']);
  });
});

describe('searchSkillsAPI', () => {
  it('sends the owner as an API query parameter', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ skills: [] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await searchSkillsAPI('react native', 'vercel');

    const url = new URL(fetchMock.mock.calls[0]![0] as string);
    expect(url.pathname).toBe('/api/search');
    expect(url.searchParams.get('q')).toBe('react native');
    expect(url.searchParams.get('owner')).toBe('vercel');
    expect(url.searchParams.has('limit')).toBe(false);
  });

  it('preserves API relevance order over install counts', async () => {
    const skills = [
      {
        id: 'owner/repo/eval-harness',
        name: 'eval-harness',
        installs: 100,
        source: 'owner/repo',
      },
      {
        id: 'owner/repo/hyperframes-registry',
        name: 'hyperframes-registry',
        installs: 732200,
        source: 'owner/repo',
      },
    ];
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ skills }),
      })
    );

    const results = await searchSkillsAPI('eval');

    expect(results.map((skill) => skill.name)).toEqual(['eval-harness', 'hyperframes-registry']);
  });

  it('prints every result in API order for a non-interactive query', async () => {
    const skills = Array.from({ length: 25 }, (_, index) => ({
      id: `owner/repo/skill-${index + 1}`,
      name: `skill-${index + 1}`,
      installs: index + 1,
      source: 'owner/repo',
    }));
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ skills }),
      })
    );
    vi.stubEnv('DISABLE_TELEMETRY', '1');
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    await runFind(['owner/repo']);

    const output = log.mock.calls.map((args) => args.join(' ')).join('\n');
    expect(output).toContain('owner/repo@skill-1');
    expect(output).toContain('owner/repo@skill-25');
    expect(output.indexOf('owner/repo@skill-1')).toBeLessThan(
      output.indexOf('owner/repo@skill-25')
    );
  });
});

describe('searchSkills', () => {
  const skill = (name: string, installs = 1) => ({
    id: `owner/repo/${name}`,
    name,
    installs,
    source: 'owner/repo',
  });

  function stubSearch(byQuery: Record<string, ReturnType<typeof skill>[]>) {
    const fetchMock = vi.fn(async (input: string) => {
      const q = new URL(input).searchParams.get('q') ?? '';
      return { ok: true, json: async () => ({ skills: byQuery[q] ?? [] }) };
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('does not fan out when the exact query has enough results', async () => {
    const many = Array.from({ length: 10 }, (_, i) => skill(`s-${i}`));
    const fetchMock = stubSearch({ 'next bundle analyzer': many });

    const result = await searchSkills('next bundle analyzer');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.exactCount).toBe(10);
  });

  it('does not fan out for single-term queries', async () => {
    const fetchMock = stubSearch({});
    await searchSkills('analyzer');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('appends partial matches when an extra term hides a relevant skill', async () => {
    const fetchMock = stubSearch({
      'next bundle analyzer': [skill('next-bundle-analyzer')],
      'bundle analyzer': [skill('bundle-analyzer'), skill('next-bundle-analyzer')],
      'next analyzer': [skill('next-bundle-analyzer')],
      'next bundle': [skill('next-bundle-optimizer', 3700), skill('next-perf')],
    });

    const result = await searchSkills('next bundle analyzer');

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(result.exactCount).toBe(1);
    expect(result.skills.map((s) => s.name)).toEqual([
      'next-bundle-analyzer',
      'next-bundle-optimizer',
      'bundle-analyzer',
      'next-perf',
    ]);
  });

  it('ranks skills found by more subqueries first', async () => {
    stubSearch({
      'a b': [skill('only-ab')],
      'a c': [skill('both')],
      'b c': [skill('both')],
    });

    const result = await searchSkills('a b c');

    expect(result.exactCount).toBe(0);
    expect(result.skills.map((s) => s.name)).toEqual(['both', 'only-ab']);
  });

  it('labels partial matches in non-interactive output', async () => {
    stubSearch({ 'next bundle': [skill('next-bundle-optimizer')] });
    vi.stubEnv('DISABLE_TELEMETRY', '1');
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    await runFind(['next', 'bundle', 'analyzer']);

    const output = log.mock.calls.map((args) => args.join(' ')).join('\n');
    expect(output).toContain('No skills matched every term');
    expect(output).toContain('owner/repo@next-bundle-optimizer');
  });
});
