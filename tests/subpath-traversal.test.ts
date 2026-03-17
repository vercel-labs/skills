/**
 * Tests for path traversal prevention in subpath handling.
 *
 * These tests verify that:
 * 1. parseSource() rejects subpaths containing ".." segments
 * 2. isSubpathSafe() correctly detects traversal attempts
 * 3. discoverSkills() throws on unsafe subpaths
 */

import { describe, it, expect } from 'vitest';
import { parseSource, sanitizeSubpath } from '../src/source-parser.ts';
import { isSubpathSafe } from '../src/skills.ts';

describe('sanitizeSubpath', () => {
  it('allows normal subpaths', () => {
    expect(sanitizeSubpath('skills/my-skill')).toBe('skills/my-skill');
    expect(sanitizeSubpath('path/to/skill')).toBe('path/to/skill');
    expect(sanitizeSubpath('src')).toBe('src');
  });

  it('rejects subpaths with .. segments', () => {
    expect(() => sanitizeSubpath('../etc')).toThrow('Unsafe subpath');
    expect(() => sanitizeSubpath('../../etc/passwd')).toThrow('Unsafe subpath');
    expect(() => sanitizeSubpath('skills/../../etc')).toThrow('Unsafe subpath');
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
    expect(sanitizeSubpath('..skill')).toBe('..skill');
    expect(sanitizeSubpath('skill..')).toBe('skill..');
  });
});

describe('isSubpathSafe', () => {
  it('returns true for subpaths within basePath', () => {
    expect(isSubpathSafe('/tmp/repo', 'skills')).toBe(true);
    expect(isSubpathSafe('/tmp/repo', 'skills/my-skill')).toBe(true);
    expect(isSubpathSafe('/tmp/repo', 'a/b/c')).toBe(true);
  });

  it('returns false for subpaths that escape basePath', () => {
    expect(isSubpathSafe('/tmp/repo', '..')).toBe(false);
    expect(isSubpathSafe('/tmp/repo', '../etc')).toBe(false);
    expect(isSubpathSafe('/tmp/repo', '../../etc/passwd')).toBe(false);
    expect(isSubpathSafe('/tmp/repo', 'skills/../../..')).toBe(false);
  });

  it('handles normalized traversal that stays within', () => {
    // "skills/../other" normalizes to "other" which is still within basePath
    expect(isSubpathSafe('/tmp/repo', 'skills/../other')).toBe(true);
  });

  it('handles edge case of subpath resolving to basePath itself', () => {
    expect(isSubpathSafe('/tmp/repo', '.')).toBe(true);
    expect(isSubpathSafe('/tmp/repo', 'skills/..')).toBe(true);
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
      const result = parseSource('https://github.com/owner/repo/tree/main/skills/my-skill');
      expect(result.subpath).toBe('skills/my-skill');
    });
  });

  describe('GitLab tree URLs with path traversal', () => {
    it('rejects .. in GitLab tree URL subpath', () => {
      expect(() => parseSource('https://gitlab.com/owner/repo/-/tree/main/../../etc')).toThrow(
        'Unsafe subpath'
      );
    });

    it('allows valid GitLab tree URL subpath', () => {
      const result = parseSource('https://gitlab.com/owner/repo/-/tree/main/src/skills');
      expect(result.subpath).toBe('src/skills');
    });
  });

  describe('GitHub shorthand with path traversal', () => {
    it('rejects .. in shorthand subpath', () => {
      // Note: owner/repo/../../etc is parsed as owner/repo with subpath ../../etc
      // The shorthand regex captures everything after owner/repo as subpath
      expect(() => parseSource('owner/repo/../../etc')).toThrow('Unsafe subpath');
    });

    it('allows valid shorthand subpath', () => {
      const result = parseSource('owner/repo/skills/my-skill');
      expect(result.subpath).toBe('skills/my-skill');
    });
  });
});
