/**
 * Regression tests for symlink installs when canonical and agent paths match.
 */

import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile, lstat, readFile, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir, platform } from 'node:os';
import { installSkillForAgent } from '../src/installer.ts';

async function makeSkillSource(root: string, name: string): Promise<string> {
  const dir = join(root, 'source-skill');
  await mkdir(dir, { recursive: true });
  const skillMd = `---\nname: ${name}\ndescription: test\n---\n`;
  await writeFile(join(dir, 'SKILL.md'), skillMd, 'utf-8');
  return dir;
}

// Helper to check if symlinks are supported
async function symlinksSupported(): Promise<boolean> {
  if (platform() !== 'win32') return true;
  try {
    const testDir = await mkdtemp(join(tmpdir(), 'symlink-test-'));
    const testFile = join(testDir, 'test.txt');
    const testLink = join(testDir, 'test-link');
    await writeFile(testFile, 'test', 'utf-8');
    await symlink(testFile, testLink);
    await rm(testDir, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

describe('installer symlink regression', () => {
  it('does not create self-loop when canonical and agent paths match', async () => {
    // Skip on Windows without symlink support (requires admin or developer mode)
    if (!(await symlinksSupported())) {
      console.log('Skipping test: symlinks not supported on this platform');
      return;
    }

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
    // Skip on Windows without symlink support (requires admin or developer mode)
    if (!(await symlinksSupported())) {
      console.log('Skipping test: symlinks not supported on this platform');
      return;
    }

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
});
