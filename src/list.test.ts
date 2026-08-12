import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
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

  function createTestSkill(root: string, name: string, description: string): string {
    const skillDir = join(root, '.agents', 'skills', name);
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      `---
name: ${name}
description: ${description}
---
# ${name}
`
    );
    return skillDir;
  }

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
      createTestSkill(testDir, 'json-skill', 'A skill for JSON testing');

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

    it('should report project skill provenance from skills-lock.json', () => {
      createTestSkill(testDir, 'project-skill', 'A tracked project skill');
      writeFileSync(
        join(testDir, 'skills-lock.json'),
        JSON.stringify({
          version: 1,
          skills: {
            'project-skill': {
              source: 'owner/project-skills',
              sourceUrl: 'https://github.com/owner/project-skills',
              sourceType: 'github',
              computedHash: 'project-hash',
            },
          },
        })
      );

      const result = runCli(['list', '--json'], testDir);
      const [skill] = JSON.parse(result.stdout.trim());

      expect(skill).toMatchObject({
        source: 'owner/project-skills',
        sourceUrl: 'https://github.com/owner/project-skills',
        sourceType: 'github',
      });
      expect(skill).not.toHaveProperty('origin');
    });

    it('should output multiple skills as JSON array', () => {
      createTestSkill(testDir, 'skill-alpha', 'Alpha');
      createTestSkill(testDir, 'skill-beta', 'Beta');

      const result = runCli(['list', '--json'], testDir);
      expect(result.exitCode).toBe(0);
      const parsed = JSON.parse(result.stdout.trim());
      expect(parsed.length).toBe(2);
      const names = parsed.map((s: any) => s.name);
      expect(names).toContain('skill-alpha');
      expect(names).toContain('skill-beta');
    });

    it('should show message when no project skills found', () => {
      const result = runCli(['list'], testDir);
      expect(result.stdout).toContain('No project skills found');
      expect(result.stdout).toContain('Try listing global skills with -g');
      expect(result.exitCode).toBe(0);
    });

    it('should list project skills', () => {
      createTestSkill(testDir, 'test-skill', 'A test skill for listing');

      const result = runCli(['list'], testDir);
      expect(result.stdout).toContain('test-skill');
      expect(result.stdout).toContain('Project Skills');
      // Description should not be shown
      expect(result.stdout).not.toContain('A test skill for listing');
      expect(result.exitCode).toBe(0);
    });

    it('should show a tracked project skill source in human output', () => {
      createTestSkill(testDir, 'tracked-skill', 'A tracked project skill');
      writeFileSync(
        join(testDir, 'skills-lock.json'),
        JSON.stringify({
          version: 1,
          skills: {
            'tracked-skill': {
              source: 'owner/project-skills',
              sourceType: 'github',
              computedHash: 'project-hash',
            },
          },
        })
      );

      const result = runCli(['list'], testDir);

      expect(result.stdout).toContain('Source:');
      expect(result.stdout).toContain('owner/project-skills');
      expect(result.stdout).not.toContain('Origin:');
    });

    it('should keep untrusted source metadata on one output line', () => {
      createTestSkill(testDir, 'tracked-skill', 'A tracked project skill');
      writeFileSync(
        join(testDir, 'skills-lock.json'),
        JSON.stringify({
          version: 1,
          skills: {
            'tracked-skill': {
              source: 'owner/\nFORGED',
              sourceType: 'github',
              computedHash: 'project-hash',
            },
          },
        })
      );

      const result = runCli(['list'], testDir);

      expect(result.stdout).toContain('Source: owner/ FORGED');
      expect(result.stdout).not.toContain('\nFORGED');
    });

    it('should list multiple skills', () => {
      createTestSkill(testDir, 'skill-one', 'First skill');
      createTestSkill(testDir, 'skill-two', 'Second skill');

      const result = runCli(['list'], testDir);
      expect(result.stdout).toContain('skill-one');
      expect(result.stdout).toContain('skill-two');
      expect(result.stdout).toContain('Project Skills');
      expect(result.exitCode).toBe(0);
    });

    it('should respect -g flag for global only', () => {
      createTestSkill(testDir, 'project-skill', 'A project skill');

      const testHome = join(testDir, 'home');
      createTestSkill(testHome, 'global-skill', 'A global skill');

      const result = runCli(['list', '-g'], testDir, { HOME: testHome });
      // Should not show project skill when -g is specified
      expect(result.stdout).not.toContain('project-skill');
      expect(result.stdout).toContain('global-skill');
      expect(result.stdout).toContain('Global Skills');
    });

    it('should report global provenance when a lock key differs from its folder name', () => {
      const testHome = join(testDir, 'home');
      createTestSkill(testHome, 'ce-review', 'A tracked global plugin skill');
      const lockDir = join(testHome, '.local', 'state', 'skills');
      mkdirSync(lockDir, { recursive: true });
      writeFileSync(
        join(lockDir, '.skill-lock.json'),
        JSON.stringify({
          version: 3,
          skills: {
            'ce:review': {
              source: 'everyinc/compound-engineering-plugin',
              sourceUrl: 'https://github.com/everyinc/compound-engineering-plugin',
              sourceType: 'github',
              skillFolderHash: 'global-hash',
              installedAt: '2026-07-01T00:00:00.000Z',
              updatedAt: '2026-07-01T00:00:00.000Z',
            },
          },
        })
      );

      const result = runCli(['list', '-g', '--json'], testDir, { HOME: testHome });
      const [skill] = JSON.parse(result.stdout.trim());

      expect(skill).toMatchObject({
        name: 'ce-review',
        source: 'everyinc/compound-engineering-plugin',
        sourceUrl: 'https://github.com/everyinc/compound-engineering-plugin',
        sourceType: 'github',
      });
    });

    it('should show error for invalid agent filter', () => {
      const result = runCli(['list', '-a', 'invalid-agent'], testDir);
      expect(result.stdout).toContain('Invalid agents');
      expect(result.stdout).toContain('invalid-agent');
      expect(result.exitCode).toBe(1);
    });

    it('should filter by valid agent', () => {
      createTestSkill(testDir, 'test-skill', 'A test skill');

      const result = runCli(['list', '-a', 'claude-code'], testDir);
      expect(result.stdout).toContain('test-skill');
      expect(result.exitCode).toBe(0);
    });

    it('should ignore directories without SKILL.md', () => {
      createTestSkill(testDir, 'valid-skill', 'Valid skill');

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
      createTestSkill(testDir, 'valid-skill', 'Valid skill');

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
      createTestSkill(testDir, 'test-skill', 'A test skill');

      const result = runCli(['list'], testDir);
      // Path is shown inline with skill name (handles both Unix / and Windows \)
      expect(result.stdout).toMatch(/\.agents[/\\]skills[/\\]test-skill/);
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
    });

    it('should include list examples in help', () => {
      const result = runCli(['--help']);
      expect(result.stdout).toContain('skills list');
      expect(result.stdout).toContain('skills ls -g');
      expect(result.stdout).toContain('skills ls -a claude-code');
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
