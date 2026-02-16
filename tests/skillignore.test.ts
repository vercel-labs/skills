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
import { discoverSkills } from '../src/skills.ts';

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

// Helper to create a skill directory with a SKILL.md
function createSkill(baseDir: string, name: string): void {
  const dir = join(baseDir, 'skills', name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${name} description\n---\n\n# ${name}\n`
  );
}

describe('discoverSkills with .skillignore', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `skillignore-discover-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('filters out skills matching .skillignore patterns', async () => {
    createSkill(testDir, 'public-skill');
    createSkill(testDir, 'internal-tool');
    createSkill(testDir, 'internal-eval');
    writeFileSync(join(testDir, '.skillignore'), 'internal-*\n');

    const skills = await discoverSkills(testDir);
    const names = skills.map((s) => s.name);

    expect(names).toEqual(['public-skill']);
    expect(names).not.toContain('internal-tool');
    expect(names).not.toContain('internal-eval');
  });

  it('returns all skills when no .skillignore exists', async () => {
    createSkill(testDir, 'skill-a');
    createSkill(testDir, 'skill-b');

    const skills = await discoverSkills(testDir);
    expect(skills).toHaveLength(2);
  });

  it('filters a directly-pointed skill via early return path', async () => {
    // Root SKILL.md (triggers early return in discoverSkills)
    writeFileSync(
      join(testDir, 'SKILL.md'),
      `---\nname: ignored-root\ndescription: Should be ignored\n---\n\n# Ignored\n`
    );
    writeFileSync(join(testDir, '.skillignore'), 'ignored-root\n');

    const skills = await discoverSkills(testDir);
    expect(skills).toHaveLength(0);
  });

  it('does not filter when includeInternal is set', async () => {
    createSkill(testDir, 'public-skill');
    createSkill(testDir, 'internal-tool');
    writeFileSync(join(testDir, '.skillignore'), 'internal-tool\n');

    const skills = await discoverSkills(testDir, undefined, { includeInternal: true });
    const names = skills.map((s) => s.name);

    expect(names).toContain('internal-tool');
    expect(names).toContain('public-skill');
  });
});
