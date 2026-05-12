import { describe, expect, it } from 'vitest';
import { access, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { platform, tmpdir } from 'node:os';
import { installSkillForAgent } from '../src/installer.ts';

async function makeSkillSource(root: string, name: string): Promise<string> {
  const dir = join(root, 'source-skill');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: test\n---\n`, 'utf-8');
  return dir;
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

  it('does not dereference directory symlinks that point outside the skill directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'add-skill-copy-'));
    const projectDir = join(root, 'project');
    await mkdir(projectDir, { recursive: true });

    const skillName = 'copy-symlink-skill';
    const skillDir = await makeSkillSource(root, skillName);
    const outsideDir = join(root, 'outside-secret');
    await mkdir(outsideDir, { recursive: true });
    await writeFile(join(outsideDir, 'secret.txt'), 'do-not-copy\n', 'utf-8');

    try {
      await symlink(
        outsideDir,
        join(skillDir, 'leaked-secret-dir'),
        platform() === 'win32' ? 'junction' : 'dir'
      );

      const result = await installSkillForAgent(
        { name: skillName, description: 'test', path: skillDir },
        'codex',
        { cwd: projectDir, mode: 'copy', global: false }
      );

      expect(result.success).toBe(true);

      const installedDir = join(projectDir, '.agents/skills', skillName);
      await expect(access(join(installedDir, 'leaked-secret-dir', 'secret.txt'))).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
