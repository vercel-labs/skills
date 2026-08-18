import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { createHash } from 'crypto';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { get as httpGet } from 'http';
import {
  generatePkce,
  generateState,
  base64UrlEncode,
  buildAuthorizeUrl,
  exchangeCodeForToken,
  runWhoami,
  runLogout,
  runLogin,
} from './login.ts';
import { setToken } from './auth-store.ts';

describe('login core', () => {
  afterEach(() => vi.restoreAllMocks());

  it('generatePkce produces a verifier and its S256 challenge', () => {
    const { verifier, challenge } = generatePkce();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
    const expected = base64UrlEncode(createHash('sha256').update(verifier).digest());
    expect(challenge).toBe(expected);
  });

  it('generateState is url-safe and non-empty', () => {
    expect(generateState()).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('buildAuthorizeUrl includes required query params', () => {
    const url = new URL(buildAuthorizeUrl('https://skills.sh', 41234, 'CH', 'ST'));
    expect(url.pathname).toBe('/cli/authorize');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('code_challenge')).toBe('CH');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('state')).toBe('ST');
    expect(url.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:41234/callback');
  });

  it('exchangeCodeForToken posts and returns token+user', async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response(JSON.stringify({ token: 'tok', user: { id: 'u', handle: 'h', email: 'e' } }), {
          status: 200,
        })
    );
    vi.stubGlobal('fetch', fetchMock);
    const result = await exchangeCodeForToken('https://skills.sh', {
      code: 'c',
      codeVerifier: 'v',
      state: 's',
    });
    expect(result.token).toBe('tok');
    expect(result.user?.handle).toBe('h');
    const init = fetchMock.mock.calls[0]![1]!;
    expect(JSON.parse(init.body as string)).toEqual({ code: 'c', code_verifier: 'v', state: 's' });
  });

  it('exchangeCodeForToken throws on non-2xx', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 400 }))
    );
    await expect(
      exchangeCodeForToken('https://skills.sh', { code: 'c', codeVerifier: 'v', state: 's' })
    ).rejects.toThrow(/400/);
  });

  it('exchangeCodeForToken throws when the response has no token', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ user: { id: 'u', handle: 'h', email: 'e' } }), {
            status: 200,
          })
      )
    );
    await expect(
      exchangeCodeForToken('https://skills.sh', { code: 'c', codeVerifier: 'v', state: 's' })
    ).rejects.toThrow(/no access token/i);
  });
});

describe('whoami / logout', () => {
  let home: string;
  const saved = { xdg: process.env.XDG_CONFIG_HOME, tok: process.env.SKILLS_TOKEN };
  let logs: string[];

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'skills-login-'));
    process.env.XDG_CONFIG_HOME = join(home, '.config');
    delete process.env.SKILLS_TOKEN;
    process.exitCode = 0;
    logs = [];
    vi.spyOn(console, 'log').mockImplementation((m?: unknown) => void logs.push(String(m)));
    vi.spyOn(console, 'error').mockImplementation((m?: unknown) => void logs.push(String(m)));
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
    vi.restoreAllMocks();
    if (saved.xdg === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = saved.xdg;
    if (saved.tok === undefined) delete process.env.SKILLS_TOKEN;
    else process.env.SKILLS_TOKEN = saved.tok;
    process.exitCode = 0;
  });

  it('whoami reports not-logged-in with exit code 1', async () => {
    await runWhoami('https://skills.sh');
    expect(logs.join('\n')).toMatch(/Not logged in/);
    expect(process.exitCode).toBe(1);
  });

  it('whoami prints identity from /api/me', async () => {
    setToken('tok');
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ user: { id: 'u', handle: 'maya', email: 'm@e.co' } }), {
            status: 200,
          })
      )
    );
    await runWhoami('https://skills.sh');
    expect(logs.join('\n')).toMatch(/maya/);
    expect(logs.join('\n')).toMatch(/m@e\.co/);
  });

  it('whoami reports invalid token on 401 with exit code 1', async () => {
    setToken('tok');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 401 }))
    );
    await runWhoami('https://skills.sh');
    expect(logs.join('\n')).toMatch(/invalid or expired/i);
    expect(process.exitCode).toBe(1);
  });

  it('logout clears the stored token', async () => {
    setToken('tok');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 204 }))
    );
    await runLogout('https://skills.sh');
    const { getToken } = await import('./auth-store.ts');
    expect(getToken()).toBeNull();
    expect(logs.join('\n')).toMatch(/Logged out/);
  });

  it('logout with env token instructs to unset instead of clearing', async () => {
    process.env.SKILLS_TOKEN = 'env-tok';
    await runLogout('https://skills.sh');
    expect(logs.join('\n')).toMatch(/SKILLS_TOKEN/);
  });
});

describe('runLogin loopback', () => {
  const saved = { xdg: process.env.XDG_CONFIG_HOME, tok: process.env.SKILLS_TOKEN };
  let home: string;
  let logs: string[];

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'skills-loginflow-'));
    process.env.XDG_CONFIG_HOME = join(home, '.config');
    delete process.env.SKILLS_TOKEN;
    process.exitCode = 0;
    logs = [];
    vi.spyOn(console, 'log').mockImplementation((m?: unknown) => void logs.push(String(m)));
    vi.spyOn(console, 'error').mockImplementation((m?: unknown) => void logs.push(String(m)));
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
    vi.restoreAllMocks();
    if (saved.xdg === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = saved.xdg;
    if (saved.tok === undefined) delete process.env.SKILLS_TOKEN;
    else process.env.SKILLS_TOKEN = saved.tok;
    process.exitCode = 0;
  });

  async function waitForAuthorizeUrl(): Promise<URL> {
    for (let i = 0; i < 200; i++) {
      const line = logs.find((l) => l.includes('/cli/authorize'));
      if (line) {
        const m = line.match(/https?:\/\/\S+/);
        return new URL(m![0]);
      }
      await new Promise((r) => setTimeout(r, 5));
    }
    throw new Error('authorize url never printed');
  }

  function hitCallback(port: number, query: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const req = httpGet(`http://127.0.0.1:${port}/callback?${query}`, (res) => {
        res.on('data', () => {});
        res.on('end', () => resolve());
      });
      req.on('error', reject);
    });
  }

  function portFrom(url: URL): number {
    return Number(new URL(url.searchParams.get('redirect_uri')!).port);
  }

  it('completes login when a valid callback arrives', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ token: 'tok', user: { id: 'u', handle: 'maya', email: 'm@e.co' } }),
            { status: 200 }
          )
      )
    );
    const done = runLogin('http://skills.test');
    const url = await waitForAuthorizeUrl();
    const state = url.searchParams.get('state')!;
    await hitCallback(portFrom(url), `code=abc&state=${state}`);
    await done;
    const { getToken } = await import('./auth-store.ts');
    expect(getToken()?.token).toBe('tok');
    expect(logs.join('\n')).toMatch(/Logged in as maya/);
    expect(process.exitCode).toBe(0);
  });

  it('fails on state mismatch and stores no token', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 200 }))
    );
    const done = runLogin('http://skills.test');
    const url = await waitForAuthorizeUrl();
    await hitCallback(portFrom(url), `code=abc&state=WRONG`);
    await done;
    const { getToken } = await import('./auth-store.ts');
    expect(getToken()).toBeNull();
    expect(process.exitCode).toBe(1);
    expect(logs.join('\n')).toMatch(/Login failed/);
  });

  it('fails when the provider returns an error param', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 200 }))
    );
    const done = runLogin('http://skills.test');
    const url = await waitForAuthorizeUrl();
    const state = url.searchParams.get('state')!;
    await hitCallback(portFrom(url), `error=access_denied&state=${state}`);
    await done;
    const { getToken } = await import('./auth-store.ts');
    expect(getToken()).toBeNull();
    expect(process.exitCode).toBe(1);
    expect(logs.join('\n')).toMatch(/Login failed/);
  });
});
