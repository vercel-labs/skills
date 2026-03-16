import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { runCli } from './test-utils.ts';
import { shouldInstallInternalAgents } from './agents.ts';
import { parseAddOptions } from './add.ts';

describe('add command', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `agents-add-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('should show error when no source provided', () => {
    const result = runCli(['add'], testDir);
    expect(result.stdout).toContain('ERROR');
    expect(result.stdout).toContain('Missing required argument: source');
    expect(result.exitCode).toBe(1);
  });

  it('should show error for non-existent local path', () => {
    const result = runCli(['add', './non-existent-path', '-y'], testDir);
    expect(result.stdout).toContain('Local path does not exist');
    expect(result.exitCode).toBe(1);
  });

  it('should list agents from local path with --list flag', () => {
    // Create a test agent
    const agentDir = join(testDir, 'test-agent');
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(
      join(agentDir, 'AGENT.md'),
      `---
name: test-agent
description: A test agent for testing
---

# Test Agent

This is a test agent.
`
    );

    const result = runCli(['add', testDir, '--list'], testDir);
    expect(result.stdout).toContain('test-agent');
    expect(result.stdout).toContain('A test agent for testing');
    expect(result.exitCode).toBe(0);
  });

  it('should show no agents found for empty directory', () => {
    const result = runCli(['add', testDir, '-y'], testDir);
    expect(result.stdout).toContain('No agents found');
    expect(result.stdout).toContain('No valid agents found');
    expect(result.exitCode).toBe(1);
  });

  it('should install agent from local path with -y flag', () => {
    // Create a test agent
    const agentDir = join(testDir, 'agents', 'my-agent');
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(
      join(agentDir, 'AGENT.md'),
      `---
name: my-agent
description: My test agent
---

# My Agent

Instructions here.
`
    );

    // Create a target directory to install to
    const targetDir = join(testDir, 'project');
    mkdirSync(targetDir, { recursive: true });

    const result = runCli(['add', testDir, '-y', '-g', '--target', 'claude-code'], targetDir);
    expect(result.stdout).toContain('my-agent');
    expect(result.stdout).toContain('Done!');
    expect(result.exitCode).toBe(0);
  });

  it('should filter agents by name with --agent flag', () => {
    // Create multiple test agents
    const skill1Dir = join(testDir, 'agents', 'agent-one');
    const skill2Dir = join(testDir, 'agents', 'agent-two');
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

    const result = runCli(['add', testDir, '--list', '--agent', 'agent-one'], testDir);
    // With --list, it should show only the filtered agent info
    expect(result.stdout).toContain('agent-one');
  });

  it('should show error for invalid target name', () => {
    // Create a test agent
    const agentDir = join(testDir, 'test-agent');
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(
      join(agentDir, 'AGENT.md'),
      `---
name: test-agent
description: Test
---
# Test
`
    );

    const result = runCli(['add', testDir, '-y', '--target', 'invalid-target'], testDir);
    expect(result.stdout).toContain('Invalid targets');
    expect(result.exitCode).toBe(1);
  });

  it('should support add command aliases (a, i, install)', () => {
    // Test that aliases work (just check they show missing source error)
    const resultA = runCli(['a'], testDir);
    const resultI = runCli(['i'], testDir);
    const resultInstall = runCli(['install'], testDir);

    // All should show the same "missing source" error
    expect(resultA.stdout).toContain('Missing required argument: source');
    expect(resultI.stdout).toContain('Missing required argument: source');
    expect(resultInstall.stdout).toContain('Missing required argument: source');
  });

  it('should restore from lock file with experimental_install', () => {
    const result = runCli(['experimental_install'], testDir);
    expect(result.stdout).toContain('No project agents found in agents-lock.json');
  });

  describe('internal agents', () => {
    it('should skip internal agents by default', () => {
      // Create an internal agent
      const agentDir = join(testDir, 'internal-agent');
      mkdirSync(agentDir, { recursive: true });
      writeFileSync(
        join(agentDir, 'AGENT.md'),
        `---
name: internal-agent
description: An internal agent
metadata:
  internal: true
---

# Internal Agent

This is an internal agent.
`
      );

      const result = runCli(['add', testDir, '--list'], testDir);
      expect(result.stdout).not.toContain('internal-agent');
    });

    it('should show internal agents when INSTALL_INTERNAL_AGENTS=1', () => {
      // Create an internal agent
      const agentDir = join(testDir, 'internal-agent');
      mkdirSync(agentDir, { recursive: true });
      writeFileSync(
        join(agentDir, 'AGENT.md'),
        `---
name: internal-agent
description: An internal agent
metadata:
  internal: true
---

# Internal Agent

This is an internal agent.
`
      );

      const result = runCli(['add', testDir, '--list'], testDir, {
        INSTALL_INTERNAL_AGENTS: '1',
      });
      expect(result.stdout).toContain('internal-agent');
      expect(result.stdout).toContain('An internal agent');
    });

    it('should show internal agents when INSTALL_INTERNAL_AGENTS=true', () => {
      // Create an internal agent
      const agentDir = join(testDir, 'internal-agent');
      mkdirSync(agentDir, { recursive: true });
      writeFileSync(
        join(agentDir, 'AGENT.md'),
        `---
name: internal-agent
description: An internal agent
metadata:
  internal: true
---

# Internal Agent

This is an internal agent.
`
      );

      const result = runCli(['add', testDir, '--list'], testDir, {
        INSTALL_INTERNAL_AGENTS: 'true',
      });
      expect(result.stdout).toContain('internal-agent');
    });

    it('should show non-internal agents alongside internal when env var is set', () => {
      // Create both internal and non-internal agents
      const internalDir = join(testDir, 'agents', 'internal-agent');
      const publicDir = join(testDir, 'agents', 'public-agent');
      mkdirSync(internalDir, { recursive: true });
      mkdirSync(publicDir, { recursive: true });

      writeFileSync(
        join(internalDir, 'AGENT.md'),
        `---
name: internal-agent
description: An internal agent
metadata:
  internal: true
---
# Internal Agent
`
      );

      writeFileSync(
        join(publicDir, 'AGENT.md'),
        `---
name: public-agent
description: A public agent
---
# Public Agent
`
      );

      // Without env var - only public agent visible
      const resultWithout = runCli(['add', testDir, '--list'], testDir);
      expect(resultWithout.stdout).toContain('public-agent');
      expect(resultWithout.stdout).not.toContain('internal-agent');

      // With env var - both visible
      const resultWith = runCli(['add', testDir, '--list'], testDir, {
        INSTALL_INTERNAL_AGENTS: '1',
      });
      expect(resultWith.stdout).toContain('public-agent');
      expect(resultWith.stdout).toContain('internal-agent');
    });

    it('should not treat metadata.internal: false as internal', () => {
      const agentDir = join(testDir, 'not-internal-agent');
      mkdirSync(agentDir, { recursive: true });
      writeFileSync(
        join(agentDir, 'AGENT.md'),
        `---
name: not-internal-agent
description: Explicitly not internal
metadata:
  internal: false
---
# Not Internal
`
      );

      const result = runCli(['add', testDir, '--list'], testDir);
      expect(result.stdout).toContain('not-internal-agent');
    });
  });
});

describe('shouldInstallInternalAgents', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should return false when INSTALL_INTERNAL_AGENTS is not set', () => {
    delete process.env.INSTALL_INTERNAL_AGENTS;
    expect(shouldInstallInternalAgents()).toBe(false);
  });

  it('should return true when INSTALL_INTERNAL_AGENTS=1', () => {
    process.env.INSTALL_INTERNAL_AGENTS = '1';
    expect(shouldInstallInternalAgents()).toBe(true);
  });

  it('should return true when INSTALL_INTERNAL_AGENTS=true', () => {
    process.env.INSTALL_INTERNAL_AGENTS = 'true';
    expect(shouldInstallInternalAgents()).toBe(true);
  });

  it('should return false for other values', () => {
    process.env.INSTALL_INTERNAL_AGENTS = '0';
    expect(shouldInstallInternalAgents()).toBe(false);

    process.env.INSTALL_INTERNAL_AGENTS = 'false';
    expect(shouldInstallInternalAgents()).toBe(false);

    process.env.INSTALL_INTERNAL_AGENTS = 'yes';
    expect(shouldInstallInternalAgents()).toBe(false);
  });
});

describe('parseAddOptions', () => {
  it('should parse --all flag', () => {
    const result = parseAddOptions(['source', '--all']);
    expect(result.source).toEqual(['source']);
    expect(result.options.all).toBe(true);
  });

  it('should parse --agent with wildcard', () => {
    const result = parseAddOptions(['source', '--agent', '*']);
    expect(result.source).toEqual(['source']);
    expect(result.options.agent).toEqual(['*']);
  });

  it('should parse --agent with wildcard', () => {
    const result = parseAddOptions(['source', '--agent', '*']);
    expect(result.source).toEqual(['source']);
    expect(result.options.agent).toEqual(['*']);
  });

  it('should parse --agent wildcard with specific targets', () => {
    const result = parseAddOptions(['source', '--agent', '*', '--target', 'claude-code']);
    expect(result.source).toEqual(['source']);
    expect(result.options.agent).toEqual(['*']);
    expect(result.options.target).toEqual(['claude-code']);
  });

  it('should parse --target wildcard with specific agents', () => {
    const result = parseAddOptions(['source', '--target', '*', '--agent', 'my-agent']);
    expect(result.source).toEqual(['source']);
    expect(result.options.target).toEqual(['*']);
    expect(result.options.agent).toEqual(['my-agent']);
  });

  it('should parse combined flags with wildcards', () => {
    const result = parseAddOptions(['source', '-g', '--agent', '*', '-y']);
    expect(result.source).toEqual(['source']);
    expect(result.options.global).toBe(true);
    expect(result.options.agent).toEqual(['*']);
    expect(result.options.yes).toBe(true);
  });

  it('should parse --full-depth flag', () => {
    const result = parseAddOptions(['source', '--full-depth']);
    expect(result.source).toEqual(['source']);
    expect(result.options.fullDepth).toBe(true);
  });

  it('should parse --full-depth with other flags', () => {
    const result = parseAddOptions(['source', '--full-depth', '--list', '-g']);
    expect(result.source).toEqual(['source']);
    expect(result.options.fullDepth).toBe(true);
    expect(result.options.list).toBe(true);
    expect(result.options.global).toBe(true);
  });
});

describe('find-agents prompt with -y flag', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `agents-yes-flag-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('should skip find-agents prompt when -y flag is passed', () => {
    // Create a test agent
    const agentDir = join(testDir, 'test-agent');
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(
      join(agentDir, 'AGENT.md'),
      `---
name: yes-flag-test-agent
description: A test agent for -y flag testing
---

# Yes Flag Test Agent

This is a test agent for -y flag mode testing.
`
    );

    // Run with -y flag - should complete without hanging
    const result = runCli(['add', testDir, '-g', '-y', '--agent', 'yes-flag-test-agent'], testDir);

    // Should not contain the find-agents prompt
    expect(result.stdout).not.toContain('Install the find-agents agent');
    expect(result.stdout).not.toContain("One-time prompt - you won't be asked again");
    // Should complete successfully
    expect(result.exitCode).toBe(0);
  });
});
