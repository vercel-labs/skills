/**
 * Regression tests for issue #886: Installing a skill from .agents/skills/ deletes source files
 *
 * This test suite verifies that the same-path detection logic prevents deletion of source files
 * when installing a skill that is already located in the canonical directory.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, rm, lstat, readFile } from 'fs/promises';
import { join } from 'path';
import { mkdtemp } from 'fs/promises';
import { tmpdir } from 'os';
import { installSkillForAgent } from '../src/installer.ts';
import type { Skill } from '../src/types.ts';

describe('installSkillForAgent - same path detection', () => {
  let testDir: string;
  let canonicalDir: string;
  let agentDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'installer-test-'));
    canonicalDir = join(testDir, '.agents', 'skills');
    agentDir = join(testDir, '.claude', 'skills');
    await mkdir(canonicalDir, { recursive: true });
    await mkdir(agentDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it('should not delete source when installing from canonical location', async () => {
    // Setup: Create skill in canonical location
    const skillPath = join(canonicalDir, 'test-skill');
    await mkdir(skillPath, { recursive: true });
    await writeFile(join(skillPath, 'SKILL.md'), '# Test Skill');

    const skill: Skill = {
      name: 'test-skill',
      path: skillPath,
      description: 'Test skill',
    };

    // Execute: Install from canonical location
    const result = await installSkillForAgent(skill, 'claude-code', {
      global: false,
      cwd: testDir,
      mode: 'symlink',
    });

    // Verify: Source file still exists
    const stats = await lstat(join(skillPath, 'SKILL.md'));
    expect(stats.isFile()).toBe(true);
    expect(result.success).toBe(true);
  });

  it('should create symlink when source is in canonical location', async () => {
    // Setup: Create skill in canonical location
    const skillPath = join(canonicalDir, 'test-skill');
    await mkdir(skillPath, { recursive: true });
    await writeFile(join(skillPath, 'SKILL.md'), '# Test Skill');

    const skill: Skill = {
      name: 'test-skill',
      path: skillPath,
      description: 'Test skill',
    };

    // Execute: Install from canonical location
    const result = await installSkillForAgent(skill, 'claude-code', {
      global: false,
      cwd: testDir,
      mode: 'symlink',
    });

    // Verify: Symlink created to agent directory
    const symlinkPath = join(agentDir, 'test-skill');
    const stats = await lstat(symlinkPath);
    expect(stats.isSymbolicLink()).toBe(true);
    expect(result.success).toBe(true);
  });

  it('should preserve all files when installing from canonical location', async () => {
    // Setup: Create skill with multiple files in canonical location
    const skillPath = join(canonicalDir, 'multi-file-skill');
    await mkdir(skillPath, { recursive: true });
    await writeFile(join(skillPath, 'SKILL.md'), '# Multi File Skill');
    await writeFile(join(skillPath, 'README.md'), '# README');
    await writeFile(join(skillPath, 'example.js'), 'console.log("test");');

    const skill: Skill = {
      name: 'multi-file-skill',
      path: skillPath,
      description: 'Multi file skill',
    };

    // Execute: Install from canonical location
    const result = await installSkillForAgent(skill, 'claude-code', {
      global: false,
      cwd: testDir,
      mode: 'symlink',
    });

    // Verify: All source files still exist
    const skillMdStats = await lstat(join(skillPath, 'SKILL.md'));
    expect(skillMdStats.isFile()).toBe(true);

    const readmeStats = await lstat(join(skillPath, 'README.md'));
    expect(readmeStats.isFile()).toBe(true);

    const exampleStats = await lstat(join(skillPath, 'example.js'));
    expect(exampleStats.isFile()).toBe(true);

    expect(result.success).toBe(true);
  });

  it('should handle nested directories when installing from canonical location', async () => {
    // Setup: Create skill with nested structure in canonical location
    const skillPath = join(canonicalDir, 'nested-skill');
    const nestedDir = join(skillPath, 'examples');
    await mkdir(nestedDir, { recursive: true });
    await writeFile(join(skillPath, 'SKILL.md'), '# Nested Skill');
    await writeFile(join(nestedDir, 'example1.js'), 'console.log("example1");');

    const skill: Skill = {
      name: 'nested-skill',
      path: skillPath,
      description: 'Nested skill',
    };

    // Execute: Install from canonical location
    const result = await installSkillForAgent(skill, 'claude-code', {
      global: false,
      cwd: testDir,
      mode: 'symlink',
    });

    // Verify: Nested files still exist
    const skillMdStats = await lstat(join(skillPath, 'SKILL.md'));
    expect(skillMdStats.isFile()).toBe(true);

    const nestedFileStats = await lstat(join(nestedDir, 'example1.js'));
    expect(nestedFileStats.isFile()).toBe(true);

    expect(result.success).toBe(true);
  });

  it('should still copy when source is external and different from canonical', async () => {
    // Setup: Create skill in external location (not canonical)
    const externalDir = join(testDir, 'external-skills');
    await mkdir(externalDir, { recursive: true });
    const skillPath = join(externalDir, 'external-skill');
    await mkdir(skillPath, { recursive: true });
    await writeFile(join(skillPath, 'SKILL.md'), '# External Skill');

    const skill: Skill = {
      name: 'external-skill',
      path: skillPath,
      description: 'External skill',
    };

    // Execute: Install from external location
    const result = await installSkillForAgent(skill, 'claude-code', {
      global: false,
      cwd: testDir,
      mode: 'symlink',
    });

    // Verify: Skill copied to canonical location
    const canonicalSkillPath = join(canonicalDir, 'external-skill');
    const stats = await lstat(join(canonicalSkillPath, 'SKILL.md'));
    expect(stats.isFile()).toBe(true);

    // Verify: Original source still exists
    const sourceStats = await lstat(join(skillPath, 'SKILL.md'));
    expect(sourceStats.isFile()).toBe(true);

    expect(result.success).toBe(true);
  });

  it('should handle copy mode when source is in canonical location', async () => {
    // Setup: Create skill in canonical location
    const skillPath = join(canonicalDir, 'copy-mode-skill');
    await mkdir(skillPath, { recursive: true });
    await writeFile(join(skillPath, 'SKILL.md'), '# Copy Mode Skill');

    const skill: Skill = {
      name: 'copy-mode-skill',
      path: skillPath,
      description: 'Copy mode skill',
    };

    // Execute: Install with copy mode from canonical location
    const result = await installSkillForAgent(skill, 'claude-code', {
      global: false,
      cwd: testDir,
      mode: 'copy',
    });

    // Verify: Source file still exists (copy mode goes to agent dir directly)
    const stats = await lstat(join(skillPath, 'SKILL.md'));
    expect(stats.isFile()).toBe(true);

    // Verify: Copy exists in agent directory
    const agentSkillPath = join(agentDir, 'copy-mode-skill');
    const agentStats = await lstat(join(agentSkillPath, 'SKILL.md'));
    expect(agentStats.isFile()).toBe(true);

    expect(result.success).toBe(true);
    expect(result.mode).toBe('copy');
  });
});
