import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { parseLinkOptions } from './link.ts';
import { runCli } from './test-utils.ts';

describe('link command', () => {
  let testDir: string;
  let homeDir: string;
  let env: Record<string, string>;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'skills-link-test-'));
    homeDir = join(testDir, 'home');
    mkdirSync(homeDir, { recursive: true });
    env = {
      HOME: homeDir,
      USERPROFILE: homeDir,
      LOCALAPPDATA: join(homeDir, 'AppData', 'Local'),
      APPDATA: join(homeDir, 'AppData', 'Roaming'),
    };
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  function createGlobalSkill(name: string, description?: string) {
    const skillDir = join(homeDir, '.agents', 'skills', name);
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      `---
name: ${name}
description: ${description || `A test skill called ${name}`}
---

# ${name}

This is a test skill.
`
    );
  }

  describe('parseLinkOptions', () => {
    it('should parse positional skill names', () => {
      const { skills, options } = parseLinkOptions(['skill-one', 'skill-two']);
      expect(skills).toEqual(['skill-one', 'skill-two']);
      expect(options).toEqual({});
    });

    it('should parse skill and agent flags', () => {
      const { skills, options } = parseLinkOptions([
        '--skill',
        'skill-one',
        '--agent',
        'claude-code',
        'cursor',
        '-y',
      ]);
      expect(skills).toEqual(['skill-one']);
      expect(options.skill).toEqual(['skill-one']);
      expect(options.agent).toEqual(['claude-code', 'cursor']);
      expect(options.yes).toBe(true);
    });

    it('should parse --all flag', () => {
      const { skills, options } = parseLinkOptions(['--all', '-a', 'claude-code']);
      expect(skills).toEqual([]);
      expect(options.all).toBe(true);
      expect(options.agent).toEqual(['claude-code']);
    });
  });

  describe('CLI integration', () => {
    it('should show message when no global skills found', () => {
      const result = runCli(['link', '--all', '-a', 'claude-code', '-y'], testDir, env);
      expect(result.stdout).toContain('No global skills found');
      expect(result.exitCode).toBe(0);
    });

    it('should show error for invalid agent name', () => {
      createGlobalSkill('test-skill');

      const result = runCli(['link', 'test-skill', '--agent', 'invalid-agent', '-y'], testDir, env);

      expect(result.stdout).toContain('Invalid agents');
      expect(result.stdout).toContain('invalid-agent');
      expect(result.exitCode).toBe(1);
    });

    it('should link a specific global skill to an agent-specific global directory', () => {
      createGlobalSkill('test-skill');

      const result = runCli(['link', 'test-skill', '-a', 'claude-code', '-y'], testDir, env);

      expect(result.stdout).toContain('Successfully linked');
      expect(result.stdout).toContain('test-skill');
      expect(result.exitCode).toBe(0);

      const linkedSkillPath = join(homeDir, '.claude', 'skills', 'test-skill', 'SKILL.md');
      expect(existsSync(linkedSkillPath)).toBe(true);
      expect(readFileSync(linkedSkillPath, 'utf-8')).toContain('name: test-skill');
    });

    it('should link all global skills with --all', () => {
      createGlobalSkill('skill-one');
      createGlobalSkill('skill-two');

      const result = runCli(['link', '--all', '-a', 'claude-code', '-y'], testDir, env);

      expect(result.stdout).toContain('Successfully linked');
      expect(result.stdout).toContain('2 skill');
      expect(result.exitCode).toBe(0);

      expect(existsSync(join(homeDir, '.claude', 'skills', 'skill-one', 'SKILL.md'))).toBe(true);
      expect(existsSync(join(homeDir, '.claude', 'skills', 'skill-two', 'SKILL.md'))).toBe(true);
    });

    it('should match skill names case-insensitively', () => {
      createGlobalSkill('test-skill');

      const result = runCli(['link', 'TEST-SKILL', '-a', 'claude-code', '-y'], testDir, env);

      expect(result.stdout).toContain('Successfully linked');
      expect(result.exitCode).toBe(0);
      expect(existsSync(join(homeDir, '.claude', 'skills', 'test-skill', 'SKILL.md'))).toBe(true);
    });

    it('should warn about unmatched skills while linking matched skills', () => {
      createGlobalSkill('skill-one');

      const result = runCli(
        ['link', 'skill-one', 'missing-skill', '-a', 'claude-code', '-y'],
        testDir,
        env
      );

      expect(result.stdout).toContain('Global skills not found');
      expect(result.stdout).toContain('missing-skill');
      expect(result.stdout).toContain('Successfully linked 1 link(s) for 1 skill(s)');
      expect(result.exitCode).toBe(0);
      expect(existsSync(join(homeDir, '.claude', 'skills', 'skill-one', 'SKILL.md'))).toBe(true);
    });

    it('should report successful link count separately from skill count', () => {
      createGlobalSkill('test-skill');

      const result = runCli(
        ['link', 'test-skill', '-a', 'claude-code', 'continue', '-y'],
        testDir,
        env
      );

      expect(result.stdout).toContain('Successfully linked 2 link(s) for 1 skill(s)');
      expect(result.exitCode).toBe(0);
      expect(existsSync(join(homeDir, '.claude', 'skills', 'test-skill', 'SKILL.md'))).toBe(true);
      expect(existsSync(join(homeDir, '.continue', 'skills', 'test-skill', 'SKILL.md'))).toBe(true);
    });
  });
});
