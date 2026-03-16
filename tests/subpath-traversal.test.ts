/**
 * Tests for path traversal prevention in subpath handling.
 *
 * These tests verify that:
 * 1. parseSource() rejects subpaths containing ".." segments
 * 2. isSubpathSafe() correctly detects traversal attempts
 * 3. discoverAgents() throws on unsafe subpaths
 */

import { describe, it, expect } from 'vitest';
import { parseSource, sanitizeSubpath } from '../src/source-parser.ts';
import { isSubpathSafe } from '../src/agents.ts';

describe('sanitizeSubpath', () => {
  it('allows normal subpaths', () => {
    expect(sanitizeSubpath('agents/my-agent')).toBe('agents/my-agent');
    expect(sanitizeSubpath('path/to/agent')).toBe('path/to/agent');
    expect(sanitizeSubpath('src')).toBe('src');
  });

  it('rejects subpaths with .. segments', () => {
    expect(() => sanitizeSubpath('../etc')).toThrow('Unsafe subpath');
    expect(() => sanitizeSubpath('../../etc/passwd')).toThrow('Unsafe subpath');
    expect(() => sanitizeSubpath('agents/../../etc')).toThrow('Unsafe subpath');
    expect(() => sanitizeSubpath('a/b/../../../etc')).toThrow('Unsafe subpath');
  });

  it('rejects subpaths with backslash traversal', () => {
    expect(() => sanitizeSubpath('..\\etc')).toThrow('Unsafe subpath');
    expect(() => sanitizeSubpath('..\\..\\secret')).toThrow('Unsafe subpath');
  });

  it('allows paths with dots that are not traversal', () => {
    expect(sanitizeSubpath('.hidden')).toBe('.hidden');
    expect(sanitizeSubpath('file.txt')).toBe('file.txt');
    expect(sanitizeSubpath('path/to/.config')).toBe('path/to/.config');
    expect(sanitizeSubpath('..agent')).toBe('..agent');
    expect(sanitizeSubpath('agent..')).toBe('agent..');
  });
});

describe('isSubpathSafe', () => {
  it('returns true for subpaths within basePath', () => {
    expect(isSubpathSafe('/tmp/repo', 'agents')).toBe(true);
    expect(isSubpathSafe('/tmp/repo', 'agents/my-agent')).toBe(true);
    expect(isSubpathSafe('/tmp/repo', 'a/b/c')).toBe(true);
  });

  it('returns false for subpaths that escape basePath', () => {
    expect(isSubpathSafe('/tmp/repo', '..')).toBe(false);
    expect(isSubpathSafe('/tmp/repo', '../etc')).toBe(false);
    expect(isSubpathSafe('/tmp/repo', '../../etc/passwd')).toBe(false);
    expect(isSubpathSafe('/tmp/repo', 'agents/../../..')).toBe(false);
  });

  it('handles normalized traversal that stays within', () => {
    // "agents/../other" normalizes to "other" which is still within basePath
    expect(isSubpathSafe('/tmp/repo', 'agents/../other')).toBe(true);
  });

  it('handles edge case of subpath resolving to basePath itself', () => {
    expect(isSubpathSafe('/tmp/repo', '.')).toBe(true);
    expect(isSubpathSafe('/tmp/repo', 'agents/..')).toBe(true);
  });
});

describe('parseSource rejects traversal in subpaths', () => {
  describe('GitHub tree URLs with path traversal', () => {
    it('rejects .. in GitHub tree URL subpath', () => {
      expect(() => parseSource('https://github.com/owner/repo/tree/main/../../etc')).toThrow(
        'Unsafe subpath'
      );
    });

    it('rejects deeply nested traversal', () => {
      expect(() => parseSource('https://github.com/owner/repo/tree/main/a/b/../../../etc')).toThrow(
        'Unsafe subpath'
      );
    });

    it('allows valid GitHub tree URL subpath', () => {
      const result = parseSource('https://github.com/owner/repo/tree/main/agents/my-agent');
      expect(result.subpath).toBe('agents/my-agent');
    });
  });

  describe('GitLab tree URLs with path traversal', () => {
    it('rejects .. in GitLab tree URL subpath', () => {
      expect(() => parseSource('https://gitlab.com/owner/repo/-/tree/main/../../etc')).toThrow(
        'Unsafe subpath'
      );
    });

    it('allows valid GitLab tree URL subpath', () => {
      const result = parseSource('https://gitlab.com/owner/repo/-/tree/main/src/agents');
      expect(result.subpath).toBe('src/agents');
    });
  });

  describe('GitHub shorthand with path traversal', () => {
    it('rejects .. in shorthand subpath', () => {
      // Note: owner/repo/../../etc is parsed as owner/repo with subpath ../../etc
      // The shorthand regex captures everything after owner/repo as subpath
      expect(() => parseSource('owner/repo/../../etc')).toThrow('Unsafe subpath');
    });

    it('allows valid shorthand subpath', () => {
      const result = parseSource('owner/repo/agents/my-agent');
      expect(result.subpath).toBe('agents/my-agent');
    });
  });
});
