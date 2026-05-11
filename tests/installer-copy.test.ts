import { describe, expect, it } from 'vitest';
import { access, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { installSkillForAgent } from '../src/installer.ts';

async function makeSkillSource(root: string, name: string): Promise<string> {
  const dir = join(root, 'source-skill');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: test\n---\n`, 'utf-8');
  return dir;
}

function isSymlinkUnsupported(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    ['EACCES', 'ENOSYS', 'EPERM'].includes(String((error as NodeJS.ErrnoException).code))
  );
}

describe('installer copy mode', () => {
  it('preserves dotfiles while keeping explicit exclusions', async () => {
    const root = await mkdtemp(join(tmpdir(), 'add-skill-copy-'));
    const projectDir = join(root, 'project');
    await mkdir(projectDir, { recursive: true });

    const skillName = 'copy-dotfile-skill';
    const skillDir = await makeSkillSource(root, skillName);

    await writeFile(join(skillDir, '.prettierrc'), '{ "singleQuote": true }\n', 'utf-8');
    await writeFile(join(skillDir, 'metadata.json'), '{"private":true}\n', 'utf-8');
    await mkdir(join(skillDir, '.git'), { recursive: true });
    await writeFile(join(skillDir, '.git', 'config'), '[core]\n', 'utf-8');

    try {
      const result = await installSkillForAgent(
        { name: skillName, description: 'test', path: skillDir },
        'codex',
        { cwd: projectDir, mode: 'copy', global: false }
      );

      expect(result.success).toBe(true);

      const installedDir = join(projectDir, '.agents/skills', skillName);
      await expect(readFile(join(installedDir, '.prettierrc'), 'utf-8')).resolves.toBe(
        '{ "singleQuote": true }\n'
      );
      await expect(access(join(installedDir, 'metadata.json'))).rejects.toThrow();
      await expect(access(join(installedDir, '.git'))).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('does not copy symlink targets outside the skill directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'add-skill-copy-symlink-'));
    const projectDir = join(root, 'project');
    await mkdir(projectDir, { recursive: true });

    const skillName = 'copy-symlink-skill';
    const skillDir = await makeSkillSource(root, skillName);
    const outsideFile = join(root, 'outside-secret.txt');
    await writeFile(outsideFile, 'sensitive local content\n', 'utf-8');

    try {
      await symlink(outsideFile, join(skillDir, 'outside-secret'));
    } catch (error) {
      if (isSymlinkUnsupported(error)) {
        await rm(root, { recursive: true, force: true });
        return;
      }
      throw error;
    }

    try {
      const result = await installSkillForAgent(
        { name: skillName, description: 'test', path: skillDir },
        'codex',
        { cwd: projectDir, mode: 'copy', global: false }
      );

      expect(result.success).toBe(true);

      const installedDir = join(projectDir, '.agents/skills', skillName);
      await expect(access(join(installedDir, 'outside-secret'))).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('copies file symlinks that resolve inside the skill directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'add-skill-copy-internal-symlink-'));
    const projectDir = join(root, 'project');
    await mkdir(projectDir, { recursive: true });

    const skillName = 'copy-internal-symlink-skill';
    const skillDir = await makeSkillSource(root, skillName);
    const sharedFile = join(skillDir, 'shared.md');
    await writeFile(sharedFile, 'shared instructions\n', 'utf-8');

    try {
      await symlink(sharedFile, join(skillDir, 'linked.md'));
    } catch (error) {
      if (isSymlinkUnsupported(error)) {
        await rm(root, { recursive: true, force: true });
        return;
      }
      throw error;
    }

    try {
      const result = await installSkillForAgent(
        { name: skillName, description: 'test', path: skillDir },
        'codex',
        { cwd: projectDir, mode: 'copy', global: false }
      );

      expect(result.success).toBe(true);

      const installedDir = join(projectDir, '.agents/skills', skillName);
      await expect(readFile(join(installedDir, 'linked.md'), 'utf-8')).resolves.toBe(
        'shared instructions\n'
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
