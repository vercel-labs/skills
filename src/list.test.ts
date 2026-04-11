import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir, homedir } from 'os';
import { runCli } from './test-utils.ts';
import { parseListOptions } from './list.ts';

describe('list command', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `skills-list-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('parseListOptions', () => {
    it('should parse empty args', () => {
      const options = parseListOptions([]);
      expect(options).toEqual({});
    });

    it('should parse -g flag', () => {
      const options = parseListOptions(['-g']);
      expect(options.global).toBe(true);
    });

    it('should parse --global flag', () => {
      const options = parseListOptions(['--global']);
      expect(options.global).toBe(true);
    });

    it('should parse -a flag with single agent', () => {
      const options = parseListOptions(['-a', 'claude-code']);
      expect(options.agent).toEqual(['claude-code']);
    });

    it('should parse --agent flag with single agent', () => {
      const options = parseListOptions(['--agent', 'cursor']);
      expect(options.agent).toEqual(['cursor']);
    });

    it('should parse -a flag with multiple agents', () => {
      const options = parseListOptions(['-a', 'claude-code', 'cursor', 'codex']);
      expect(options.agent).toEqual(['claude-code', 'cursor', 'codex']);
    });

    it('should parse combined flags', () => {
      const options = parseListOptions(['-g', '-a', 'claude-code', 'cursor']);
      expect(options.global).toBe(true);
      expect(options.agent).toEqual(['claude-code', 'cursor']);
    });

    it('should parse --json flag', () => {
      const options = parseListOptions(['--json']);
      expect(options.json).toBe(true);
    });

    it('should parse --groups flag', () => {
      const options = parseListOptions(['--groups']);
      expect(options.groups).toBe(true);
    });

    it('should parse combined --json and -g flags', () => {
      const options = parseListOptions(['-g', '--json']);
      expect(options.global).toBe(true);
      expect(options.json).toBe(true);
    });

    it('should stop collecting agents at next flag', () => {
      const options = parseListOptions(['-a', 'claude-code', '-g']);
      expect(options.agent).toEqual(['claude-code']);
      expect(options.global).toBe(true);
    });
  });

  describe('CLI integration', () => {
    it('should run list command', () => {
      const result = runCli(['list'], testDir);
      // Empty project dir shows "No project skills found"
      expect(result.stdout).toContain('No project skills found');
      expect(result.exitCode).toBe(0);
    });

    it('should run ls alias', () => {
      const result = runCli(['ls'], testDir);
      expect(result.stdout).toContain('No project skills found');
      expect(result.exitCode).toBe(0);
    });

    it('should output empty JSON array when no skills', () => {
      const result = runCli(['list', '--json'], testDir);
      expect(result.exitCode).toBe(0);
      const parsed = JSON.parse(result.stdout.trim());
      expect(parsed).toEqual([]);
    });

    it('should output valid JSON with --json flag', () => {
      const skillDir = join(testDir, '.agents', 'skills', 'json-skill');
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(
        join(skillDir, 'SKILL.md'),
        `---
name: json-skill
description: A skill for JSON testing
---

# JSON Skill
`
      );

      const result = runCli(['list', '--json'], testDir);
      expect(result.exitCode).toBe(0);
      const parsed = JSON.parse(result.stdout.trim());
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed.length).toBe(1);
      expect(parsed[0].name).toBe('json-skill');
      expect(parsed[0].path).toContain('json-skill');
      expect(parsed[0].scope).toBe('project');
      expect(Array.isArray(parsed[0].agents)).toBe(true);
      // No ANSI codes in JSON output
      expect(result.stdout).not.toMatch(/\x1b\[/);
    });

    it('should output multiple skills as JSON array', () => {
      const skill1Dir = join(testDir, '.agents', 'skills', 'skill-alpha');
      const skill2Dir = join(testDir, '.agents', 'skills', 'skill-beta');
      mkdirSync(skill1Dir, { recursive: true });
      mkdirSync(skill2Dir, { recursive: true });

      writeFileSync(
        join(skill1Dir, 'SKILL.md'),
        `---\nname: skill-alpha\ndescription: Alpha\n---\n# Alpha\n`
      );
      writeFileSync(
        join(skill2Dir, 'SKILL.md'),
        `---\nname: skill-beta\ndescription: Beta\n---\n# Beta\n`
      );

      const result = runCli(['list', '--json'], testDir);
      expect(result.exitCode).toBe(0);
      const parsed = JSON.parse(result.stdout.trim());
      expect(parsed.length).toBe(2);
      const names = parsed.map((s: any) => s.name);
      expect(names).toContain('skill-alpha');
      expect(names).toContain('skill-beta');
    });

    it('should include management-aware fields in JSON output', () => {
      const skillDir = join(testDir, '.agents', 'disabled_skills', 'managed-skill');
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(
        join(skillDir, 'SKILL.md'),
        `---
name: managed-skill
description: Managed skill
---
# Managed Skill
`
      );

      writeFileSync(
        join(testDir, 'skills-lock.json'),
        JSON.stringify(
          {
            version: 2,
            skills: {},
            management: {
              groups: {
                ai: ['managed-skill'],
                architecture: ['managed-skill'],
              },
              managerSkill: 'managed-skill',
            },
          },
          null,
          2
        )
      );

      const result = runCli(['list', '--json'], testDir);
      expect(result.exitCode).toBe(0);
      const parsed = JSON.parse(result.stdout.trim());
      expect(parsed).toEqual([
        expect.objectContaining({
          name: 'managed-skill',
          status: 'disabled',
          groups: ['ai', 'architecture'],
          isManager: true,
        }),
      ]);
    });

    it('should show message when no project skills found', () => {
      const result = runCli(['list'], testDir);
      expect(result.stdout).toContain('No project skills found');
      expect(result.stdout).toContain('Try listing global skills with -g');
      expect(result.exitCode).toBe(0);
    });

    it('should list project skills', () => {
      // Create a skill in the canonical location
      const skillDir = join(testDir, '.agents', 'skills', 'test-skill');
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(
        join(skillDir, 'SKILL.md'),
        `---
name: test-skill
description: A test skill for listing
---

# Test Skill

This is a test skill.
`
      );

      const result = runCli(['list'], testDir);
      expect(result.stdout).toContain('test-skill');
      expect(result.stdout).toContain('Project Skills');
      // Description should not be shown
      expect(result.stdout).not.toContain('A test skill for listing');
      expect(result.exitCode).toBe(0);
    });

    it('should list multiple skills', () => {
      // Create multiple skills
      const skill1Dir = join(testDir, '.agents', 'skills', 'skill-one');
      const skill2Dir = join(testDir, '.agents', 'skills', 'skill-two');
      mkdirSync(skill1Dir, { recursive: true });
      mkdirSync(skill2Dir, { recursive: true });

      writeFileSync(
        join(skill1Dir, 'SKILL.md'),
        `---
name: skill-one
description: First skill
---
# Skill One
`
      );

      writeFileSync(
        join(skill2Dir, 'SKILL.md'),
        `---
name: skill-two
description: Second skill
---
# Skill Two
`
      );

      const result = runCli(['list'], testDir);
      expect(result.stdout).toContain('skill-one');
      expect(result.stdout).toContain('skill-two');
      expect(result.stdout).toContain('Project Skills');
      expect(result.exitCode).toBe(0);
    });

    it('shows enabled and disabled skills with status prefixes', () => {
      const enabledDir = join(testDir, '.agents', 'skills', 'enabled-skill');
      const disabledDir = join(testDir, '.agents', 'disabled_skills', 'disabled-skill');
      mkdirSync(enabledDir, { recursive: true });
      mkdirSync(disabledDir, { recursive: true });

      writeFileSync(
        join(enabledDir, 'SKILL.md'),
        `---
name: enabled-skill
description: Enabled skill
---
# Enabled Skill
`
      );

      writeFileSync(
        join(disabledDir, 'SKILL.md'),
        `---
name: disabled-skill
description: Disabled skill
---
# Disabled Skill
`
      );

      const result = runCli(['list'], testDir);
      expect(result.stdout).toContain('[+] enabled-skill');
      expect(result.stdout).toContain('[-] disabled-skill');
      expect(result.stdout).toMatch(/disabled_skills[/\\]disabled-skill/);
      expect(result.exitCode).toBe(0);
    });

    it('should respect -g flag for global only', () => {
      // Create a project skill (should not be shown with -g)
      const skillDir = join(testDir, '.agents', 'skills', 'project-skill');
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(
        join(skillDir, 'SKILL.md'),
        `---
name: project-skill
description: A project skill
---
# Project Skill
`
      );

      const result = runCli(['list', '-g'], testDir);
      // Should not show project skill when -g is specified
      expect(result.stdout).not.toContain('project-skill');
      expect(result.stdout).toContain('Global Skills');
    });

    it('should show error for invalid agent filter', () => {
      const result = runCli(['list', '-a', 'invalid-agent'], testDir);
      expect(result.stdout).toContain('Invalid agents');
      expect(result.stdout).toContain('invalid-agent');
      expect(result.exitCode).toBe(1);
    });

    it('should filter by valid agent', () => {
      // Create a skill
      const skillDir = join(testDir, '.agents', 'skills', 'test-skill');
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(
        join(skillDir, 'SKILL.md'),
        `---
name: test-skill
description: A test skill
---
# Test Skill
`
      );

      const result = runCli(['list', '-a', 'claude-code'], testDir);
      expect(result.stdout).toContain('test-skill');
      expect(result.exitCode).toBe(0);
    });

    it('should ignore directories without SKILL.md', () => {
      // Create a valid skill
      const validDir = join(testDir, '.agents', 'skills', 'valid-skill');
      mkdirSync(validDir, { recursive: true });
      writeFileSync(
        join(validDir, 'SKILL.md'),
        `---
name: valid-skill
description: Valid skill
---
# Valid
`
      );

      // Create an invalid directory (no SKILL.md)
      const invalidDir = join(testDir, '.agents', 'skills', 'invalid-skill');
      mkdirSync(invalidDir, { recursive: true });
      writeFileSync(join(invalidDir, 'README.md'), '# Not a skill');

      const result = runCli(['list'], testDir);
      expect(result.stdout).toContain('valid-skill');
      expect(result.stdout).not.toContain('invalid-skill');
      expect(result.exitCode).toBe(0);
    });

    it('should handle SKILL.md with missing frontmatter', () => {
      // Create a valid skill
      const validDir = join(testDir, '.agents', 'skills', 'valid-skill');
      mkdirSync(validDir, { recursive: true });
      writeFileSync(
        join(validDir, 'SKILL.md'),
        `---
name: valid-skill
description: Valid skill
---
# Valid
`
      );

      // Create a skill with invalid SKILL.md (no frontmatter)
      const invalidDir = join(testDir, '.agents', 'skills', 'invalid-skill');
      mkdirSync(invalidDir, { recursive: true });
      writeFileSync(join(invalidDir, 'SKILL.md'), '# Invalid\nNo frontmatter here');

      const result = runCli(['list'], testDir);
      expect(result.stdout).toContain('valid-skill');
      expect(result.stdout).not.toContain('invalid-skill');
      expect(result.exitCode).toBe(0);
    });

    it('should show skill path', () => {
      const skillDir = join(testDir, '.agents', 'skills', 'test-skill');
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(
        join(skillDir, 'SKILL.md'),
        `---
name: test-skill
description: A test skill
---
# Test Skill
`
      );

      const result = runCli(['list'], testDir);
      // Path is shown inline with skill name (handles both Unix / and Windows \)
      expect(result.stdout).toMatch(/\.agents[/\\]skills[/\\]test-skill/);
    });

    it('should show groups with enabled counts and drift warnings', () => {
      const enabledDir = join(testDir, '.agents', 'skills', 'ai-skill');
      const disabledDir = join(testDir, '.agents', 'disabled_skills', 'disabled-skill');
      const ungroupedDir = join(testDir, '.agents', 'skills', 'ungrouped-skill');
      mkdirSync(enabledDir, { recursive: true });
      mkdirSync(disabledDir, { recursive: true });
      mkdirSync(ungroupedDir, { recursive: true });

      writeFileSync(
        join(enabledDir, 'SKILL.md'),
        `---
name: ai-skill
description: AI skill
---
# AI Skill
`
      );

      writeFileSync(
        join(disabledDir, 'SKILL.md'),
        `---
name: disabled-skill
description: Disabled skill
---
# Disabled Skill
`
      );

      writeFileSync(
        join(ungroupedDir, 'SKILL.md'),
        `---
name: ungrouped-skill
description: Ungrouped skill
---
# Ungrouped Skill
`
      );

      writeFileSync(
        join(testDir, 'skills-lock.json'),
        JSON.stringify(
          {
            version: 2,
            skills: {},
            management: {
              groups: {
                ai: ['ai-skill', 'missing-skill'],
                architecture: ['disabled-skill'],
                empty: [],
              },
              managerSkill: 'ungrouped-skill',
            },
          },
          null,
          2
        )
      );

      const result = runCli(['list', '--groups'], testDir);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('ai (1/2 enabled)');
      expect(result.stdout).toContain('[+] ai-skill');
      expect(result.stdout).toContain('[?] missing-skill (missing)');
      expect(result.stdout).toContain('architecture (0/1 enabled)');
      expect(result.stdout).toContain('[-] disabled-skill');
      expect(result.stdout).toContain('empty (0/0 enabled)');
      expect(result.stdout).toContain('UNGROUPED SKILLS (1/1 enabled)');
      expect(result.stdout).toContain('[+] ungrouped-skill');
      expect(result.stdout).toContain('skills remove missing-skill');
    });

    it('should output grouped JSON structure with management metadata', () => {
      const aiDir = join(testDir, '.agents', 'skills', 'ai-skill');
      const disabledDir = join(testDir, '.agents', 'disabled_skills', 'disabled-skill');
      const managerDir = join(testDir, '.agents', 'skills', 'ungrouped-skill');
      mkdirSync(aiDir, { recursive: true });
      mkdirSync(disabledDir, { recursive: true });
      mkdirSync(managerDir, { recursive: true });

      writeFileSync(
        join(aiDir, 'SKILL.md'),
        `---
name: ai-skill
description: AI skill
---
# AI Skill
`
      );

      writeFileSync(
        join(disabledDir, 'SKILL.md'),
        `---
name: disabled-skill
description: Disabled skill
---
# Disabled Skill
`
      );

      writeFileSync(
        join(managerDir, 'SKILL.md'),
        `---
name: ungrouped-skill
description: Ungrouped skill
---
# Ungrouped Skill
`
      );

      writeFileSync(
        join(testDir, 'skills-lock.json'),
        JSON.stringify(
          {
            version: 2,
            skills: {},
            management: {
              groups: {
                ai: ['ai-skill'],
                architecture: ['disabled-skill'],
              },
              managerSkill: 'ungrouped-skill',
            },
          },
          null,
          2
        )
      );

      const result = runCli(['list', '--groups', '--json'], testDir);
      expect(result.exitCode).toBe(0);
      const parsed = JSON.parse(result.stdout.trim());

      expect(parsed.groups.ai).toEqual([
        expect.objectContaining({
          name: 'ai-skill',
          status: 'enabled',
          groups: ['ai'],
          isManager: false,
        }),
      ]);
      expect(parsed.groups.architecture).toEqual([
        expect.objectContaining({
          name: 'disabled-skill',
          status: 'disabled',
          groups: ['architecture'],
          isManager: false,
        }),
      ]);
      expect(parsed.ungrouped).toEqual([
        expect.objectContaining({
          name: 'ungrouped-skill',
          status: 'enabled',
          groups: [],
          isManager: true,
        }),
      ]);
      expect(parsed.managerSkill).toBe('ungrouped-skill');
      expect(parsed.warnings).toEqual([]);
    });
  });

  describe('help output', () => {
    it('should include list command in help', () => {
      const result = runCli(['--help']);
      expect(result.stdout).toContain('list, ls');
      expect(result.stdout).toContain('List installed skills');
    });

    it('should include list options in help', () => {
      const result = runCli(['--help']);
      expect(result.stdout).toContain('List Options:');
      expect(result.stdout).toContain('-g, --global');
      expect(result.stdout).toContain('-a, --agent');
      expect(result.stdout).toContain('--groups');
    });

    it('should include list examples in help', () => {
      const result = runCli(['--help']);
      expect(result.stdout).toContain('skills list');
      expect(result.stdout).toContain('skills ls -g');
      expect(result.stdout).toContain('skills ls -a claude-code');
      expect(result.stdout).toContain('skills ls --groups');
    });
  });

  describe('banner', () => {
    it('should include list command in banner', () => {
      const result = runCli([]);
      expect(result.stdout).toContain('npx skills list');
      expect(result.stdout).toContain('List installed skills');
    });
  });
});
