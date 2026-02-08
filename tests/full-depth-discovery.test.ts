/**
 * Tests for the --full-depth option in skill discovery.
 *
 * When a repository has both a root SKILL.md and nested skills in subdirectories,
 * the --full-depth flag allows discovering all skills instead of just the root one.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { discoverSkills } from '../src/services/discovery/index.ts';

describe('discoverSkills with fullDepth option', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `skills-full-depth-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('should only return root skill when fullDepth is false', async () => {
    // Create root SKILL.md
    writeFileSync(
      join(testDir, 'SKILL.md'),
      `---
name: root-skill
description: Root level skill
---

# Root Skill
`
    );

    // Create nested skill in skills/ directory
    mkdirSync(join(testDir, 'skills', 'nested-skill'), { recursive: true });
    writeFileSync(
      join(testDir, 'skills', 'nested-skill', 'SKILL.md'),
      `---
name: nested-skill
description: Nested skill
---

# Nested Skill
`
    );

    const skills = await discoverSkills(testDir, undefined, { fullDepth: false });

    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe('root-skill');
  });

  it('should return all skills when fullDepth is true', async () => {
    // Create root SKILL.md
    writeFileSync(
      join(testDir, 'SKILL.md'),
      `---
name: root-skill
description: Root level skill
---

# Root Skill
`
    );

    // Create nested skills in skills/ directory
    mkdirSync(join(testDir, 'skills', 'nested-skill-1'), { recursive: true });
    writeFileSync(
      join(testDir, 'skills', 'nested-skill-1', 'SKILL.md'),
      `---
name: nested-skill-1
description: Nested skill 1
---

# Nested Skill 1
`
    );

    mkdirSync(join(testDir, 'skills', 'nested-skill-2'), { recursive: true });
    writeFileSync(
      join(testDir, 'skills', 'nested-skill-2', 'SKILL.md'),
      `---
name: nested-skill-2
description: Nested skill 2
---

# Nested Skill 2
`
    );

    const skills = await discoverSkills(testDir, undefined, { fullDepth: true });

    expect(skills).toHaveLength(3);
    const names = skills.map((s) => s.name).sort();
    expect(names).toEqual(['nested-skill-1', 'nested-skill-2', 'root-skill']);
  });

  it('should default to early return (fullDepth: false behavior) when no option is provided', async () => {
    // Create root SKILL.md
    writeFileSync(
      join(testDir, 'SKILL.md'),
      `---
name: root-skill
description: Root level skill
---

# Root Skill
`
    );

    // Create nested skill
    mkdirSync(join(testDir, 'skills', 'nested-skill'), { recursive: true });
    writeFileSync(
      join(testDir, 'skills', 'nested-skill', 'SKILL.md'),
      `---
name: nested-skill
description: Nested skill
---

# Nested Skill
`
    );

    // No options passed - should default to early return
    const skills = await discoverSkills(testDir);

    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe('root-skill');
  });

  it('should still find all skills when no root SKILL.md exists (regardless of fullDepth)', async () => {
    // No root SKILL.md, just nested skills

    mkdirSync(join(testDir, 'skills', 'skill-1'), { recursive: true });
    writeFileSync(
      join(testDir, 'skills', 'skill-1', 'SKILL.md'),
      `---
name: skill-1
description: Skill 1
---

# Skill 1
`
    );

    mkdirSync(join(testDir, 'skills', 'skill-2'), { recursive: true });
    writeFileSync(
      join(testDir, 'skills', 'skill-2', 'SKILL.md'),
      `---
name: skill-2
description: Skill 2
---

# Skill 2
`
    );

    // Without fullDepth
    const skillsDefault = await discoverSkills(testDir);
    expect(skillsDefault).toHaveLength(2);

    // With fullDepth
    const skillsFullDepth = await discoverSkills(testDir, undefined, { fullDepth: true });
    expect(skillsFullDepth).toHaveLength(2);
  });

  it('should not duplicate skills when root and nested have the same name', async () => {
    // Edge case: root SKILL.md and a nested skill with the same name
    writeFileSync(
      join(testDir, 'SKILL.md'),
      `---
name: my-skill
description: Root level skill
---

# Root Skill
`
    );

    // Create nested skill with same name
    mkdirSync(join(testDir, 'skills', 'my-skill'), { recursive: true });
    writeFileSync(
      join(testDir, 'skills', 'my-skill', 'SKILL.md'),
      `---
name: my-skill
description: Nested skill with same name
---

# Nested Skill
`
    );

    const skills = await discoverSkills(testDir, undefined, { fullDepth: true });

    // Should only have one skill (deduplication by name)
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe('my-skill');
  });
});
