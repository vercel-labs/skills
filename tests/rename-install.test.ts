import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  installSkillForAgent,
  installRemoteSkillForAgent,
  installWellKnownSkillForAgent,
} from '../src/installer.ts';

describe('rename install behavior', () => {
  it('renames local skill directory and SKILL.md frontmatter', async () => {
    const root = await mkdtemp(join(tmpdir(), 'skills-rename-local-'));
    const sourceDir = join(root, 'source-skill');
    const projectDir = join(root, 'project');

    await mkdir(sourceDir, { recursive: true });
    await mkdir(projectDir, { recursive: true });
    await writeFile(
      join(sourceDir, 'SKILL.md'),
      `---\nname: original-local\ndescription: Local skill\n---\n\n# Local\n`,
      'utf-8'
    );

    try {
      const result = await installSkillForAgent(
        { name: 'original-local', description: 'Local skill', path: sourceDir },
        'amp',
        {
          cwd: projectDir,
          global: false,
          mode: 'symlink',
          renameTo: 'renamed-local',
        }
      );

      expect(result.success).toBe(true);
      const installedPath = join(projectDir, '.agents', 'skills', 'renamed-local', 'SKILL.md');
      const content = await readFile(installedPath, 'utf-8');
      expect(content).toContain('name: renamed-local');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('renames remote skill directory and SKILL.md frontmatter', async () => {
    const root = await mkdtemp(join(tmpdir(), 'skills-rename-remote-'));

    try {
      const result = await installRemoteSkillForAgent(
        {
          name: 'Remote Original',
          description: 'Remote skill',
          content: `---\nname: remote-original\ndescription: Remote skill\n---\n\n# Remote\n`,
          installName: 'remote-original',
          sourceUrl: 'https://example.com/skill.md',
          providerId: 'mintlify',
          sourceIdentifier: 'mintlify/com',
        },
        'amp',
        {
          cwd: root,
          global: false,
          mode: 'symlink',
          renameTo: 'renamed-remote',
        }
      );

      expect(result.success).toBe(true);
      const installedPath = join(root, '.agents', 'skills', 'renamed-remote', 'SKILL.md');
      const content = await readFile(installedPath, 'utf-8');
      expect(content).toContain('name: renamed-remote');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('renames well-known skill directory and SKILL.md frontmatter', async () => {
    const root = await mkdtemp(join(tmpdir(), 'skills-rename-wellknown-'));

    const skillMd = `---\nname: original-well-known\ndescription: Well-known skill\n---\n\n# Well Known\n`;

    try {
      const result = await installWellKnownSkillForAgent(
        {
          name: 'Well Known Original',
          description: 'Well-known skill',
          content: skillMd,
          installName: 'original-well-known',
          sourceUrl: 'https://example.com/.well-known/skills/original/SKILL.md',
          files: new Map([
            ['SKILL.md', skillMd],
            ['README.md', 'Additional docs'],
          ]),
          indexEntry: {
            name: 'original-well-known',
            description: 'Well-known skill',
            files: ['SKILL.md', 'README.md'],
          },
        },
        'amp',
        {
          cwd: root,
          global: false,
          mode: 'symlink',
          renameTo: 'renamed-well-known',
        }
      );

      expect(result.success).toBe(true);
      const skillPath = join(root, '.agents', 'skills', 'renamed-well-known', 'SKILL.md');
      const readmePath = join(root, '.agents', 'skills', 'renamed-well-known', 'README.md');

      const content = await readFile(skillPath, 'utf-8');
      expect(content).toContain('name: renamed-well-known');
      await expect(stat(readmePath)).resolves.toBeDefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
