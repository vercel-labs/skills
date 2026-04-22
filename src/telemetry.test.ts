import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { track } from './telemetry.js';

const mockFetch = vi.fn(() => Promise.resolve() as Promise<unknown>);
vi.stubGlobal('fetch', mockFetch);

const savedEnv = { ...process.env };

beforeEach(() => {
  mockFetch.mockClear();
  delete process.env.SKILLS_TELEMETRY_URL;
  delete process.env.npm_config_skills_telemetry_url;
  delete process.env.DISABLE_TELEMETRY;
  delete process.env.DO_NOT_TRACK;
});

afterEach(() => {
  process.env = { ...savedEnv };
});

const payload = { event: 'check' as const, skillCount: '1', updatesAvailable: '0' };

describe('telemetry URL resolution', () => {
  it('sends to default URL when no overrides are set', () => {
    track(payload);
    expect(mockFetch).toHaveBeenCalledOnce();
    const url: string = mockFetch.mock.calls[0][0];
    expect(url).toMatch(/^https:\/\/add-skill\.vercel\.sh\/t\?/);
  });

  it('uses SKILLS_TELEMETRY_URL env var when set', () => {
    process.env.SKILLS_TELEMETRY_URL = 'https://custom.example.com/t';
    track(payload);
    const url: string = mockFetch.mock.calls[0][0];
    expect(url).toMatch(/^https:\/\/custom\.example\.com\/t\?/);
  });

  it('uses npm_config_skills_telemetry_url when set', () => {
    process.env.npm_config_skills_telemetry_url = 'https://npmrc.example.com/t';
    track(payload);
    const url: string = mockFetch.mock.calls[0][0];
    expect(url).toMatch(/^https:\/\/npmrc\.example\.com\/t\?/);
  });

  it('prefers SKILLS_TELEMETRY_URL over npm_config_skills_telemetry_url', () => {
    process.env.SKILLS_TELEMETRY_URL = 'https://envvar.example.com/t';
    process.env.npm_config_skills_telemetry_url = 'https://npmrc.example.com/t';
    track(payload);
    const url: string = mockFetch.mock.calls[0][0];
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

  it('sends when neither opt-out var is set', () => {
    track(payload);
    expect(mockFetch).toHaveBeenCalledOnce();
  });
});
