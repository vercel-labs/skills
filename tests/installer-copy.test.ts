import { describe, expect, it } from 'vitest';
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
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

  it('honors explicit file includes from SKILL.md frontmatter', async () => {
    const root = await mkdtemp(join(tmpdir(), 'add-skill-files-'));
    const projectDir = join(root, 'project');
    await mkdir(projectDir, { recursive: true });

    const skillName = 'explicit-files-skill';
    const skillDir = join(root, 'source-skill');
    await mkdir(join(skillDir, 'scripts'), { recursive: true });
    await mkdir(join(skillDir, 'templates'), { recursive: true });
    await mkdir(join(skillDir, 'docs'), { recursive: true });
    await writeFile(
      join(skillDir, 'SKILL.md'),
      `---
      name: ${skillName}
      description: test
      files:
        - scripts/
        - templates/card.md
        - "!scripts/dev-only.js"
      ---
      # Skill
      `,
      'utf-8'
    );
    await writeFile(join(skillDir, 'scripts', 'run.js'), 'run\n', 'utf-8');
    await writeFile(join(skillDir, 'scripts', 'dev-only.js'), 'dev\n', 'utf-8');
    await writeFile(join(skillDir, 'templates', 'card.md'), '# Card\n', 'utf-8');
    await writeFile(join(skillDir, 'templates', 'card.txt'), 'Card\n', 'utf-8');
    await writeFile(join(skillDir, 'docs', 'README.md'), '# Docs\n', 'utf-8');

    try {
      const result = await installSkillForAgent(
        {
          name: skillName,
          description: 'test',
          path: skillDir,
          fileIncludes: ['scripts/', 'templates/card.md', '!scripts/dev-only.js'],
        },
        'codex',
        { cwd: projectDir, mode: 'copy', global: false }
      );

      expect(result.success).toBe(true);

      const installedDir = join(projectDir, '.agents/skills', skillName);
      await expect(readFile(join(installedDir, 'SKILL.md'), 'utf-8')).resolves.toContain(
        'explicit-files-skill'
      );
      await expect(readFile(join(installedDir, 'scripts', 'run.js'), 'utf-8')).resolves.toBe(
        'run\n'
      );
      await expect(readFile(join(installedDir, 'templates', 'card.md'), 'utf-8')).resolves.toBe(
        '# Card\n'
      );
      await expect(access(join(installedDir, 'scripts', 'dev-only.js'))).rejects.toThrow();
      await expect(access(join(installedDir, 'templates', 'card.txt'))).rejects.toThrow();
      await expect(access(join(installedDir, 'docs'))).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
