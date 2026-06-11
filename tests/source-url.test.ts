import { describe, it, expect } from 'vitest';
import { getLocalLockSourceUrl, sanitizeSourceUrl } from '../src/add.ts';

describe('sanitizeSourceUrl', () => {
  describe('HTTP(S) URLs', () => {
    it('strips username and password from HTTPS URL', () => {
      const result = sanitizeSourceUrl('https://user:pass@gitlab.example.com/org/repo.git');
      expect(result).toBe('https://gitlab.example.com/org/repo.git');
    });

    it('strips username only from HTTPS URL', () => {
      const result = sanitizeSourceUrl('https://user@gitlab.example.com/org/repo.git');
      expect(result).toBe('https://gitlab.example.com/org/repo.git');
    });

    it('strips query string from HTTPS URL', () => {
      const result = sanitizeSourceUrl('https://gitlab.example.com/org/repo.git?token=abc123');
      expect(result).toBe('https://gitlab.example.com/org/repo.git');
    });

    it('strips hash/fragment from HTTPS URL', () => {
      const result = sanitizeSourceUrl('https://gitlab.example.com/org/repo.git#main');
      expect(result).toBe('https://gitlab.example.com/org/repo.git');
    });

    it('strips credentials, query, and hash together', () => {
      const result = sanitizeSourceUrl(
        'https://user:pass@gitlab.example.com/org/repo.git?token=abc#frag'
      );
      expect(result).toBe('https://gitlab.example.com/org/repo.git');
    });

    it('preserves port in HTTPS URL', () => {
      const result = sanitizeSourceUrl('https://user:pass@gitlab.example.com:8443/org/repo.git');
      expect(result).toBe('https://gitlab.example.com:8443/org/repo.git');
    });

    it('preserves clean HTTPS URL unchanged', () => {
      const result = sanitizeSourceUrl('https://gitlab.example.com/org/repo.git');
      expect(result).toBe('https://gitlab.example.com/org/repo.git');
    });

    it('handles http:// URLs', () => {
      const result = sanitizeSourceUrl('http://user:pass@gitlab.example.com/org/repo.git');
      expect(result).toBe('http://gitlab.example.com/org/repo.git');
    });

    it('handles uppercase HTTPS schemes', () => {
      const result = sanitizeSourceUrl(
        'HTTPS://user:pass@gitlab.example.com/org/repo.git?token=abc'
      );
      expect(result).toBe('https://gitlab.example.com/org/repo.git');
    });
  });

  describe('ssh:// URLs', () => {
    it('strips query and hash from ssh:// URL', () => {
      const result = sanitizeSourceUrl('ssh://git@gitlab.example.com/org/repo.git?query#hash');
      expect(result).toBe('ssh://git@gitlab.example.com/org/repo.git');
    });

    it('preserves username in ssh:// URL', () => {
      const result = sanitizeSourceUrl('ssh://git@gitlab.example.com:7999/org/repo.git');
      expect(result).toBe('ssh://git@gitlab.example.com:7999/org/repo.git');
    });

    it('preserves clean ssh:// URL unchanged', () => {
      const result = sanitizeSourceUrl('ssh://git@gitlab.example.com/org/repo.git');
      expect(result).toBe('ssh://git@gitlab.example.com/org/repo.git');
    });

    it('handles uppercase SSH schemes', () => {
      const result = sanitizeSourceUrl('SSH://git@gitlab.example.com/org/repo.git?query#hash');
      expect(result).toBe('ssh://git@gitlab.example.com/org/repo.git');
    });
  });

  describe('scp-like SSH (git@host:...)', () => {
    it('leaves scp-like SSH URL as-is', () => {
      const result = sanitizeSourceUrl('git@gitlab.example.com:org/repo.git');
      expect(result).toBe('git@gitlab.example.com:org/repo.git');
    });

    it('leaves GitHub SSH URL as-is', () => {
      const result = sanitizeSourceUrl('git@github.com:owner/repo.git');
      expect(result).toBe('git@github.com:owner/repo.git');
    });
  });

  describe('non-URL strings', () => {
    it('returns owner/repo shorthand as-is', () => {
      expect(sanitizeSourceUrl('owner/repo')).toBe('owner/repo');
    });

    it('returns local path as-is', () => {
      expect(sanitizeSourceUrl('/some/local/path')).toBe('/some/local/path');
    });
  });
});

describe('getLocalLockSourceUrl', () => {
  it('stores sourceUrl for self-hosted GitLab when normalized source loses host', () => {
    expect(
      getLocalLockSourceUrl('https://gitlab.example.com/org/repo.git', 'org/repo', 'git')
    ).toBe('https://gitlab.example.com/org/repo.git');
  });

  it('does not store sourceUrl for GitHub sources to preserve existing behavior', () => {
    expect(
      getLocalLockSourceUrl('https://github.com/owner/repo.git', 'owner/repo', 'github')
    ).toBeUndefined();
  });

  it('does not store sourceUrl when source already contains the clone URL', () => {
    expect(
      getLocalLockSourceUrl(
        'git@gitlab.example.com:org/repo.git',
        'git@gitlab.example.com:org/repo.git',
        'git'
      )
    ).toBeUndefined();
  });

  it('sanitizes sourceUrl before storing', () => {
    expect(
      getLocalLockSourceUrl(
        'https://user:pass@gitlab.example.com/org/repo.git?token=abc#frag',
        'org/repo',
        'git'
      )
    ).toBe('https://gitlab.example.com/org/repo.git');
  });

  it('does not store sourceUrl when source already contains the original URL', () => {
    expect(
      getLocalLockSourceUrl(
        'https://user:pass@gitlab.example.com/repo.git',
        'https://user:pass@gitlab.example.com/repo.git',
        'git'
      )
    ).toBeUndefined();
  });
});
