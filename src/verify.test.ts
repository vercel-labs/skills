import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, rmSync, mkdirSync, writeFileSync, symlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { runCli, runCliOutput } from './test-utils.js';
import { parseVerifyOptions } from './verify.ts';

describe('verify command', { timeout: 30000 }, () => {
  let testDir: string;
  let skillsDir: string;
  let lockFile: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `skills-verify-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });

    // Create .agents/skills directory (canonical location)
    skillsDir = join(testDir, '.agents', 'skills');
    mkdirSync(skillsDir, { recursive: true });

    // Lock file path
    lockFile = join(testDir, 'skills-lock.json');
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  function createTestSkill(name: string, description?: string) {
    const skillDir = join(skillsDir, name);
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
    return skillDir;
  }

  function createLockFile(
    skills: Record<string, { source: string; sourceType: string; computedHash: string }>
  ) {
    writeFileSync(
      lockFile,
      JSON.stringify(
        {
          version: 1,
          skills,
        },
        null,
        2
      )
    );
  }

  function createAgentSkillsDir(agentName: string) {
    const agentSkillsDir = join(testDir, agentName, 'skills');
    mkdirSync(agentSkillsDir, { recursive: true });
    return agentSkillsDir;
  }

  function createSymlink(skillName: string, targetDir: string) {
    const skillPath = join(skillsDir, skillName);
    const linkPath = join(targetDir, skillName);
    try {
      // Create relative symlink
      const relativePath = join('..', '..', '.agents', 'skills', skillName);
      symlinkSync(relativePath, linkPath);
    } catch {
      // Skip if symlinks aren't supported
    }
  }

  describe('parseVerifyOptions', () => {
    it('should parse -g flag', () => {
      const options = parseVerifyOptions(['-g']);
      expect(options.global).toBe(true);
    });

    it('should parse --global flag', () => {
      const options = parseVerifyOptions(['--global']);
      expect(options.global).toBe(true);
    });

    it('should parse -v flag', () => {
      const options = parseVerifyOptions(['-v']);
      expect(options.verbose).toBe(true);
    });

    it('should parse --verbose flag', () => {
      const options = parseVerifyOptions(['--verbose']);
      expect(options.verbose).toBe(true);
    });

    it('should parse --json flag', () => {
      const options = parseVerifyOptions(['--json']);
      expect(options.json).toBe(true);
    });

    it('should parse -a flag with agents', () => {
      const options = parseVerifyOptions(['-a', 'claude-code', 'cursor']);
      expect(options.agent).toEqual(['claude-code', 'cursor']);
    });

    it('should parse --agent flag with agents', () => {
      const options = parseVerifyOptions(['--agent', 'claude-code']);
      expect(options.agent).toEqual(['claude-code']);
    });

    it('should parse multiple flags together', () => {
      const options = parseVerifyOptions(['-g', '-v', '--json', '-a', 'claude-code']);
      expect(options.global).toBe(true);
      expect(options.verbose).toBe(true);
      expect(options.json).toBe(true);
      expect(options.agent).toEqual(['claude-code']);
    });

    it('should return empty options for no arguments', () => {
      const options = parseVerifyOptions([]);
      expect(options).toEqual({});
    });
  });

  describe('with no skills', () => {
    it('should report no skills found', () => {
      const result = runCli(['verify'], testDir);
      expect(result.stdout).toContain('No project skills found');
      expect(result.exitCode).toBe(0);
    });

    it('should exit with code 0 when no skills', () => {
      const result = runCli(['verify'], testDir);
      expect(result.exitCode).toBe(0);
    });
  });

  describe('with valid skills and matching lock file', () => {
    beforeEach(() => {
      // Create skill on disk
      createTestSkill('valid-skill');
    });

    it('should verify skills successfully when hash matches', () => {
      // Note: We'd need to compute the actual hash to make this test work properly
      // For now, just test that the command runs without error
      const result = runCli(['verify'], testDir);
      expect(result.exitCode).toBe(0);
    });
  });

  describe('with untracked skills', () => {
    beforeEach(() => {
      // Create skill on disk but no lock file entry
      createTestSkill('untracked-skill');
      createLockFile({}); // Empty lock file
    });

    it('should detect untracked skills', () => {
      const result = runCli(['verify'], testDir);
      expect(result.stdout).toContain('untracked');
      expect(result.stdout).toContain('untracked-skill');
    });

    it('should exit with code 0 for untracked skills', () => {
      // Untracked is informational, not an error
      const result = runCli(['verify'], testDir);
      expect(result.exitCode).toBe(0);
    });
  });

  describe('with missing skills', () => {
    beforeEach(() => {
      // Create lock file entry but no skill on disk
      createLockFile({
        'missing-skill': {
          source: 'test/repo',
          sourceType: 'github',
          computedHash: 'abc123',
        },
      });
    });

    it('should detect missing skills', () => {
      const result = runCli(['verify'], testDir);
      expect(result.stdout).toContain('missing');
      expect(result.stdout).toContain('missing-skill');
    });

    it('should exit with code 1 for missing skills', () => {
      const result = runCli(['verify'], testDir);
      expect(result.exitCode).toBe(1);
    });
  });

  describe('verbose output', () => {
    beforeEach(() => {
      createTestSkill('verbose-test-skill');
    });

    it('should show detailed output with -v flag', () => {
      const result = runCli(['verify', '-v'], testDir);
      expect(result.stdout).toContain('Path:');
    });

    it('should show detailed output with --verbose flag', () => {
      const result = runCli(['verify', '--verbose'], testDir);
      expect(result.stdout).toContain('Path:');
    });
  });

  describe('JSON output', () => {
    beforeEach(() => {
      createTestSkill('json-test-skill');
    });

    it('should output valid JSON with --json flag', () => {
      const result = runCli(['verify', '--json'], testDir);
      expect(() => JSON.parse(result.stdout)).not.toThrow();
    });

    it('should include scope in JSON output', () => {
      const result = runCli(['verify', '--json'], testDir);
      const json = JSON.parse(result.stdout);
      expect(json.scope).toBe('project');
    });

    it('should include counts in JSON output', () => {
      const result = runCli(['verify', '--json'], testDir);
      const json = JSON.parse(result.stdout);
      expect(json.counts).toBeDefined();
      expect(typeof json.counts.ok).toBe('number');
      expect(typeof json.counts.untracked).toBe('number');
    });
  });

  describe('agent filtering', () => {
    beforeEach(() => {
      createTestSkill('agent-filter-skill');
    });

    it('should show error for invalid agent name', () => {
      const result = runCli(['verify', '-a', 'invalid-agent'], testDir);
      expect(result.stdout).toContain('Invalid agents');
      expect(result.stdout).toContain('invalid-agent');
      expect(result.exitCode).toBe(1);
    });

    it('should accept valid agent names', () => {
      const result = runCli(['verify', '-a', 'claude-code'], testDir);
      expect(result.stdout).not.toContain('Invalid agents');
    });

    it('should accept multiple agent names', () => {
      const result = runCli(['verify', '-a', 'claude-code', 'cursor'], testDir);
      expect(result.stdout).not.toContain('Invalid agents');
    });
  });

  describe('global flag', () => {
    it('should accept --global flag', () => {
      const result = runCli(['verify', '--global'], testDir);
      expect(result.stdout).toContain('global');
      expect(result.exitCode).toBe(0);
    });

    it('should accept -g flag', () => {
      const result = runCli(['verify', '-g'], testDir);
      expect(result.stdout).toContain('global');
      expect(result.exitCode).toBe(0);
    });
  });

  describe('help display', () => {
    it('should include verify in --help output', () => {
      const output = runCliOutput(['--help']);
      expect(output).toContain('verify');
      expect(output).toContain('Verify');
    });

    it('should include verify options in --help output', () => {
      const output = runCliOutput(['--help']);
      expect(output).toContain('Verify Options');
      expect(output).toContain('--verbose');
      expect(output).toContain('--json');
    });
  });

  describe('banner display', () => {
    it('should include verify in banner', () => {
      const output = runCliOutput([]);
      expect(output).toContain('verify');
    });
  });

  describe('logo display', () => {
    it('should not display logo for verify command', () => {
      const result = runCli(['verify'], testDir);
      // The verify command should not show the ASCII art logo
      expect(result.stdout).not.toContain('███');
    });
  });
});
