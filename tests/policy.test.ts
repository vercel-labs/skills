import { describe, expect, it } from 'vitest';
import { evaluatePolicy } from '../src/policy.ts';
import type { ParsedSource } from '../src/types.ts';

const gh = (path = 'vercel-labs/agent-skills'): ParsedSource => ({
  type: 'github',
  url: `https://github.com/${path}`,
});

const wk = (host = 'evil.tld'): ParsedSource => ({
  type: 'well-known',
  url: `https://${host}`,
});

describe('evaluatePolicy', () => {
  it('default-denies well-known when no policy and no flag', () => {
    const d = evaluatePolicy({ parsed: wk(), policy: null });
    expect(d.allowed).toBe(false);
    expect(d.mechanism).toBe('well-known-default');
  });

  it('allows well-known when --allow-well-known flag is set', () => {
    const d = evaluatePolicy({ parsed: wk(), policy: null, allowWellKnownFlag: true });
    expect(d.allowed).toBe(true);
    expect(d.mechanism).toBe('cli_flag');
  });

  it('allows github by default with no policy file', () => {
    const d = evaluatePolicy({ parsed: gh(), policy: null });
    expect(d.allowed).toBe(true);
  });

  it('default rule cascades to all providers', () => {
    const d = evaluatePolicy({
      parsed: gh(),
      policy: { version: 1, default: 'deny' },
    });
    expect(d.allowed).toBe(false);
    expect(d.mechanism).toBe('default');
  });

  it('per-provider override beats default', () => {
    const d = evaluatePolicy({
      parsed: gh(),
      policy: { version: 1, default: 'deny', providers: { github: 'allow' } },
    });
    expect(d.allowed).toBe(true);
    expect(d.mechanism).toBe('provider');
  });

  it('allow_sources beats default-deny', () => {
    const d = evaluatePolicy({
      parsed: gh('acme-corp/skills'),
      policy: {
        version: 1,
        default: 'deny',
        allow_sources: ['github.com/acme-corp/*'],
      },
    });
    expect(d.allowed).toBe(true);
    expect(d.mechanism).toBe('allow_sources');
  });

  it('deny_sources beats allow_sources match', () => {
    const d = evaluatePolicy({
      parsed: gh('acme-corp/sketchy'),
      policy: {
        version: 1,
        default: 'allow',
        allow_sources: ['github.com/acme-corp/*'],
        deny_sources: ['github.com/acme-corp/sketchy'],
      },
    });
    expect(d.allowed).toBe(false);
    expect(d.mechanism).toBe('deny_sources');
  });

  it('explicit policy can re-enable well-known fleet-wide', () => {
    const d = evaluatePolicy({
      parsed: wk('skills.acme.corp'),
      policy: { version: 1, providers: { '.well-known': 'allow' } },
    });
    expect(d.allowed).toBe(true);
    expect(d.mechanism).toBe('provider');
  });

  it('proxy_only without a configured mirror denies with a helpful error', () => {
    const d = evaluatePolicy({
      parsed: gh(),
      policy: { version: 1, providers: { github: 'proxy_only' } },
    });
    expect(d.allowed).toBe(false);
    expect(d.reason).toMatch(/no mirror is configured/);
    expect(d.reason).toMatch(/policy.mirror.url/);
  });

  it('proxy_only with mirror rewrites to GOPROXY-shaped URL', () => {
    const d = evaluatePolicy({
      parsed: gh('vercel-labs/agent-skills'),
      policy: {
        version: 1,
        providers: { github: 'proxy_only' },
        mirror: {
          url: 'https://artifactory.corp/agent-skills',
          providers: ['github'],
        },
      },
    });
    expect(d.allowed).toBe(true);
    expect(d.mechanism).toBe('mirror_rewrite');
    expect(d.rewriteTo).toBe(
      'https://artifactory.corp/agent-skills/github.com/vercel-labs/agent-skills'
    );
  });

  it('proxy_only with mirror but provider not in providers[] denies', () => {
    const d = evaluatePolicy({
      parsed: gh(),
      policy: {
        version: 1,
        providers: { github: 'proxy_only' },
        mirror: {
          url: 'https://artifactory.corp/agent-skills',
          providers: ['gitlab'], // github not listed
        },
      },
    });
    expect(d.allowed).toBe(false);
    expect(d.reason).toMatch(/no mirror is configured/);
  });

  it('mirror url trailing slash and host/path are joined cleanly', () => {
    const d = evaluatePolicy({
      parsed: gh('foo/bar'),
      policy: {
        version: 1,
        providers: { github: 'proxy_only' },
        mirror: {
          url: 'https://artifactory.corp/agent-skills/',
          providers: ['github'],
        },
      },
    });
    expect(d.rewriteTo).toBe('https://artifactory.corp/agent-skills/github.com/foo/bar');
  });

  it('glob matcher does not let owner-prefix patterns leak across orgs', () => {
    const d = evaluatePolicy({
      parsed: gh('acme-corp-evil/x'),
      policy: {
        version: 1,
        default: 'deny',
        allow_sources: ['github.com/acme-corp/*'],
      },
    });
    expect(d.allowed).toBe(false);
  });
});
