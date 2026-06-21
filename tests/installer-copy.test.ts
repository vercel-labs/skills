import { describe, expect, it } from 'vitest';
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { installSkillForAgent, renameInstalledSkill } from '../src/installer.ts';

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

  it('namespaces the install dir under a prefix', async () => {
    const root = await mkdtemp(join(tmpdir(), 'add-skill-prefix-'));
    const projectDir = join(root, 'project');
    await mkdir(projectDir, { recursive: true });
    const skillDir = await makeSkillSource(root, 'tool');

    try {
      const result = await installSkillForAgent(
        { name: 'tool', description: 'test', path: skillDir },
        'codex',
        { cwd: projectDir, mode: 'copy', global: false, prefix: 'bundle' }
      );

      expect(result.success).toBe(true);
      await expect(
        access(join(projectDir, '.agents/skills/bundle-tool/SKILL.md'))
      ).resolves.toBeUndefined();
      await expect(access(join(projectDir, '.agents/skills/tool'))).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rewrites the installed SKILL.md name to the prefixed name', async () => {
    const root = await mkdtemp(join(tmpdir(), 'add-skill-rename-'));
    const projectDir = join(root, 'project');
    await mkdir(projectDir, { recursive: true });
    const skillDir = await makeSkillSource(root, 'tool');

    try {
      const result = await installSkillForAgent(
        { name: 'tool', description: 'test', path: skillDir },
        'codex',
        { cwd: projectDir, mode: 'copy', global: false, prefix: 'bundle' }
      );
      expect(result.success).toBe(true);

      const installedDir = join(projectDir, '.agents/skills/bundle-tool');
      await renameInstalledSkill(installedDir, 'bundle-tool');

      const md = await readFile(join(installedDir, 'SKILL.md'), 'utf-8');
      expect(md).toContain('name: bundle-tool');
      expect(md).toContain('description: test');
      expect(md).not.toContain('name: tool');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
