import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseFindOptions, runFind, searchSkillsAPI } from './find.ts';
import * as detectAgent from './detect-agent.ts';
import { stripVTControlCharacters } from 'node:util';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it('navigates search results with Ctrl+P/Ctrl+N while plain p/n still search', async () => {
  vi.useFakeTimers();
  vi.spyOn(detectAgent, 'isRunningInAgent').mockResolvedValue(false);
  vi.spyOn(process.stdin, 'resume').mockReturnValue(process.stdin);
  const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.stubEnv('DISABLE_TELEMETRY', '1');
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      skills: ['one', 'two', 'three'].map((name, index) => ({
        id: `owner/repo/${name}`,
        name,
        source: 'owner/repo',
        installs: 3 - index,
      })),
    }),
  });
  vi.stubGlobal('fetch', fetchMock);
  const originalTTY = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
  const originalRawMode = Object.getOwnPropertyDescriptor(process.stdin, 'setRawMode');
  Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: true });
  Object.defineProperty(process.stdin, 'setRawMode', { configurable: true, value: vi.fn() });
  const prompt = runFind([]);

  try {
    await vi.advanceTimersByTimeAsync(0);
    for (const name of ['p', 'n']) {
      process.stdin.emit('keypress', name, { name, sequence: name });
    }
    await vi.advanceTimersByTimeAsync(300);
    expect(new URL(fetchMock.mock.calls[0]![0]).searchParams.get('q')).toBe('pn');

    for (const [name, expected] of [
      ['p', 'one'],
      ['n', 'two'],
      ['n', 'three'],
      ['n', 'three'],
      ['p', 'two'],
    ]) {
      write.mockClear();
      process.stdin.emit('keypress', '', { name, ctrl: true });
      const output = stripVTControlCharacters(write.mock.calls.map(([text]) => text).join(''));
      expect(output).toContain(`> ${expected} `);
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
  } finally {
    process.stdin.emit('keypress', '', { name: 'escape' });
    await prompt;
    for (const [key, descriptor] of [
      ['isTTY', originalTTY],
      ['setRawMode', originalRawMode],
    ] as const) {
      if (descriptor) Object.defineProperty(process.stdin, key, descriptor);
      else Reflect.deleteProperty(process.stdin, key);
    }
  }
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
    expect(parseFindOptions(['react', '--owner']).errors).toEqual([
      '--owner requires a GitHub owner',
    ]);
    expect(parseFindOptions(['react', '--owner', 'not/an/owner']).errors).toEqual([
      '--owner must be a valid GitHub owner',
    ]);
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
    expect(url.searchParams.get('limit')).toBe('20');
  });

  it('prints every result returned for a non-interactive query', async () => {
    const skills = Array.from({ length: 11 }, (_, index) => ({
      id: `owner/repo/skill-${index + 1}`,
      name: `skill-${index + 1}`,
      installs: 11 - index,
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
    expect(output).toContain('owner/repo@skill-11');
  });
});
