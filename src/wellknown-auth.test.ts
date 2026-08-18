import { describe, it, expect, vi, afterEach } from 'vitest';
import { wellKnownProvider, WellKnownAuthError } from './providers/wellknown.ts';

afterEach(() => vi.restoreAllMocks());

describe('well-known auth surfacing', () => {
  it('throws WellKnownAuthError(401) when the index returns 401', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('no', { status: 401 }))
    );
    await expect(
      wellKnownProvider.fetchAllSkills('https://skills.sh/p/acme-foo')
    ).rejects.toBeInstanceOf(WellKnownAuthError);
  });

  it('sends Authorization when a token is passed and surfaces 403', async () => {
    const fetchMock = vi.fn(
      async (_url?: string, _init?: RequestInit) => new Response('no', { status: 403 })
    );
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      wellKnownProvider.fetchAllSkills('https://skills.sh/p/acme-foo', { token: 'cli_x' })
    ).rejects.toMatchObject({ status: 403 });
    const sentAuth = fetchMock.mock.calls.some(([, init]) => {
      const h = (init as any)?.headers ?? {};
      return h.Authorization === 'Bearer cli_x' || h.authorization === 'Bearer cli_x';
    });
    expect(sentAuth).toBe(true);
  });

  it('re-attaches Authorization across an apex→www redirect (same site)', async () => {
    const calls: Array<{ url: string; auth?: string }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url?: string, init?: RequestInit) => {
        const u = String(url);
        calls.push({ url: u, auth: (init as any)?.headers?.Authorization });
        if (new URL(u).hostname === 'skills.sh') {
          return new Response(null, {
            status: 308,
            headers: { location: u.replace('://skills.sh', '://www.skills.sh') },
          });
        }
        return new Response(JSON.stringify({ skills: [] }), { status: 200 });
      })
    );
    await wellKnownProvider.fetchAllSkills('https://skills.sh/p/acme-foo', { token: 'cli_x' });
    const wwwCall = calls.find((c) => c.url.includes('www.skills.sh'));
    expect(wwwCall).toBeTruthy();
    expect(wwwCall?.auth).toBe('Bearer cli_x');
  });

  it('re-attaches Authorization across a redirect to a same-site subdomain', async () => {
    const calls: Array<{ url: string; auth?: string }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url?: string, init?: RequestInit) => {
        const u = String(url);
        calls.push({ url: u, auth: (init as any)?.headers?.Authorization });
        if (new URL(u).hostname === 'skills.sh') {
          return new Response(null, {
            status: 307,
            headers: { location: u.replace('://skills.sh', '://cdn.skills.sh') },
          });
        }
        return new Response(JSON.stringify({ skills: [] }), { status: 200 });
      })
    );
    await wellKnownProvider.fetchAllSkills('https://skills.sh/p/acme-foo', { token: 'cli_x' });
    const cdnCall = calls.find((c) => c.url.includes('cdn.skills.sh'));
    expect(cdnCall).toBeTruthy();
    expect(cdnCall?.auth).toBe('Bearer cli_x');
  });

  it('drops Authorization when redirected to a look-alike host', async () => {
    const calls: Array<{ url: string; auth?: string }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url?: string, init?: RequestInit) => {
        const u = String(url);
        calls.push({ url: u, auth: (init as any)?.headers?.Authorization });
        if (new URL(u).hostname === 'skills.sh') {
          return new Response(null, {
            status: 302,
            headers: { location: 'https://skills.sh.evil.example/x' },
          });
        }
        return new Response(JSON.stringify({ skills: [] }), { status: 200 });
      })
    );
    await wellKnownProvider.fetchAllSkills('https://skills.sh/p/acme-foo', { token: 'cli_x' });
    const evilCall = calls.find((c) => c.url.includes('skills.sh.evil.example'));
    expect(evilCall).toBeTruthy();
    expect(evilCall?.auth).toBeUndefined();
  });

  it('drops Authorization when redirected to a third-party host', async () => {
    const calls: Array<{ url: string; auth?: string }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url?: string, init?: RequestInit) => {
        const u = String(url);
        calls.push({ url: u, auth: (init as any)?.headers?.Authorization });
        if (new URL(u).hostname === 'skills.sh') {
          return new Response(null, {
            status: 302,
            headers: { location: 'https://evil.example/x' },
          });
        }
        return new Response(JSON.stringify({ skills: [] }), { status: 200 });
      })
    );
    await wellKnownProvider.fetchAllSkills('https://skills.sh/p/acme-foo', { token: 'cli_x' });
    const evilCall = calls.find((c) => c.url.includes('evil.example'));
    expect(evilCall).toBeTruthy();
    expect(evilCall?.auth).toBeUndefined();
  });

  it('never sends Authorization to a cross-origin artifact URL listed in the index', async () => {
    const skillContent = '---\nname: foo\ndescription: bar\n---\n# content';
    const digest = 'sha256:d1dbdb667afbcc709a722b55e6af3a023d86d0506860a00c9fb8c582cb58aa65';
    const indexBody = JSON.stringify({
      $schema: 'https://schemas.agentskills.io/discovery/0.2.0/schema.json',
      skills: [
        {
          name: 'foo',
          type: 'skill-md',
          description: 'bar',
          url: 'https://blob.example/x/SKILL.md',
          digest,
        },
      ],
    });

    const calls: Array<{ url: string; auth?: string }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url?: string, init?: RequestInit) => {
        const u = String(url);
        calls.push({ url: u, auth: (init as any)?.headers?.Authorization });
        if (new URL(u).hostname === 'skills.sh') {
          if (u.includes('/agent-skills/index.json') && u.includes('/p/acme-foo')) {
            return new Response(indexBody, { status: 200 });
          }
          return new Response('not found', { status: 404 });
        }
        if (new URL(u).hostname === 'blob.example') {
          return new Response(skillContent, { status: 200 });
        }
        return new Response('not found', { status: 404 });
      })
    );

    const skills = await wellKnownProvider.fetchAllSkills('https://skills.sh/p/acme-foo', {
      token: 'cli_x',
    });
    expect(skills).toHaveLength(1);

    const skillsShCall = calls.find(
      (c) => c.url.includes('skills.sh') && c.url.includes('/p/acme-foo')
    );
    const blobCall = calls.find((c) => c.url.includes('blob.example'));
    expect(skillsShCall?.auth).toBe('Bearer cli_x');
    expect(blobCall).toBeTruthy();
    expect(blobCall?.auth).toBeUndefined();
  });
});
