/**
 * Unit tests for filterSkills function in skills.ts
 *
 * These tests verify the skill matching logic. Multi-word skill names
 * must be quoted on the command line (e.g., --skill "Convex Best Practices").
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { filterSkills, filterSkillsByTag, parseSkillMd } from '../src/skills.ts';
import type { Skill } from '../src/types.ts';

// Mock skill factory
function makeSkill(name: string, path: string = '/tmp/skill', tags?: string[]): Skill {
  return { name, description: 'desc', path, tags };
}

const skills: Skill[] = [
  makeSkill('convex-best-practices'),
  makeSkill('Convex Best Practices'),
  makeSkill('simple-skill'),
  makeSkill('foo'),
  makeSkill('bar'),
];

describe('filterSkills', () => {
  describe('direct matching', () => {
    it('matches exact name', () => {
      const result = filterSkills(skills, ['foo']);
      expect(result.length).toBe(1);
      expect(result[0].name).toBe('foo');
    });

    it('matches case insensitive', () => {
      const result = filterSkills(skills, ['FOO']);
      expect(result.length).toBe(1);
      expect(result[0].name).toBe('foo');
    });

    it('matches kebab-case skill name', () => {
      const result = filterSkills(skills, ['convex-best-practices']);
      expect(result.length).toBe(1);
      expect(result[0].name).toBe('convex-best-practices');
    });

    it('matches multiple skills', () => {
      const result = filterSkills(skills, ['foo', 'bar']);
      expect(result.length).toBe(2);
      const names = result.map((s) => s.name).sort();
      expect(names).toEqual(['bar', 'foo']);
    });
  });

  describe('quoted multi-word names', () => {
    it('matches quoted multi-word name', () => {
      // Simulates: --skill "Convex Best Practices"
      const result = filterSkills(skills, ['Convex Best Practices']);
      expect(result.length).toBe(1);
      expect(result[0].name).toBe('Convex Best Practices');
    });

    it('matches quoted multi-word name case insensitive', () => {
      const result = filterSkills(skills, ['convex best practices']);
      expect(result.length).toBe(1);
      expect(result[0].name).toBe('Convex Best Practices');
    });
  });

  describe('unquoted multi-word names (should not match)', () => {
    it('does not match unquoted multi-word args', () => {
      // Simulates: --skill Convex Best Practices (unquoted - shell splits into 3 args)
      // This should NOT match - users must quote multi-word names
      const result = filterSkills(skills, ['Convex', 'Best', 'Practices']);
      expect(result.length).toBe(0);
    });

    it('does not match partial words', () => {
      const result = filterSkills(skills, ['Convex', 'Best']);
      expect(result.length).toBe(0);
    });
  });

  describe('no matches', () => {
    it('returns empty array when no matches', () => {
      const result = filterSkills(skills, ['nonexistent']);
      expect(result.length).toBe(0);
    });

    it('returns empty array for empty input', () => {
      const result = filterSkills(skills, []);
      expect(result.length).toBe(0);
    });
  });
});

describe('filterSkillsByTag', () => {
  const tagged: Skill[] = [
    makeSkill('py-lint', '/tmp/a', ['python', 'linting']),
    makeSkill('py-fmt', '/tmp/b', ['python', 'formatting']),
    makeSkill('sec-scan', '/tmp/c', ['security']),
    makeSkill('untagged', '/tmp/d'),
    makeSkill('mixed-case', '/tmp/e', ['Python']),
  ];

  it('matches skills with any of the given tags (OR semantics)', () => {
    const result = filterSkillsByTag(tagged, ['python']);
    const names = result.map((s) => s.name).sort();
    expect(names).toEqual(['mixed-case', 'py-fmt', 'py-lint']);
  });

  it('matches case-insensitively against stored tags', () => {
    const result = filterSkillsByTag(tagged, ['PYTHON']);
    expect(result.map((s) => s.name).sort()).toEqual(['mixed-case', 'py-fmt', 'py-lint']);
  });

  it('unions matches from multiple tags', () => {
    const result = filterSkillsByTag(tagged, ['linting', 'security']);
    expect(result.map((s) => s.name).sort()).toEqual(['py-lint', 'sec-scan']);
  });

  it('excludes skills with no tags field', () => {
    const result = filterSkillsByTag(tagged, ['python']);
    expect(result.find((s) => s.name === 'untagged')).toBeUndefined();
  });

  it('returns empty array for unknown tag', () => {
    expect(filterSkillsByTag(tagged, ['rust'])).toEqual([]);
  });
});

describe('parseSkillMd metadata.tags frontmatter', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `skills-tags-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  async function writeSkill(frontmatter: string): Promise<Skill | null> {
    const skillPath = join(testDir, 'SKILL.md');
    writeFileSync(skillPath, `---\nname: test-skill\ndescription: desc\n${frontmatter}---\n`);
    return parseSkillMd(skillPath);
  }

  it('parses metadata.tags YAML array and lowercases them', async () => {
    const skill = await writeSkill('metadata:\n  tags:\n    - Python\n    - Security\n');
    expect(skill?.tags).toEqual(['python', 'security']);
  });

  it('parses metadata.tags comma-separated string', async () => {
    const skill = await writeSkill('metadata:\n  tags: python, security\n');
    expect(skill?.tags).toEqual(['python', 'security']);
  });

  it('omits tags field when metadata.tags is absent', async () => {
    const skill = await writeSkill('metadata:\n  internal: false\n');
    expect(skill?.tags).toBeUndefined();
  });

  it('omits tags field when metadata block itself is absent', async () => {
    const skill = await writeSkill('');
    expect(skill?.tags).toBeUndefined();
  });

  it('ignores top-level tags (must live under metadata)', async () => {
    const skill = await writeSkill('tags: [python]\n');
    expect(skill?.tags).toBeUndefined();
  });

  it('drops non-string and empty entries', async () => {
    const skill = await writeSkill('metadata:\n  tags:\n    - python\n    - ""\n    - 42\n');
    expect(skill?.tags).toEqual(['python']);
  });
});

describe('parseSkillMd with non-string frontmatter values', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `skills-nonstring-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('rejects skill with numeric name', async () => {
    const skillPath = join(testDir, 'SKILL.md');
    writeFileSync(
      skillPath,
      `---
name: 123
description: A skill with numeric name
---

# Numeric Name Skill
`
    );
    const result = await parseSkillMd(skillPath);
    expect(result).toBeNull();
  });

  it('rejects skill with boolean name', async () => {
    const skillPath = join(testDir, 'SKILL.md');
    writeFileSync(
      skillPath,
      `---
name: true
description: A skill with boolean name
---

# Boolean Name Skill
`
    );
    const result = await parseSkillMd(skillPath);
    expect(result).toBeNull();
  });

  it('rejects skill with array name', async () => {
    const skillPath = join(testDir, 'SKILL.md');
    writeFileSync(
      skillPath,
      `---
name:
  - foo
  - bar
description: A skill with array name
---

# Array Name Skill
`
    );
    const result = await parseSkillMd(skillPath);
    expect(result).toBeNull();
  });

  it('rejects skill with numeric description', async () => {
    const skillPath = join(testDir, 'SKILL.md');
    writeFileSync(
      skillPath,
      `---
name: valid-name
description: 456
---

# Numeric Description Skill
`
    );
    const result = await parseSkillMd(skillPath);
    expect(result).toBeNull();
  });

  it('accepts skill with valid string name and description', async () => {
    const skillPath = join(testDir, 'SKILL.md');
    writeFileSync(
      skillPath,
      `---
name: valid-skill
description: A valid skill
---

# Valid Skill
`
    );
    const result = await parseSkillMd(skillPath);
    expect(result).not.toBeNull();
    expect(result!.name).toBe('valid-skill');
  });
});
