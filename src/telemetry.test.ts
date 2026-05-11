import { describe, it, expect, afterEach, vi } from 'vitest';
import { fetchAuditData } from './telemetry.ts';

const originalDisableTelemetry = process.env.DISABLE_TELEMETRY;
const originalDoNotTrack = process.env.DO_NOT_TRACK;

afterEach(() => {
  if (originalDisableTelemetry === undefined) {
    delete process.env.DISABLE_TELEMETRY;
  } else {
    process.env.DISABLE_TELEMETRY = originalDisableTelemetry;
  }

  if (originalDoNotTrack === undefined) {
    delete process.env.DO_NOT_TRACK;
  } else {
    process.env.DO_NOT_TRACK = originalDoNotTrack;
  }

  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('fetchAuditData', () => {
  it('does not call audit endpoint when DISABLE_TELEMETRY is set', async () => {
    process.env.DISABLE_TELEMETRY = '1';
    delete process.env.DO_NOT_TRACK;

    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchAuditData('acme/repo', ['private-skill']);
    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not call audit endpoint when DO_NOT_TRACK is set', async () => {
    delete process.env.DISABLE_TELEMETRY;
    process.env.DO_NOT_TRACK = '1';

    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchAuditData('acme/repo', ['private-skill']);
    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not call audit endpoint when skill list is empty', async () => {
    delete process.env.DISABLE_TELEMETRY;
    delete process.env.DO_NOT_TRACK;

    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchAuditData('acme/repo', []);
    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('calls audit endpoint when telemetry is enabled', async () => {
    delete process.env.DISABLE_TELEMETRY;
    delete process.env.DO_NOT_TRACK;

    const responsePayload = {
      'my-skill': {
        ath: {
          risk: 'safe',
          analyzedAt: '2026-01-01T00:00:00.000Z',
        },
      },
    };

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => responsePayload,
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchAuditData('owner/repo', ['my-skill']);
    expect(result).toEqual(responsePayload);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const calledUrl = String(fetchMock.mock.calls[0]?.[0]);
    expect(calledUrl).toContain('https://add-skill.vercel.sh/audit?');
    expect(calledUrl).toContain('source=owner%2Frepo');
    expect(calledUrl).toContain('skills=my-skill');
  });
});
