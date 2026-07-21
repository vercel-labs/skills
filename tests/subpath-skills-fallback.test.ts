/**
 * Tests for the skills/<subpath> fallback in discoverSkills.
 *
 * Community convention: repos named "skills" often store individual skills
 * under a skills/<name>/ subdirectory. When a user runs:
 *   npx skills add repo/skills/ui-design
 * the subpath "ui-design" may not exist at the repo root, but exists under
 * skills/ui-design. This fallback resolves that transparently.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { discoverSkills } from '../src/skills.ts';

const SKILL_MD = (name: string) => `---
name: ${name}
description: Test skill ${name}
---

# ${name}
`;

describe('discoverSkills subpath fallback (community convention)', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `skills-subpath-fallback-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('uses exact subpath when it exists', async () => {
    mkdirSync(join(testDir, 'ui-design'), { recursive: true });
    writeFileSync(join(testDir, 'ui-design', 'SKILL.md'), SKILL_MD('ui-design'));

    const skills = await discoverSkills(testDir, 'ui-design');

    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe('ui-design');
  });

  it('falls back to skills/<subpath> when exact subpath does not exist', async () => {
    mkdirSync(join(testDir, 'skills', 'ui-design'), { recursive: true });
    writeFileSync(join(testDir, 'skills', 'ui-design', 'SKILL.md'), SKILL_MD('ui-design'));

    const skills = await discoverSkills(testDir, 'ui-design');

    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe('ui-design');
  });

  it('prefers exact subpath over skills/<subpath> when both exist', async () => {
    mkdirSync(join(testDir, 'ui-design'), { recursive: true });
    writeFileSync(join(testDir, 'ui-design', 'SKILL.md'), SKILL_MD('ui-design-direct'));

    mkdirSync(join(testDir, 'skills', 'ui-design'), { recursive: true });
    writeFileSync(
      join(testDir, 'skills', 'ui-design', 'SKILL.md'),
      SKILL_MD('ui-design-in-skills')
    );

    const skills = await discoverSkills(testDir, 'ui-design');

    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe('ui-design-direct');
  });

  it('returns empty when neither exact nor skills/<subpath> exists', async () => {
    const skills = await discoverSkills(testDir, 'nonexistent');

    expect(skills).toHaveLength(0);
  });

  it('does not double-prefix when subpath already starts with skills/', async () => {
    mkdirSync(join(testDir, 'skills', 'ui-design'), { recursive: true });
    writeFileSync(join(testDir, 'skills', 'ui-design', 'SKILL.md'), SKILL_MD('ui-design'));

    const skills = await discoverSkills(testDir, 'skills/ui-design');

    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe('ui-design');
  });
});
