import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { runOrgs } from './orgs.ts';
import { setToken } from './auth-store.ts';

describe('orgs', () => {
  let home: string;
  const saved = { xdg: process.env.XDG_CONFIG_HOME, tok: process.env.SKILLS_TOKEN };
  let logs: string[];

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'skills-orgs-'));
    process.env.XDG_CONFIG_HOME = join(home, '.config');
    delete process.env.SKILLS_TOKEN;
    process.exitCode = 0;
    logs = [];
    vi.spyOn(console, 'log').mockImplementation((m?: unknown) => void logs.push(String(m ?? '')));
    vi.spyOn(console, 'error').mockImplementation((m?: unknown) => void logs.push(String(m ?? '')));
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

  it('reports not-logged-in with exit code 1', async () => {
    await runOrgs('https://skills.sh');
    expect(logs.join('\n')).toMatch(/Not logged in/);
    expect(process.exitCode).toBe(1);
  });

  it('lists orgs, packs, and install commands', async () => {
    setToken('tok');
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              orgs: [
                {
                  slug: 'acme',
                  packs: [{ id: 'acme-foo', name: 'Foo', description: 'd' }],
                },
              ],
            }),
            { status: 200, headers: { 'content-type': 'application/json' } }
          )
      )
    );
    await runOrgs('https://skills.sh');
    const out = logs.join('\n');
    expect(out).toMatch(/acme/);
    expect(out).toMatch(/Foo/);
    expect(out).toMatch(/\/p\/acme-foo/);
  });

  it('reports no organizations when the list is empty', async () => {
    setToken('tok');
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ orgs: [] }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
      )
    );
    await runOrgs('https://skills.sh');
    expect(logs.join('\n')).toMatch(/No enterprise organizations/);
  });

  it('fails cleanly when the server returns a non-JSON 200 (endpoint not deployed)', async () => {
    setToken('tok');
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('<!DOCTYPE html><html></html>', {
            status: 200,
            headers: { 'content-type': 'text/html; charset=utf-8' },
          })
      )
    );
    await runOrgs('https://skills.sh');
    expect(logs.join('\n')).toMatch(/does not support/);
    expect(process.exitCode).toBe(1);
  });

  it('reports session expired on 401 with exit code 1', async () => {
    setToken('tok');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 401 }))
    );
    await runOrgs('https://skills.sh');
    expect(logs.join('\n')).toMatch(/Session expired/);
    expect(process.exitCode).toBe(1);
  });
});
