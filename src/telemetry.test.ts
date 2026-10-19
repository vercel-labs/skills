import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchAuditData } from './telemetry.js';

describe('fetchAuditData', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    delete process.env.DISABLE_TELEMETRY;
    delete process.env.DO_NOT_TRACK;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('enriches only flagged skills with detailed audit findings', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            warned: {
              socket: {
                risk: 'medium',
                alerts: 1,
                analyzedAt: '2026-08-31T00:00:00Z',
              },
            },
            safe: {
              socket: {
                risk: 'safe',
                alerts: 0,
                analyzedAt: '2026-08-31T00:00:00Z',
              },
            },
          })
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            audits: [
              {
                provider: 'Socket',
                slug: 'socket',
                status: 'warn',
                summary: 'One actionable warning.',
                auditedAt: '2026-08-31T00:00:00Z',
                riskLevel: 'MEDIUM',
              },
            ],
          })
        )
      );
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchAuditData('owner/repo', ['warned', 'safe']);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe(
      'https://skills.sh/api/v1/skills/audit/owner%2Frepo/warned'
    );
    expect(result?.warned?.socket).toMatchObject({
      provider: 'Socket',
      providerSlug: 'socket',
      status: 'warn',
      summary: 'One actionable warning.',
      riskLevel: 'MEDIUM',
    });
    expect(result?.safe?.socket?.summary).toBeUndefined();
  });

  it('preserves compact findings when detail enrichment fails', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            warned: {
              socket: {
                risk: 'low',
                alerts: 1,
                analyzedAt: '2026-08-31T00:00:00Z',
              },
            },
          })
        )
      )
      .mockResolvedValueOnce(new Response('', { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchAuditData('owner/repo', ['warned']);

    expect(result?.warned?.socket).toMatchObject({ risk: 'low', alerts: 1 });
    expect(result?.warned?.socket?.summary).toBeUndefined();
  });
});
