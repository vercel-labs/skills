import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir, homedir } from 'os';
import { runCli } from './test-utils.ts';
import { parseListOptions } from './list.ts';

describe('list command', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `agents-list-test-${Date.now()}`);
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

    it('should parse -t flag with single target', () => {
      const options = parseListOptions(['-t', 'claude-code']);
      expect(options.target).toEqual(['claude-code']);
    });

    it('should parse --target flag with single target', () => {
      const options = parseListOptions(['--target', 'cursor']);
      expect(options.target).toEqual(['cursor']);
    });

    it('should parse -t flag with multiple targets', () => {
      const options = parseListOptions(['-t', 'claude-code', 'cursor', 'codex']);
      expect(options.target).toEqual(['claude-code', 'cursor', 'codex']);
    });

    it('should parse combined flags', () => {
      const options = parseListOptions(['-g', '-t', 'claude-code', 'cursor']);
      expect(options.global).toBe(true);
      expect(options.target).toEqual(['claude-code', 'cursor']);
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

    it('should stop collecting targets at next flag', () => {
      const options = parseListOptions(['-t', 'claude-code', '-g']);
      expect(options.target).toEqual(['claude-code']);
      expect(options.global).toBe(true);
    });
  });

  describe('CLI integration', () => {
    it('should run list command', () => {
      const result = runCli(['list'], testDir);
      // Empty project dir shows "No project agents found"
      expect(result.stdout).toContain('No project agents found');
      expect(result.exitCode).toBe(0);
    });

    it('should run ls alias', () => {
      const result = runCli(['ls'], testDir);
      expect(result.stdout).toContain('No project agents found');
      expect(result.exitCode).toBe(0);
    });

    it('should output empty JSON array when no agents', () => {
      const result = runCli(['list', '--json'], testDir);
      expect(result.exitCode).toBe(0);
      const parsed = JSON.parse(result.stdout.trim());
      expect(parsed).toEqual([]);
    });

    it('should output valid JSON with --json flag', () => {
      const agentDir = join(testDir, '.agents', 'agents', 'json-agent');
      mkdirSync(agentDir, { recursive: true });
      writeFileSync(
        join(agentDir, 'AGENT.md'),
        `---
name: json-agent
description: A agent for JSON testing
---

# JSON Agent
`
      );

      const result = runCli(['list', '--json'], testDir);
      expect(result.exitCode).toBe(0);
      const parsed = JSON.parse(result.stdout.trim());
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed.length).toBe(1);
      expect(parsed[0].name).toBe('json-agent');
      expect(parsed[0].path).toContain('json-agent');
      expect(parsed[0].scope).toBe('project');
      expect(Array.isArray(parsed[0].agents)).toBe(true);
      // No ANSI codes in JSON output
      expect(result.stdout).not.toMatch(/\x1b\[/);
    });

    it('should output multiple agents as JSON array', () => {
      const skill1Dir = join(testDir, '.agents', 'agents', 'agent-alpha');
      const skill2Dir = join(testDir, '.agents', 'agents', 'agent-beta');
      mkdirSync(skill1Dir, { recursive: true });
      mkdirSync(skill2Dir, { recursive: true });

      writeFileSync(
        join(skill1Dir, 'AGENT.md'),
        `---\nname: agent-alpha\ndescription: Alpha\n---\n# Alpha\n`
      );
      writeFileSync(
        join(skill2Dir, 'AGENT.md'),
        `---\nname: agent-beta\ndescription: Beta\n---\n# Beta\n`
      );

      const result = runCli(['list', '--json'], testDir);
      expect(result.exitCode).toBe(0);
      const parsed = JSON.parse(result.stdout.trim());
      expect(parsed.length).toBe(2);
      const names = parsed.map((s: any) => s.name);
      expect(names).toContain('agent-alpha');
      expect(names).toContain('agent-beta');
    });

    it('should show message when no project agents found', () => {
      const result = runCli(['list'], testDir);
      expect(result.stdout).toContain('No project agents found');
      expect(result.stdout).toContain('Try listing global agents with -g');
      expect(result.exitCode).toBe(0);
    });

    it('should list project agents', () => {
      // Create a agent in the canonical location
      const agentDir = join(testDir, '.agents', 'agents', 'test-agent');
      mkdirSync(agentDir, { recursive: true });
      writeFileSync(
        join(agentDir, 'AGENT.md'),
        `---
name: test-agent
description: A test agent for listing
---

# Test Agent

This is a test agent.
`
      );

      const result = runCli(['list'], testDir);
      expect(result.stdout).toContain('test-agent');
      expect(result.stdout).toContain('Project Agents');
      // Description should not be shown
      expect(result.stdout).not.toContain('A test agent for listing');
      expect(result.exitCode).toBe(0);
    });

    it('should list multiple agents', () => {
      // Create multiple agents
      const skill1Dir = join(testDir, '.agents', 'agents', 'agent-one');
      const skill2Dir = join(testDir, '.agents', 'agents', 'agent-two');
      mkdirSync(skill1Dir, { recursive: true });
      mkdirSync(skill2Dir, { recursive: true });

      writeFileSync(
        join(skill1Dir, 'AGENT.md'),
        `---
name: agent-one
description: First agent
---
# Agent One
`
      );

      writeFileSync(
        join(skill2Dir, 'AGENT.md'),
        `---
name: agent-two
description: Second agent
---
# Agent Two
`
      );

      const result = runCli(['list'], testDir);
      expect(result.stdout).toContain('agent-one');
      expect(result.stdout).toContain('agent-two');
      expect(result.stdout).toContain('Project Agents');
      expect(result.exitCode).toBe(0);
    });

    it('should respect -g flag for global only', () => {
      // Create a project agent (should not be shown with -g)
      const agentDir = join(testDir, '.agents', 'agents', 'project-agent');
      mkdirSync(agentDir, { recursive: true });
      writeFileSync(
        join(agentDir, 'AGENT.md'),
        `---
name: project-agent
description: A project agent
---
# Project Agent
`
      );

      const result = runCli(['list', '-g'], testDir);
      // Should not show project agent when -g is specified
      expect(result.stdout).not.toContain('project-agent');
      expect(result.stdout).toContain('Global Agents');
    });

    it('should show error for invalid target filter', () => {
      const result = runCli(['list', '-t', 'invalid-target'], testDir);
      expect(result.stdout).toContain('Invalid agents');
      expect(result.stdout).toContain('invalid-target');
      expect(result.exitCode).toBe(1);
    });

    it('should filter by valid agent', () => {
      // Create a agent
      const agentDir = join(testDir, '.agents', 'agents', 'test-agent');
      mkdirSync(agentDir, { recursive: true });
      writeFileSync(
        join(agentDir, 'AGENT.md'),
        `---
name: test-agent
description: A test agent
---
# Test Agent
`
      );

      const result = runCli(['list', '-a', 'claude-code'], testDir);
      expect(result.stdout).toContain('test-agent');
      expect(result.exitCode).toBe(0);
    });

    it('should ignore directories without AGENT.md', () => {
      // Create a valid agent
      const validDir = join(testDir, '.agents', 'agents', 'valid-agent');
      mkdirSync(validDir, { recursive: true });
      writeFileSync(
        join(validDir, 'AGENT.md'),
        `---
name: valid-agent
description: Valid agent
---
# Valid
`
      );

      // Create an invalid directory (no AGENT.md)
      const invalidDir = join(testDir, '.agents', 'agents', 'invalid-agent');
      mkdirSync(invalidDir, { recursive: true });
      writeFileSync(join(invalidDir, 'README.md'), '# Not a agent');

      const result = runCli(['list'], testDir);
      expect(result.stdout).toContain('valid-agent');
      expect(result.stdout).not.toContain('invalid-agent');
      expect(result.exitCode).toBe(0);
    });

    it('should handle AGENT.md with missing frontmatter', () => {
      // Create a valid agent
      const validDir = join(testDir, '.agents', 'agents', 'valid-agent');
      mkdirSync(validDir, { recursive: true });
      writeFileSync(
        join(validDir, 'AGENT.md'),
        `---
name: valid-agent
description: Valid agent
---
# Valid
`
      );

      // Create a agent with invalid AGENT.md (no frontmatter)
      const invalidDir = join(testDir, '.agents', 'agents', 'invalid-agent');
      mkdirSync(invalidDir, { recursive: true });
      writeFileSync(join(invalidDir, 'AGENT.md'), '# Invalid\nNo frontmatter here');

      const result = runCli(['list'], testDir);
      expect(result.stdout).toContain('valid-agent');
      expect(result.stdout).not.toContain('invalid-agent');
      expect(result.exitCode).toBe(0);
    });

    it('should show agent path', () => {
      const agentDir = join(testDir, '.agents', 'agents', 'test-agent');
      mkdirSync(agentDir, { recursive: true });
      writeFileSync(
        join(agentDir, 'AGENT.md'),
        `---
name: test-agent
description: A test agent
---
# Test Agent
`
      );

      const result = runCli(['list'], testDir);
      // Path is shown inline with agent name (handles both Unix / and Windows \)
      expect(result.stdout).toMatch(/\.agents[/\\]agents[/\\]test-agent/);
    });
  });

  describe('help output', () => {
    it('should include list command in help', () => {
      const result = runCli(['--help']);
      expect(result.stdout).toContain('list, ls');
      expect(result.stdout).toContain('List installed agents');
    });

    it('should include list options in help', () => {
      const result = runCli(['--help']);
      expect(result.stdout).toContain('List Options:');
      expect(result.stdout).toContain('-g, --global');
      expect(result.stdout).toContain('-t, --target');
    });

    it('should include list examples in help', () => {
      const result = runCli(['--help']);
      expect(result.stdout).toContain('agents list');
      expect(result.stdout).toContain('agents ls -g');
      expect(result.stdout).toContain('agents ls -t claude-code');
    });
  });

  describe('banner', () => {
    it('should include list command in banner', () => {
      const result = runCli([]);
      expect(result.stdout).toContain('npx agents list');
      expect(result.stdout).toContain('List installed agents');
    });
  });
});
