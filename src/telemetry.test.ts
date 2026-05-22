import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { shouldSendTelemetry, track } from './telemetry.ts';

const mockFetch = vi.fn((..._args: unknown[]) => Promise.resolve(new Response()));
vi.stubGlobal('fetch', mockFetch);

const TELEMETRY_ENV_VARS = [
  'SKILLS_TELEMETRY_URL',
  'npm_config_skills_telemetry_url',
  'SKILLS_TELEMETRY_ALLOW_PRIVATE',
  'DISABLE_TELEMETRY',
  'DO_NOT_TRACK',
];

const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  mockFetch.mockClear();
  for (const key of TELEMETRY_ENV_VARS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of TELEMETRY_ENV_VARS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

const payload = {
  event: 'install' as const,
  source: 'owner/repo',
  skills: 'a',
  agents: 'cursor',
};

describe('telemetry URL resolution', () => {
  it('sends to the default URL when no overrides are set', () => {
    track(payload);
    expect(mockFetch).toHaveBeenCalledOnce();
    const url = String(mockFetch.mock.calls[0]?.[0]);
    expect(url).toMatch(/^https:\/\/add-skill\.vercel\.sh\/t\?/);
  });

  it('uses SKILLS_TELEMETRY_URL when set', () => {
    process.env.SKILLS_TELEMETRY_URL = 'https://custom.example.com/t';
    track(payload);
    const url = String(mockFetch.mock.calls[0]?.[0]);
    expect(url).toMatch(/^https:\/\/custom\.example\.com\/t\?/);
  });

  it('uses npm_config_skills_telemetry_url (.npmrc) when set', () => {
    process.env.npm_config_skills_telemetry_url = 'https://npmrc.example.com/t';
    track(payload);
    const url = String(mockFetch.mock.calls[0]?.[0]);
    expect(url).toMatch(/^https:\/\/npmrc\.example\.com\/t\?/);
  });

  it('prefers SKILLS_TELEMETRY_URL over npm_config_skills_telemetry_url', () => {
    process.env.SKILLS_TELEMETRY_URL = 'https://envvar.example.com/t';
    process.env.npm_config_skills_telemetry_url = 'https://npmrc.example.com/t';
    track(payload);
    const url = String(mockFetch.mock.calls[0]?.[0]);
    expect(url).toMatch(/^https:\/\/envvar\.example\.com\/t\?/);
  });
});

describe('telemetry opt-out', () => {
  it('does not send when DISABLE_TELEMETRY is set', () => {
    process.env.DISABLE_TELEMETRY = '1';
    track(payload);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('does not send when DO_NOT_TRACK is set', () => {
    process.env.DO_NOT_TRACK = '1';
    track(payload);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('opt-out wins over a custom endpoint', () => {
    process.env.SKILLS_TELEMETRY_URL = 'https://custom.example.com/t';
    process.env.DO_NOT_TRACK = '1';
    track(payload);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe('shouldSendTelemetry', () => {
  it('always sends for public sources', () => {
    expect(shouldSendTelemetry('public')).toBe(true);
  });

  it('skips private sources with no custom endpoint', () => {
    expect(shouldSendTelemetry('private')).toBe(false);
  });

  it('skips unknown sources with no custom endpoint', () => {
    expect(shouldSendTelemetry('unknown')).toBe(false);
  });

  it('skips private sources with custom endpoint but no opt-in', () => {
    process.env.SKILLS_TELEMETRY_URL = 'https://custom.example.com/t';
    expect(shouldSendTelemetry('private')).toBe(false);
  });

  it('skips private sources with opt-in but no custom endpoint', () => {
    process.env.SKILLS_TELEMETRY_ALLOW_PRIVATE = '1';
    expect(shouldSendTelemetry('private')).toBe(false);
  });

  it('sends private sources when both custom endpoint and opt-in are set', () => {
    process.env.SKILLS_TELEMETRY_URL = 'https://custom.example.com/t';
    process.env.SKILLS_TELEMETRY_ALLOW_PRIVATE = '1';
    expect(shouldSendTelemetry('private')).toBe(true);
  });

  it('sends unknown sources when both custom endpoint and opt-in are set', () => {
    process.env.SKILLS_TELEMETRY_URL = 'https://custom.example.com/t';
    process.env.SKILLS_TELEMETRY_ALLOW_PRIVATE = '1';
    expect(shouldSendTelemetry('unknown')).toBe(true);
  });

  it('treats npm_config_skills_telemetry_url as a custom endpoint for opt-in', () => {
    process.env.npm_config_skills_telemetry_url = 'https://npmrc.example.com/t';
    process.env.SKILLS_TELEMETRY_ALLOW_PRIVATE = '1';
    expect(shouldSendTelemetry('private')).toBe(true);
  });

  it('does not honor opt-in when SKILLS_TELEMETRY_URL equals the default endpoint', () => {
    process.env.SKILLS_TELEMETRY_URL = 'https://add-skill.vercel.sh/t';
    process.env.SKILLS_TELEMETRY_ALLOW_PRIVATE = '1';
    expect(shouldSendTelemetry('private')).toBe(false);
  });
});
