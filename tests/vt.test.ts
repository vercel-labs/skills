import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHash } from 'crypto';
import { lookupFileHash, checkSkillOnVT } from '../src/vt.ts';

describe('vt', () => {
  const mockApiKey = 'test-api-key-12345';

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('lookupFileHash', () => {
    it('returns malicious verdict when VT reports malicious', async () => {
      const mockResponse = {
        data: {
          attributes: {
            threat_verdict: 'VERDICT_MALICIOUS',
            sha256: 'abc123',
            last_analysis_stats: {
              malicious: 14,
              suspicious: 2,
              undetected: 50,
              harmless: 6,
              timeout: 0,
              'confirmed-timeout': 0,
              failure: 0,
              'type-unsupported': 0,
            },
            crowdsourced_ai_results: [
              { analysis: 'Downloads and executes external binary from untrusted source' },
            ],
            threat_severity: {
              threat_severity_level: 'HIGH',
            },
          },
        },
      };

      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockResponse),
      } as Response);

      const result = await lookupFileHash('abc123', mockApiKey);

      expect(result.found).toBe(true);
      expect(result.verdict).toBe('malicious');
      expect(result.maliciousCount).toBe(14);
      expect(result.totalEngines).toBe(72);
      expect(result.codeInsight).toBe(
        'Downloads and executes external binary from untrusted source'
      );
      expect(result.permalink).toBe('https://www.virustotal.com/gui/file/abc123');
      expect(result.severityLevel).toBe('HIGH');
    });

    it('returns clean verdict when VT reports undetected', async () => {
      const mockResponse = {
        data: {
          attributes: {
            threat_verdict: 'VERDICT_UNDETECTED',
            sha256: 'def456',
            last_analysis_stats: {
              malicious: 0,
              suspicious: 0,
              undetected: 60,
              harmless: 12,
              timeout: 0,
              'confirmed-timeout': 0,
              failure: 0,
              'type-unsupported': 0,
            },
          },
        },
      };

      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockResponse),
      } as Response);

      const result = await lookupFileHash('def456', mockApiKey);

      expect(result.found).toBe(true);
      expect(result.verdict).toBe('undetected');
      expect(result.maliciousCount).toBe(0);
      expect(result.totalEngines).toBe(72);
      expect(result.permalink).toBe('https://www.virustotal.com/gui/file/def456');
    });

    it('returns suspicious verdict', async () => {
      const mockResponse = {
        data: {
          attributes: {
            threat_verdict: 'VERDICT_SUSPICIOUS',
            sha256: 'sus789',
            last_analysis_stats: {
              malicious: 3,
              suspicious: 5,
              undetected: 55,
              harmless: 9,
              timeout: 0,
              'confirmed-timeout': 0,
              failure: 0,
              'type-unsupported': 0,
            },
          },
        },
      };

      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockResponse),
      } as Response);

      const result = await lookupFileHash('sus789', mockApiKey);

      expect(result.found).toBe(true);
      expect(result.verdict).toBe('suspicious');
      expect(result.maliciousCount).toBe(3);
    });

    it('returns not found on 404', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        status: 404,
        json: () => Promise.resolve({}),
      } as Response);

      const result = await lookupFileHash('notfound', mockApiKey);

      expect(result.found).toBe(false);
      expect(result.verdict).toBe('unknown');
      expect(result.maliciousCount).toBe(0);
    });

    it('returns graceful fallback on 429 rate limit', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        status: 429,
        json: () => Promise.resolve({}),
      } as Response);

      const result = await lookupFileHash('ratelimited', mockApiKey);

      expect(result.found).toBe(false);
      expect(result.verdict).toBe('unknown');
    });

    it('returns graceful fallback on network error', async () => {
      vi.mocked(fetch).mockRejectedValue(new Error('Network error'));

      const result = await lookupFileHash('networkerror', mockApiKey);

      expect(result.found).toBe(false);
      expect(result.verdict).toBe('unknown');
    });

    it('sends correct API key header', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        status: 404,
        json: () => Promise.resolve({}),
      } as Response);

      await lookupFileHash('abc123', mockApiKey);

      expect(fetch).toHaveBeenCalledWith('https://www.virustotal.com/api/v3/files/abc123', {
        headers: { 'x-apikey': mockApiKey },
      });
    });

    it('falls back to engine-based verdict when threat_verdict missing', async () => {
      const mockResponse = {
        data: {
          attributes: {
            sha256: 'fallback123',
            last_analysis_stats: {
              malicious: 8,
              suspicious: 0,
              undetected: 55,
              harmless: 9,
              timeout: 0,
              'confirmed-timeout': 0,
              failure: 0,
              'type-unsupported': 0,
            },
          },
        },
      };

      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockResponse),
      } as Response);

      const result = await lookupFileHash('fallback123', mockApiKey);

      expect(result.found).toBe(true);
      expect(result.verdict).toBe('malicious'); // >= 5 malicious engines
    });
  });

  describe('checkSkillOnVT', () => {
    it('computes correct SHA-256 hash', async () => {
      const content = '# My Skill\nDo something helpful';
      const expectedHash = createHash('sha256').update(content).digest('hex');

      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        status: 404,
        json: () => Promise.resolve({}),
      } as Response);

      await checkSkillOnVT(content, mockApiKey);

      expect(fetch).toHaveBeenCalledWith(
        `https://www.virustotal.com/api/v3/files/${expectedHash}`,
        { headers: { 'x-apikey': mockApiKey } }
      );
    });

    it('returns VT verdict for skill content', async () => {
      const mockResponse = {
        data: {
          attributes: {
            threat_verdict: 'VERDICT_UNDETECTED',
            sha256: 'abc',
            last_analysis_stats: {
              malicious: 0,
              suspicious: 0,
              undetected: 60,
              harmless: 12,
              timeout: 0,
              'confirmed-timeout': 0,
              failure: 0,
              'type-unsupported': 0,
            },
          },
        },
      };

      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockResponse),
      } as Response);

      const result = await checkSkillOnVT('test content', mockApiKey);

      expect(result.found).toBe(true);
      expect(result.verdict).toBe('undetected');
    });
  });
});
