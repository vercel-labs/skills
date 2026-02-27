/**
 * Regression tests for symlink installs when canonical and agent paths match.
 */

import { describe, it, expect } from 'vitest';
import {
  mkdtemp,
  mkdir,
  rm,
  writeFile,
  lstat,
  readFile,
  readlink,
  symlink,
  readdir,
} from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { installSkillForAgent, getAgentBaseDir } from '../src/installer.ts';

async function makeSkillSource(root: string, name: string): Promise<string> {
  const dir = join(root, 'source-skill');
  await mkdir(dir, { recursive: true });
  const skillMd = `---\nname: ${name}\ndescription: test\n---\n`;
  await writeFile(join(dir, 'SKILL.md'), skillMd, 'utf-8');
  return dir;
}

describe('installer symlink regression', () => {
  it('does not create self-loop when canonical and agent paths match', async () => {
    const root = await mkdtemp(join(tmpdir(), 'add-skill-'));
    const projectDir = join(root, 'project');
    await mkdir(projectDir, { recursive: true });

    const skillName = 'self-loop-skill';
    const skillDir = await makeSkillSource(root, skillName);

    try {
      const result = await installSkillForAgent(
        { name: skillName, description: 'test', path: skillDir },
        'amp',
        { cwd: projectDir, mode: 'symlink', global: false }
      );

      expect(result.success).toBe(true);
      expect(result.symlinkFailed).toBeUndefined();

      const installedPath = join(projectDir, '.agents/skills', skillName);
      const stats = await lstat(installedPath);
      expect(stats.isSymbolicLink()).toBe(false);
      expect(stats.isDirectory()).toBe(true);

      const contents = await readFile(join(installedPath, 'SKILL.md'), 'utf-8');
      expect(contents).toContain(`name: ${skillName}`);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('cleans pre-existing self-loop symlink in canonical dir', async () => {
    const root = await mkdtemp(join(tmpdir(), 'add-skill-'));
    const projectDir = join(root, 'project');
    await mkdir(projectDir, { recursive: true });

    const skillName = 'self-loop-skill';
    const skillDir = await makeSkillSource(root, skillName);
    const canonicalDir = join(projectDir, '.agents/skills', skillName);

    try {
      await mkdir(join(projectDir, '.agents/skills'), { recursive: true });
      await symlink(skillName, canonicalDir);
      const preStats = await lstat(canonicalDir);
      expect(preStats.isSymbolicLink()).toBe(true);

      const result = await installSkillForAgent(
        { name: skillName, description: 'test', path: skillDir },
        'amp',
        { cwd: projectDir, mode: 'symlink', global: false }
      );

      expect(result.success).toBe(true);

      const postStats = await lstat(canonicalDir);
      expect(postStats.isSymbolicLink()).toBe(false);
      expect(postStats.isDirectory()).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  // Regression test for #293: when agent skills dir is a symlink to canonical dir
  it('handles agent skills dir being a symlink to canonical dir', async () => {
    const root = await mkdtemp(join(tmpdir(), 'add-skill-'));
    const projectDir = join(root, 'project');
    await mkdir(projectDir, { recursive: true });

    const skillName = 'symlinked-dir-skill';
    const skillDir = await makeSkillSource(root, skillName);

    // Create canonical dir: .agents/skills
    const canonicalBase = join(projectDir, '.agents', 'skills');
    await mkdir(canonicalBase, { recursive: true });

    // Create .claude directory and symlink .claude/skills -> .agents/skills
    const claudeDir = join(projectDir, '.claude');
    await mkdir(claudeDir, { recursive: true });
    const claudeSkillsDir = join(claudeDir, 'skills');
    await symlink(canonicalBase, claudeSkillsDir);

    try {
      // Install for claude-code, which has skillsDir: '.claude/skills'
      const result = await installSkillForAgent(
        { name: skillName, description: 'test', path: skillDir },
        'claude-code',
        { cwd: projectDir, mode: 'symlink', global: false }
      );

      expect(result.success).toBe(true);
      expect(result.symlinkFailed).toBeUndefined();

      // The skill should exist in the canonical location
      const canonicalSkillDir = join(canonicalBase, skillName);
      const stats = await lstat(canonicalSkillDir);
      expect(stats.isDirectory()).toBe(true);

      // It should NOT be a broken symlink - it should be a real directory
      const contents = await readFile(join(canonicalSkillDir, 'SKILL.md'), 'utf-8');
      expect(contents).toContain(`name: ${skillName}`);

      // The skill should also be accessible via the symlinked path
      const claudeSkillDir = join(claudeSkillsDir, skillName);
      const claudeContents = await readFile(join(claudeSkillDir, 'SKILL.md'), 'utf-8');
      expect(claudeContents).toContain(`name: ${skillName}`);

      // There should be no broken symlinks in canonical dir
      const canonicalEntries = await readdir(canonicalBase, { withFileTypes: true });
      for (const entry of canonicalEntries) {
        if (entry.name === skillName) {
          const entryPath = join(canonicalBase, entry.name);
          const entryStats = await lstat(entryPath);
          // Should be a real directory, not a symlink
          expect(entryStats.isDirectory()).toBe(true);
        }
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  // Regression test for #294: project-level universal agents should not create redundant symlinks
  it('does not create redundant symlinks for universal agents on project install', async () => {
    const root = await mkdtemp(join(tmpdir(), 'add-skill-'));

    const skillName = 'universal-only-skill';
    const skillDir = await makeSkillSource(root, skillName);

    // For project-level installs, universal agents all share .agents/skills,
    // so canonical and agent dirs are the same -- no symlink needed.
    const projectDir = join(root, 'project');
    await mkdir(projectDir, { recursive: true });

    try {
      const result = await installSkillForAgent(
        { name: skillName, description: 'test', path: skillDir },
        'github-copilot',
        { cwd: projectDir, mode: 'symlink', global: false }
      );

      expect(result.success).toBe(true);
      expect(result.symlinkFailed).toBeUndefined();

      const installedPath = join(projectDir, '.agents/skills', skillName);
      const stats = await lstat(installedPath);
      expect(stats.isDirectory()).toBe(true);
      expect(stats.isSymbolicLink()).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  // Regression test for #421: universal agents with their own globalSkillsDir should
  // return the agent-specific path for global installs, not the canonical path.
  it('getAgentBaseDir returns agent-specific global dir for universal agents with distinct globalSkillsDir', () => {
    const cursorGlobalDir = getAgentBaseDir('cursor', true);
    expect(cursorGlobalDir).toContain('.cursor');
    expect(cursorGlobalDir).not.toContain('.agents');

    const copilotGlobalDir = getAgentBaseDir('github-copilot', true);
    expect(copilotGlobalDir).toContain('.copilot');
    expect(copilotGlobalDir).not.toContain('.agents');

    const geminiGlobalDir = getAgentBaseDir('gemini-cli', true);
    expect(geminiGlobalDir).toContain('.gemini');
    expect(geminiGlobalDir).not.toContain('.agents');
  });

  // Universal agents should still use canonical .agents/skills for project-level installs
  it('getAgentBaseDir returns canonical dir for universal agents on project install', () => {
    const projectDir = getAgentBaseDir('cursor', false, '/tmp/test-project');
    expect(projectDir).toBe(join('/tmp/test-project', '.agents', 'skills'));

    const copilotDir = getAgentBaseDir('github-copilot', false, '/tmp/test-project');
    expect(copilotDir).toBe(join('/tmp/test-project', '.agents', 'skills'));
  });
});
