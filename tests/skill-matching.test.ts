/**
 * Unit tests for filterSkills function in skills.ts
 *
 * These tests verify the skill matching logic. Multi-word skill names
 * must be quoted on the command line (e.g., --skill "Convex Best Practices").
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { discoverSkills, filterSkills, parseSkillMd } from '../src/skills.ts';
import type { Skill } from '../src/types.ts';

// Mock skill factory
function makeSkill(name: string, path: string = '/tmp/skill'): Skill {
  return { name, description: 'desc', path };
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

describe('parseSkillMd with non-string frontmatter values', () => {
  let testDir: string;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    testDir = join(tmpdir(), `skills-nonstring-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
    warnSpy.mockRestore();
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
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('must be strings'));
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
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('must be strings'));
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
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('must be strings'));
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
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('must be strings'));
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
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

describe('parseSkillMd warnings on parse failures', () => {
  let testDir: string;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    testDir = join(tmpdir(), `skills-warn-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
    warnSpy.mockRestore();
  });

  it('warns when YAML frontmatter fails to parse (issue #1058)', async () => {
    // Reproduces the exact case from issue #1058: a description containing
    // ": " is parsed by the yaml package as a nested compact mapping.
    const skillPath = join(testDir, 'SKILL.md');
    writeFileSync(
      skillPath,
      `---
name: my-skill
description: Configure the harness: Hooks, MCP Servers, Skills
---

# My Skill
`
    );
    const result = await parseSkillMd(skillPath);
    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining(skillPath));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('YAML parse error'));
  });

  it('warns once when discovery skips a malformed skill', async () => {
    const skillDir = join(testDir, 'skills', 'broken-skill');
    const skillPath = join(skillDir, 'SKILL.md');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      skillPath,
      `---
name: broken-skill
description: Configure the harness: Hooks, MCP Servers, Skills
---
`
    );

    const result = await discoverSkills(testDir);

    expect(result).toEqual([]);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining(skillPath));
  });

  it('strips terminal escapes from malformed-skill warnings', async () => {
    const skillDir = join(testDir, 'skills', 'broken-skill');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      `---
name: broken-skill
description: Configure \x1b[31mthe harness: Hooks
---
`
    );

    await discoverSkills(testDir);

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const warning = String(warnSpy.mock.calls[0]?.[0]);
    expect(warning).toContain('Configure the harness: Hooks');
    expect(warning).not.toContain('\x1b');
  });

  it('warns when name is missing', async () => {
    const skillPath = join(testDir, 'SKILL.md');
    writeFileSync(
      skillPath,
      `---
description: A skill with no name
---

# No Name
`
    );
    const result = await parseSkillMd(skillPath);
    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('missing required'));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('name'));
  });

  it('warns when description is missing', async () => {
    const skillPath = join(testDir, 'SKILL.md');
    writeFileSync(
      skillPath,
      `---
name: nameless
---

# No Description
`
    );
    const result = await parseSkillMd(skillPath);
    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('missing required'));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('description'));
  });

  it('warns when SKILL.md cannot be read', async () => {
    const skillPath = join(testDir, 'does-not-exist', 'SKILL.md');
    const result = await parseSkillMd(skillPath);
    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('failed to read file'));
  });

  it('does not warn for internal skills filtered by default', async () => {
    const skillPath = join(testDir, 'SKILL.md');
    writeFileSync(
      skillPath,
      `---
name: internal-skill
description: An internal skill
metadata:
  internal: true
---

# Internal Skill
`
    );
    const result = await parseSkillMd(skillPath);
    expect(result).toBeNull();
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

describe('parseSkillMd with metadata', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `skills-metadata-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  async function parseWithMetadata(metadata: string) {
    const skillPath = join(testDir, 'SKILL.md');
    writeFileSync(
      skillPath,
      `---
name: metadata-skill
description: A skill with metadata
metadata: ${metadata}
---

# Metadata Skill
`
    );
    return parseSkillMd(skillPath);
  }

  it('preserves mapping metadata', async () => {
    const result = await parseWithMetadata(`
  origin: workflow
  runId: 42`);

    expect(result?.metadata).toEqual({ origin: 'workflow', runId: 42 });
  });

  it.each([
    ['scalar', 'private'],
    ['array', '\n  - private\n  - generated'],
    ['null', 'null'],
  ])('omits %s metadata', async (_type, metadata) => {
    const result = await parseWithMetadata(metadata);

    expect(result).not.toBeNull();
    expect(result?.metadata).toBeUndefined();
  });
});
