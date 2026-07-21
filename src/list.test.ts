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

    it('should parse -c flag with category', () => {
      const options = parseListOptions(['-c', 'testing']);
      expect(options.category).toBe('testing');
    });

    it('should parse --category flag with space-separated value', () => {
      const options = parseListOptions(['--category', 'pm']);
      expect(options.category).toBe('pm');
    });

    it('should parse --category=value form', () => {
      const options = parseListOptions(['--category=code']);
      expect(options.category).toBe('code');
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

  describe('category filter', () => {
    function writeSkill(dir: string, name: string, category?: string): void {
      const skillDir = join(dir, '.agents', 'skills', name);
      mkdirSync(skillDir, { recursive: true });
      const metadata = category ? `metadata:\n  category: ${category}\n` : '';
      writeFileSync(
        join(skillDir, 'SKILL.md'),
        `---\nname: ${name}\ndescription: ${name} description\n${metadata}---\n# ${name}\n`
      );
    }

    it('groups output by category when categories are present', () => {
      writeSkill(testDir, 'alpha-skill', 'testing');
      writeSkill(testDir, 'beta-skill', 'code');
      writeSkill(testDir, 'gamma-skill', 'testing');

      const result = runCli(['list'], testDir);
      expect(result.exitCode).toBe(0);
      // Both category headers should appear
      expect(result.stdout).toContain('testing');
      expect(result.stdout).toContain('code');
      // Skills should appear under their category headers (code sorts before testing)
      const codeIdx = result.stdout.indexOf('code');
      const testingIdx = result.stdout.indexOf('testing');
      expect(codeIdx).toBeGreaterThan(-1);
      expect(testingIdx).toBeGreaterThan(codeIdx);
    });

    it('puts skills without a category under Uncategorized', () => {
      writeSkill(testDir, 'tagged', 'testing');
      writeSkill(testDir, 'untagged');

      const result = runCli(['list'], testDir);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Uncategorized');
      // Uncategorized should appear after categorized header
      const testingIdx = result.stdout.indexOf('testing');
      const uncatIdx = result.stdout.indexOf('Uncategorized');
      expect(testingIdx).toBeGreaterThan(-1);
      expect(uncatIdx).toBeGreaterThan(testingIdx);
    });

    it('filters by --category (only matching skills shown)', () => {
      writeSkill(testDir, 'alpha-skill', 'testing');
      writeSkill(testDir, 'beta-skill', 'code');

      const result = runCli(['list', '--category', 'testing'], testDir);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('alpha-skill');
      expect(result.stdout).not.toContain('beta-skill');
    });

    it('filters by -c alias', () => {
      writeSkill(testDir, 'alpha-skill', 'testing');
      writeSkill(testDir, 'beta-skill', 'code');

      const result = runCli(['list', '-c', 'code'], testDir);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('beta-skill');
      expect(result.stdout).not.toContain('alpha-skill');
    });

    it('category match is case-insensitive', () => {
      writeSkill(testDir, 'alpha-skill', 'testing');
      const result = runCli(['list', '--category', 'TESTING'], testDir);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('alpha-skill');
    });

    it('reports available categories when filter has no match', () => {
      writeSkill(testDir, 'alpha-skill', 'testing');
      writeSkill(testDir, 'beta-skill', 'code');

      const result = runCli(['list', '--category', 'docs'], testDir);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('No project skills found in category "docs"');
      expect(result.stdout).toContain('Available categories:');
      expect(result.stdout).toContain('code');
      expect(result.stdout).toContain('testing');
    });

    it('includes category in --json output', () => {
      writeSkill(testDir, 'alpha-skill', 'testing');
      writeSkill(testDir, 'untagged');

      const result = runCli(['list', '--json'], testDir);
      expect(result.exitCode).toBe(0);
      const parsed = JSON.parse(result.stdout.trim());
      const alpha = parsed.find((s: any) => s.name === 'alpha-skill');
      const untagged = parsed.find((s: any) => s.name === 'untagged');
      expect(alpha.category).toBe('testing');
      expect(untagged.category).toBeNull();
    });

    it('--json + --category filters and includes category', () => {
      writeSkill(testDir, 'alpha-skill', 'testing');
      writeSkill(testDir, 'beta-skill', 'code');

      const result = runCli(['list', '--json', '--category', 'testing'], testDir);
      expect(result.exitCode).toBe(0);
      const parsed = JSON.parse(result.stdout.trim());
      expect(parsed.length).toBe(1);
      expect(parsed[0].name).toBe('alpha-skill');
      expect(parsed[0].category).toBe('testing');
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
      expect(result.stdout).toContain('-c, --category');
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
