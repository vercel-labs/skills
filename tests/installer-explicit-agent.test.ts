/**
 * Tests for the `explicitlySelected` option in installSkillForAgent.
 *
 * Without this flag, a project-level install for a non-universal agent (e.g.
 * claude-code) is silently skipped when its config dir (e.g. `.claude/`) is not
 * present in the project. When the user passes `-a claude-code` explicitly, the
 * symlink should be created anyway.
 *
 * See https://github.com/vercel-labs/skills/issues/744 and #851.
 */

import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile, lstat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { installSkillForAgent } from '../src/installer.ts';

async function makeSkillSource(root: string, name: string): Promise<string> {
  const dir = join(root, 'source-skill');
  await mkdir(dir, { recursive: true });
  const skillMd = `---\nname: ${name}\ndescription: test\n---\n`;
  await writeFile(join(dir, 'SKILL.md'), skillMd, 'utf-8');
  return dir;
}

describe('installer explicit-agent selection', () => {
  it('creates the claude-code symlink when explicitlySelected is true, even without a pre-existing .claude/ dir', async () => {
    const root = await mkdtemp(join(tmpdir(), 'add-skill-explicit-'));
    const projectDir = join(root, 'project');
    await mkdir(projectDir, { recursive: true });

    const skillName = 'explicit-skill';
    const skillDir = await makeSkillSource(root, skillName);

    try {
      // Sanity: project starts with no .claude/ directory.
      expect(existsSync(join(projectDir, '.claude'))).toBe(false);

      const result = await installSkillForAgent(
        { name: skillName, description: 'test', path: skillDir },
        'claude-code',
        {
          cwd: projectDir,
          mode: 'symlink',
          global: false,
          explicitlySelected: true,
        }
      );

      expect(result.success).toBe(true);
      expect(result.skipped).toBeUndefined();

      // Both directories must now exist.
      const canonicalPath = join(projectDir, '.agents/skills', skillName);
      const agentPath = join(projectDir, '.claude/skills', skillName);
      expect(existsSync(canonicalPath)).toBe(true);
      expect(existsSync(agentPath)).toBe(true);

      // The agent path must be a symlink.
      const stats = await lstat(agentPath);
      expect(stats.isSymbolicLink()).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('still skips when explicitlySelected is false and the agent dir is absent (preserves existing behavior)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'add-skill-implicit-'));
    const projectDir = join(root, 'project');
    await mkdir(projectDir, { recursive: true });

    const skillName = 'implicit-skill';
    const skillDir = await makeSkillSource(root, skillName);

    try {
      expect(existsSync(join(projectDir, '.claude'))).toBe(false);

      const result = await installSkillForAgent(
        { name: skillName, description: 'test', path: skillDir },
        'claude-code',
        { cwd: projectDir, mode: 'symlink', global: false }
      );

      // Canonical store is populated, but the .claude/skills symlink is skipped.
      expect(result.success).toBe(true);
      expect(result.skipped).toBe(true);

      expect(existsSync(join(projectDir, '.agents/skills', skillName))).toBe(true);
      expect(existsSync(join(projectDir, '.claude/skills', skillName))).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('creates the symlink when explicitlySelected is false but .claude/ already exists', async () => {
    const root = await mkdtemp(join(tmpdir(), 'add-skill-precreated-'));
    const projectDir = join(root, 'project');
    await mkdir(join(projectDir, '.claude'), { recursive: true });

    const skillName = 'precreated-skill';
    const skillDir = await makeSkillSource(root, skillName);

    try {
      const result = await installSkillForAgent(
        { name: skillName, description: 'test', path: skillDir },
        'claude-code',
        { cwd: projectDir, mode: 'symlink', global: false }
      );

      expect(result.success).toBe(true);
      expect(result.skipped).toBeUndefined();

      const agentPath = join(projectDir, '.claude/skills', skillName);
      expect(existsSync(agentPath)).toBe(true);

      const stats = await lstat(agentPath);
      expect(stats.isSymbolicLink()).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
