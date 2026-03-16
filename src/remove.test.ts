import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, rmSync, mkdirSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { runCli, runCliWithInput } from './test-utils.js';

describe('remove command', { timeout: 30000 }, () => {
  let testDir: string;
  let agentsDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `agents-remove-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });

    // Create .agents/agents directory (canonical location)
    agentsDir = join(testDir, '.agents', 'agents');
    mkdirSync(agentsDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  function createTestAgent(name: string, description?: string) {
    const agentDir = join(agentsDir, name);
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(
      join(agentDir, 'AGENT.md'),
      `---
name: ${name}
description: ${description || `A test agent called ${name}`}
---

# ${name}

This is a test agent.
`
    );
  }

  function createTargetAgentsDir(targetName: string) {
    const targetAgentsDir = join(testDir, targetName, 'agents');
    mkdirSync(targetAgentsDir, { recursive: true });
    return targetAgentsDir;
  }

  function createSymlink(agentName: string, targetDir: string) {
    const agentPath = join(agentsDir, agentName);
    const linkPath = join(targetDir, agentName);
    try {
      // Create relative symlink
      const relativePath = join('..', '..', '.agents', 'agents', agentName);
      const { symlinkSync } = require('fs');
      symlinkSync(relativePath, linkPath);
    } catch {
      // Skip if symlinks aren't supported
    }
  }

  describe('with no agents installed', () => {
    it('should show message when no agents found', () => {
      const result = runCli(['remove', '-y'], testDir);
      expect(result.stdout).toContain('No agents found');
      expect(result.stdout).toContain('to remove');
      expect(result.exitCode).toBe(0);
    });

    it('should show error for non-existent agent name', () => {
      const result = runCli(['remove', 'non-existent-agent', '-y'], testDir);
      expect(result.stdout).toContain('No agents found');
      expect(result.exitCode).toBe(0);
    });
  });

  describe('with agents installed', () => {
    beforeEach(() => {
      createTestAgent('agent-one', 'First test agent');
      createTestAgent('agent-two', 'Second test agent');
      createTestAgent('agent-three', 'Third test agent');

      // Create symlinks in agent directories
      const claudeSkillsDir = createTargetAgentsDir('.claude');
      createSymlink('agent-one', claudeSkillsDir);
      createSymlink('agent-two', claudeSkillsDir);

      const clineSkillsDir = createTargetAgentsDir('.cline');
      createSymlink('agent-one', clineSkillsDir);
      createSymlink('agent-three', clineSkillsDir);
    });

    it('should remove specific agent by name with -y flag', () => {
      const result = runCli(['remove', 'agent-one', '-y'], testDir);

      expect(result.stdout).toContain('Successfully removed');
      expect(result.stdout).toContain('1 agent');

      // Verify agent was removed from canonical location
      expect(existsSync(join(agentsDir, 'agent-one'))).toBe(false);

      // Verify other agents still exist
      expect(existsSync(join(agentsDir, 'agent-two'))).toBe(true);
      expect(existsSync(join(agentsDir, 'agent-three'))).toBe(true);
    });

    it('should remove multiple agents by name', () => {
      const result = runCli(['remove', 'agent-one', 'agent-two', '-y'], testDir);

      expect(result.stdout).toContain('Successfully removed');
      expect(result.stdout).toContain('2 agent');

      expect(existsSync(join(agentsDir, 'agent-one'))).toBe(false);
      expect(existsSync(join(agentsDir, 'agent-two'))).toBe(false);
      expect(existsSync(join(agentsDir, 'agent-three'))).toBe(true);
    });

    it('should remove all agents with --all flag', () => {
      const result = runCli(['remove', '--all', '-y'], testDir);

      expect(result.stdout).toContain('Successfully removed');
      expect(result.stdout).toContain('3 agent');

      // All agents removed
      expect(existsSync(join(agentsDir, 'agent-one'))).toBe(false);
      expect(existsSync(join(agentsDir, 'agent-two'))).toBe(false);
      expect(existsSync(join(agentsDir, 'agent-three'))).toBe(false);
    });

    it('should show error for non-existent agent name when agents exist', () => {
      const result = runCli(['remove', 'non-existent', '-y'], testDir);

      expect(result.stdout).toContain('No matching agents');
      expect(result.exitCode).toBe(0);
    });

    it('should be case-insensitive when matching agent names', () => {
      const result = runCli(['remove', 'AGENT-ONE', '-y'], testDir);

      expect(result.stdout).toContain('Successfully removed');
      expect(existsSync(join(agentsDir, 'agent-one'))).toBe(false);
    });

    it('should remove only the specified agent and leave others', () => {
      runCli(['remove', 'agent-two', '-y'], testDir);

      // agent-two removed
      expect(existsSync(join(agentsDir, 'agent-two'))).toBe(false);

      // Others still exist
      expect(existsSync(join(agentsDir, 'agent-one'))).toBe(true);
      expect(existsSync(join(agentsDir, 'agent-three'))).toBe(true);
    });

    it('should list agents to remove before confirmation', () => {
      // Answer 'n' to cancel the confirmation prompt
      const result = runCliWithInput(['remove', 'agent-one', 'agent-two'], 'n', testDir);

      // Should show the agents that will be removed
      expect(result.stdout).toContain('Agents to remove');
      expect(result.stdout).toContain('agent-one');
      expect(result.stdout).toContain('agent-two');
      expect(result.stdout).toContain('uninstall');

      // Agents should NOT be removed since we cancelled
      expect(existsSync(join(agentsDir, 'agent-one'))).toBe(true);
      expect(existsSync(join(agentsDir, 'agent-two'))).toBe(true);
    });
  });

  describe('agent filtering', () => {
    beforeEach(() => {
      createTestAgent('test-agent');
      createTargetAgentsDir('.claude');
      createTargetAgentsDir('.cline');
    });

    it('should show error for invalid target name', () => {
      const result = runCli(['remove', 'test-agent', '--target', 'invalid-target', '-y'], testDir);

      expect(result.stdout).toContain('Invalid agents');
      expect(result.stdout).toContain('invalid-target');
      expect(result.stdout).toContain('Valid agents');
      expect(result.exitCode).toBe(1);
    });

    it('should accept valid target names', () => {
      // This should not error on target validation
      const result = runCli(['remove', 'test-agent', '--target', 'claude-code', '-y'], testDir);
      expect(result.stdout).not.toContain('Invalid agents');
    });

    it('should accept multiple target names', () => {
      const result = runCli(
        ['remove', 'test-agent', '--target', 'claude-code', 'cursor', '-y'],
        testDir
      );
      expect(result.stdout).not.toContain('Invalid agents');
    });
  });

  describe('global flag', () => {
    beforeEach(() => {
      createTestAgent('global-agent');
    });

    it('should accept --global flag without error', () => {
      const result = runCli(['remove', 'global-agent', '--global', '-y'], testDir);
      // Command should run without error (agent may not be found in global scope from test dir)
      expect(result.exitCode).toBe(0);
    });
  });

  describe('command aliases', () => {
    beforeEach(() => {
      createTestAgent('alias-test-agent');
    });

    it('should support "rm" alias', () => {
      const result = runCli(['rm', 'alias-test-agent', '-y'], testDir);
      expect(result.stdout).toContain('Successfully removed');
      expect(result.exitCode).toBe(0);
    });

    it('should support "r" alias', () => {
      const result = runCli(['r', 'alias-test-agent', '-y'], testDir);
      expect(result.stdout).toContain('Successfully removed');
      expect(result.exitCode).toBe(0);
    });
  });

  describe('edge cases', () => {
    it('should handle agent names with special characters', () => {
      createTestAgent('agent-with-dashes');
      createTestAgent('skill_with_underscores');

      const result = runCli(['remove', 'agent-with-dashes', '-y'], testDir);
      expect(result.stdout).toContain('Successfully removed');
      expect(existsSync(join(agentsDir, 'agent-with-dashes'))).toBe(false);
      expect(existsSync(join(agentsDir, 'skill_with_underscores'))).toBe(true);
    });

    it('should handle removing last remaining agent', () => {
      createTestAgent('last-agent');

      const result = runCli(['remove', 'last-agent', '-y'], testDir);
      expect(result.stdout).toContain('Successfully removed');
      expect(result.stdout).toContain('1 agent');

      // Directory should be empty or removed
      const remaining = readdirSync(agentsDir);
      expect(remaining.length).toBe(0);
    });

    it('should handle directory without AGENT.md file', () => {
      // Create a directory without AGENT.md
      const invalidAgentDir = join(agentsDir, 'invalid-agent');
      mkdirSync(invalidAgentDir, { recursive: true });
      writeFileSync(join(invalidAgentDir, 'README.md'), 'Just a readme');

      createTestAgent('valid-agent');

      const result = runCli(['remove', 'valid-agent', '-y'], testDir);
      expect(result.stdout).toContain('Successfully removed');

      // Invalid directory should still be removed
      expect(existsSync(join(agentsDir, 'invalid-agent'))).toBe(true);
    });
  });

  describe('help and info', () => {
    it('should show help with --help', () => {
      const result = runCli(['remove', '--help'], testDir);
      expect(result.stdout).toContain('Usage');
      expect(result.stdout).toContain('remove');
      expect(result.stdout).toContain('--global');
      expect(result.stdout).toContain('--target');
      expect(result.stdout).toContain('--yes');
      expect(result.exitCode).toBe(0);
    });

    it('should show help with -h', () => {
      const result = runCli(['remove', '-h'], testDir);
      expect(result.stdout).toContain('Usage');
      expect(result.exitCode).toBe(0);
    });
  });

  describe('option parsing', () => {
    beforeEach(() => {
      createTestAgent('parse-test-agent');
    });

    it('should parse -g as global', () => {
      const result = runCli(['remove', 'parse-test-agent', '-g', '-y'], testDir);
      expect(result.stdout).not.toContain('error');
      expect(result.stdout).not.toContain('unrecognized');
    });

    it('should parse --yes flag', () => {
      const result = runCli(['remove', 'parse-test-agent', '--yes'], testDir);
      expect(result.exitCode).toBe(0);
    });

    it('should parse -a as agent', () => {
      const result = runCli(['remove', 'parse-test-agent', '-a', 'claude-code', '-y'], testDir);
      expect(result.stdout).not.toContain('Invalid agents');
    });

    it('should handle multiple values for --agent', () => {
      const result = runCli(
        ['remove', 'parse-test-agent', '--agent', 'claude-code', 'cursor', '-y'],
        testDir
      );
      expect(result.stdout).not.toContain('Invalid agents');
    });
  });
});
