/**
 * Tests for discovering skills declared in plugin manifests.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { discoverSkills } from '../src/skills.ts';

describe('discoverSkills with plugin manifests', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `skills-manifest-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('should discover skills from marketplace.json', async () => {
    // Create marketplace.json
    mkdirSync(join(testDir, '.claude-plugin'), { recursive: true });
    writeFileSync(
      join(testDir, '.claude-plugin/marketplace.json'),
      JSON.stringify({
        name: 'test-marketplace',
        owner: { name: 'Test' },
        plugins: [
          {
            name: 'test-plugin',
            source: './plugins/test-plugin',
            skills: ['./skills/test-skill'],
          },
        ],
      })
    );

    // Create the skill
    mkdirSync(join(testDir, 'plugins/test-plugin/skills/test-skill'), { recursive: true });
    writeFileSync(
      join(testDir, 'plugins/test-plugin/skills/test-skill/SKILL.md'),
      `---
name: manifest-skill
description: Skill discovered via manifest
---
# Test
`
    );

    const skills = await discoverSkills(testDir);
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe('manifest-skill');
  });

  it('should respect metadata.pluginRoot', async () => {
    mkdirSync(join(testDir, '.claude-plugin'), { recursive: true });
    writeFileSync(
      join(testDir, '.claude-plugin/marketplace.json'),
      JSON.stringify({
        metadata: { pluginRoot: './plugins' },
        plugins: [
          {
            name: 'my-plugin',
            source: 'my-plugin', // Relative to pluginRoot
            skills: ['./skills/my-skill'],
          },
        ],
      })
    );

    mkdirSync(join(testDir, 'plugins/my-plugin/skills/my-skill'), { recursive: true });
    writeFileSync(
      join(testDir, 'plugins/my-plugin/skills/my-skill/SKILL.md'),
      `---
name: pluginroot-skill
description: Test
---
`
    );

    const skills = await discoverSkills(testDir);
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe('pluginroot-skill');
  });

  it('should discover skills from plugin.json', async () => {
    mkdirSync(join(testDir, '.claude-plugin'), { recursive: true });
    writeFileSync(
      join(testDir, '.claude-plugin/plugin.json'),
      JSON.stringify({
        name: 'single-plugin',
        skills: ['./skills/single-skill'],
      })
    );

    mkdirSync(join(testDir, 'skills/single-skill'), { recursive: true });
    writeFileSync(
      join(testDir, 'skills/single-skill/SKILL.md'),
      `---
name: single-plugin-skill
description: Test
---
`
    );

    const skills = await discoverSkills(testDir);
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe('single-plugin-skill');
  });

  it('should skip remote source objects', async () => {
    mkdirSync(join(testDir, '.claude-plugin'), { recursive: true });
    writeFileSync(
      join(testDir, '.claude-plugin/marketplace.json'),
      JSON.stringify({
        plugins: [
          {
            name: 'remote-plugin',
            source: { source: 'github', repo: 'owner/repo' },
            skills: ['./skills/remote-skill'],
          },
        ],
      })
    );

    const skills = await discoverSkills(testDir);
    expect(skills).toHaveLength(0);
  });

  it('should handle missing manifest gracefully', async () => {
    // No .claude-plugin directory
    const skills = await discoverSkills(testDir);
    expect(skills).toHaveLength(0);
  });

  it('should handle invalid JSON gracefully', async () => {
    mkdirSync(join(testDir, '.claude-plugin'), { recursive: true });
    writeFileSync(join(testDir, '.claude-plugin/marketplace.json'), 'not valid json');

    const skills = await discoverSkills(testDir);
    expect(skills).toHaveLength(0);
  });

  it('should deduplicate skills found via manifest and priority dirs', async () => {
    // Skill in both manifest path AND standard skills/ directory
    mkdirSync(join(testDir, '.claude-plugin'), { recursive: true });
    writeFileSync(
      join(testDir, '.claude-plugin/plugin.json'),
      JSON.stringify({ skills: ['./skills/dupe-skill'] })
    );

    mkdirSync(join(testDir, 'skills/dupe-skill'), { recursive: true });
    writeFileSync(
      join(testDir, 'skills/dupe-skill/SKILL.md'),
      `---
name: dupe-skill
description: Test
---
`
    );

    const skills = await discoverSkills(testDir);
    expect(skills).toHaveLength(1);
  });

  it('should discover multiple skills from multiple plugins', async () => {
    mkdirSync(join(testDir, '.claude-plugin'), { recursive: true });
    writeFileSync(
      join(testDir, '.claude-plugin/marketplace.json'),
      JSON.stringify({
        plugins: [
          {
            name: 'plugin-a',
            source: './plugin-a',
            skills: ['./skills/skill-1', './skills/skill-2'],
          },
          {
            name: 'plugin-b',
            source: './plugin-b',
            skills: ['./skills/skill-3'],
          },
        ],
      })
    );

    // Create skills for plugin-a
    mkdirSync(join(testDir, 'plugin-a/skills/skill-1'), { recursive: true });
    writeFileSync(
      join(testDir, 'plugin-a/skills/skill-1/SKILL.md'),
      `---
name: skill-1
description: Test
---
`
    );
    mkdirSync(join(testDir, 'plugin-a/skills/skill-2'), { recursive: true });
    writeFileSync(
      join(testDir, 'plugin-a/skills/skill-2/SKILL.md'),
      `---
name: skill-2
description: Test
---
`
    );

    // Create skill for plugin-b
    mkdirSync(join(testDir, 'plugin-b/skills/skill-3'), { recursive: true });
    writeFileSync(
      join(testDir, 'plugin-b/skills/skill-3/SKILL.md'),
      `---
name: skill-3
description: Test
---
`
    );

    const skills = await discoverSkills(testDir);
    expect(skills).toHaveLength(3);
    const names = skills.map((s) => s.name).sort();
    expect(names).toEqual(['skill-1', 'skill-2', 'skill-3']);
  });

  it('should handle plugin without source (root-level plugin)', async () => {
    mkdirSync(join(testDir, '.claude-plugin'), { recursive: true });
    writeFileSync(
      join(testDir, '.claude-plugin/marketplace.json'),
      JSON.stringify({
        plugins: [
          {
            name: 'root-plugin',
            // No source - plugin is at root
            skills: ['./skills/root-skill'],
          },
        ],
      })
    );

    mkdirSync(join(testDir, 'skills/root-skill'), { recursive: true });
    writeFileSync(
      join(testDir, 'skills/root-skill/SKILL.md'),
      `---
name: root-skill
description: Test
---
`
    );

    const skills = await discoverSkills(testDir);
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe('root-skill');
  });

  it('should discover skills from adjacent skills/ when plugin.json has no skills array', async () => {
    // plugin.json exists but doesn't declare skills
    mkdirSync(join(testDir, '.claude-plugin'), { recursive: true });
    writeFileSync(
      join(testDir, '.claude-plugin/plugin.json'),
      JSON.stringify({
        name: 'plugin-without-skills-field',
        description: 'A plugin that does not declare skills explicitly',
      })
    );

    // Skills exist in conventional location
    mkdirSync(join(testDir, 'skills/undeclared-skill'), { recursive: true });
    writeFileSync(
      join(testDir, 'skills/undeclared-skill/SKILL.md'),
      `---
name: undeclared-skill
description: Discovered from conventional skills/ directory
---
`
    );

    const skills = await discoverSkills(testDir);
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe('undeclared-skill');
  });

  it('should discover skills from adjacent skills/ when plugin.json has empty skills array', async () => {
    mkdirSync(join(testDir, '.claude-plugin'), { recursive: true });
    writeFileSync(
      join(testDir, '.claude-plugin/plugin.json'),
      JSON.stringify({
        name: 'plugin-with-empty-skills',
        skills: [], // Empty array
      })
    );

    mkdirSync(join(testDir, 'skills/empty-array-skill'), { recursive: true });
    writeFileSync(
      join(testDir, 'skills/empty-array-skill/SKILL.md'),
      `---
name: empty-array-skill
description: Test
---
`
    );

    const skills = await discoverSkills(testDir);
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe('empty-array-skill');
  });

  it('should discover skills from marketplace plugin without skills array', async () => {
    mkdirSync(join(testDir, '.claude-plugin'), { recursive: true });
    writeFileSync(
      join(testDir, '.claude-plugin/marketplace.json'),
      JSON.stringify({
        plugins: [
          {
            name: 'plugin-no-skills-field',
            source: './my-plugin',
            // No skills field - should discover from my-plugin/skills/
          },
        ],
      })
    );

    mkdirSync(join(testDir, 'my-plugin/skills/auto-discovered'), { recursive: true });
    writeFileSync(
      join(testDir, 'my-plugin/skills/auto-discovered/SKILL.md'),
      `---
name: auto-discovered
description: Found via conventional skills/ in plugin
---
`
    );

    const skills = await discoverSkills(testDir);
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe('auto-discovered');
  });

  it('should discover both explicit and conventional skills from same plugin', async () => {
    mkdirSync(join(testDir, '.claude-plugin'), { recursive: true });
    writeFileSync(
      join(testDir, '.claude-plugin/marketplace.json'),
      JSON.stringify({
        plugins: [
          {
            name: 'mixed-plugin',
            source: './mixed',
            skills: ['./custom-skills/explicit-skill'], // Explicit path
          },
        ],
      })
    );

    // Explicit skill in custom location
    mkdirSync(join(testDir, 'mixed/custom-skills/explicit-skill'), { recursive: true });
    writeFileSync(
      join(testDir, 'mixed/custom-skills/explicit-skill/SKILL.md'),
      `---
name: explicit-skill
description: Explicitly declared
---
`
    );

    // Conventional skill in skills/
    mkdirSync(join(testDir, 'mixed/skills/conventional-skill'), { recursive: true });
    writeFileSync(
      join(testDir, 'mixed/skills/conventional-skill/SKILL.md'),
      `---
name: conventional-skill
description: Found via convention
---
`
    );

    const skills = await discoverSkills(testDir);
    expect(skills).toHaveLength(2);
    const names = skills.map((s) => s.name).sort();
    expect(names).toEqual(['conventional-skill', 'explicit-skill']);
  });
});
