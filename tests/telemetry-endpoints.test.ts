import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchAuditData, flushTelemetry, track } from '../src/telemetry.ts';

describe('direct telemetry endpoints', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubEnv('DO_NOT_TRACK', '');
    vi.stubEnv('DISABLE_TELEMETRY', '');
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset().mockResolvedValue({ ok: true, json: async () => ({}) });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('sends event and audit requests directly to skills.sh with their query data', async () => {
    track({ event: 'install', source: 'mattpocock/skills', skills: 'ask-matt' });
    await flushTelemetry(1);
    expect(await fetchAuditData('mattpocock/skills', ['ask-matt', 'tdd'])).toEqual({});
    const event = new URL(fetchMock.mock.calls[0]![0]);
    const audit = new URL(fetchMock.mock.calls[1]![0]);
    expect(event.origin + event.pathname).toBe('https://www.skills.sh/tele/t');
    expect(event.searchParams.get('event')).toBe('install');
    expect(event.searchParams.get('source')).toBe('mattpocock/skills');
    expect(event.searchParams.get('skills')).toBe('ask-matt');
    expect(audit.origin + audit.pathname).toBe('https://www.skills.sh/tele/audit');
    expect(audit.searchParams.get('source')).toBe('mattpocock/skills');
    expect(audit.searchParams.get('skills')).toBe('ask-matt,tdd');
  });

  it.each(['DO_NOT_TRACK', 'DISABLE_TELEMETRY'])('honors %s for both endpoints', async (env) => {
    vi.stubEnv(env, '1');
    track({ event: 'install', source: 'mattpocock/skills', skills: 'ask-matt' });
    expect(await fetchAuditData('mattpocock/skills', ['ask-matt'])).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
