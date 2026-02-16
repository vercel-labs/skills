/**
 * Unit tests for .skillignore support.
 *
 * Tests the parsing of .skillignore files and the pattern matching logic
 * that hides internal skills from public discovery.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { parseSkillIgnore, isSkillIgnored, loadSkillIgnorePatterns } from '../src/skillignore.ts';

describe('parseSkillIgnore', () => {
  it('parses simple skill names', () => {
    const result = parseSkillIgnore('internal-tool\ntest-runner');
    expect(result).toEqual(['internal-tool', 'test-runner']);
  });

  it('ignores empty lines', () => {
    const result = parseSkillIgnore('foo\n\nbar\n\n');
    expect(result).toEqual(['foo', 'bar']);
  });

  it('ignores comment lines', () => {
    const result = parseSkillIgnore('# This is a comment\nfoo\n# Another comment\nbar');
    expect(result).toEqual(['foo', 'bar']);
  });

  it('trims whitespace from lines', () => {
    const result = parseSkillIgnore('  foo  \n  bar  ');
    expect(result).toEqual(['foo', 'bar']);
  });

  it('handles wildcard patterns', () => {
    const result = parseSkillIgnore('internal-*\ntest-*');
    expect(result).toEqual(['internal-*', 'test-*']);
  });

  it('returns empty array for empty content', () => {
    expect(parseSkillIgnore('')).toEqual([]);
  });

  it('returns empty array for comments-only content', () => {
    expect(parseSkillIgnore('# just comments\n# nothing else')).toEqual([]);
  });
});

describe('isSkillIgnored', () => {
  it('matches exact skill name', () => {
    expect(isSkillIgnored('internal-tool', ['internal-tool'])).toBe(true);
  });

  it('does not match different skill name', () => {
    expect(isSkillIgnored('public-skill', ['internal-tool'])).toBe(false);
  });

  it('matches trailing wildcard pattern', () => {
    expect(isSkillIgnored('internal-tool', ['internal-*'])).toBe(true);
    expect(isSkillIgnored('internal-eval', ['internal-*'])).toBe(true);
  });

  it('does not match wildcard when prefix differs', () => {
    expect(isSkillIgnored('public-tool', ['internal-*'])).toBe(false);
  });

  it('matches against multiple patterns', () => {
    const patterns = ['internal-*', 'test-*', 'scaffold'];
    expect(isSkillIgnored('internal-tool', patterns)).toBe(true);
    expect(isSkillIgnored('test-runner', patterns)).toBe(true);
    expect(isSkillIgnored('scaffold', patterns)).toBe(true);
    expect(isSkillIgnored('public-skill', patterns)).toBe(false);
  });

  it('returns false for empty patterns', () => {
    expect(isSkillIgnored('any-skill', [])).toBe(false);
  });

  it('wildcard with empty prefix matches everything', () => {
    expect(isSkillIgnored('anything', ['*'])).toBe(true);
  });

  it('handles case differences between pattern and skill name', () => {
    // Pattern has different casing than the skill name
    expect(isSkillIgnored('internal-tool', ['Internal-Tool'])).toBe(true);
  });
});

describe('loadSkillIgnorePatterns', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `skillignore-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('reads and parses .skillignore file', async () => {
    writeFileSync(join(testDir, '.skillignore'), '# Internal tools\ninternal-*\ntest-runner\n');
    const patterns = await loadSkillIgnorePatterns(testDir);
    expect(patterns).toEqual(['internal-*', 'test-runner']);
  });

  it('returns empty array when file does not exist', async () => {
    const patterns = await loadSkillIgnorePatterns(testDir);
    expect(patterns).toEqual([]);
  });

  it('returns empty array for empty file', async () => {
    writeFileSync(join(testDir, '.skillignore'), '');
    const patterns = await loadSkillIgnorePatterns(testDir);
    expect(patterns).toEqual([]);
  });
});
