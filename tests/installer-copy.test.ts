import { describe, expect, it } from 'vitest';
import { access, chmod, mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { installBlobSkillForAgent, installSkillForAgent } from '../src/installer.ts';

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

  it('preserves executable mode bits when copying files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'add-skill-copy-mode-'));
    const projectDir = join(root, 'project');
    await mkdir(projectDir, { recursive: true });

    const skillName = 'copy-executable-skill';
    const skillDir = await makeSkillSource(root, skillName);
    const scriptPath = join(skillDir, 'scripts', 'hello.sh');
    await mkdir(join(skillDir, 'scripts'), { recursive: true });
    await writeFile(scriptPath, '#!/bin/sh\necho hello\n', 'utf-8');
    await chmod(scriptPath, 0o755);

    try {
      const result = await installSkillForAgent(
        { name: skillName, description: 'test', path: skillDir },
        'codex',
        { cwd: projectDir, mode: 'copy', global: false }
      );

      expect(result.success).toBe(true);

      const installedScript = join(projectDir, '.agents/skills', skillName, 'scripts', 'hello.sh');
      const sourceMode = (await stat(scriptPath)).mode & 0o777;
      const installedMode = (await stat(installedScript)).mode & 0o777;
      expect(installedMode).toBe(sourceMode);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('skips a project agent whose directory is missing (#2058)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'add-skill-copy-skip-'));
    const projectDir = join(root, 'project');
    await mkdir(projectDir, { recursive: true });
    const skillDir = await makeSkillSource(root, 'copy-skip-skill');

    try {
      const result = await installSkillForAgent(
        { name: 'copy-skip-skill', description: 'test', path: skillDir },
        'kiro-cli',
        { cwd: projectDir, mode: 'copy', global: false }
      );

      expect(result.success).toBe(true);
      expect(result.skipped).toBe(true);
      expect(result.skipReason).toBe('missing-agent-project-directory');
      await expect(access(join(projectDir, '.kiro'))).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('copies into a project agent directory that already exists', async () => {
    const root = await mkdtemp(join(tmpdir(), 'add-skill-copy-existing-'));
    const projectDir = join(root, 'project');
    await mkdir(join(projectDir, '.kiro'), { recursive: true });
    const skillDir = await makeSkillSource(root, 'copy-existing-skill');

    try {
      const result = await installSkillForAgent(
        { name: 'copy-existing-skill', description: 'test', path: skillDir },
        'kiro-cli',
        { cwd: projectDir, mode: 'copy', global: false }
      );

      expect(result.skipped).toBeUndefined();
      await expect(
        readFile(join(projectDir, '.kiro/skills/copy-existing-skill/SKILL.md'), 'utf-8')
      ).resolves.toContain('name: copy-existing-skill');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('creates the directory for an explicitly selected agent', async () => {
    const root = await mkdtemp(join(tmpdir(), 'add-skill-copy-explicit-'));
    const projectDir = join(root, 'project');
    await mkdir(projectDir, { recursive: true });
    const skillDir = await makeSkillSource(root, 'copy-explicit-skill');

    try {
      const result = await installSkillForAgent(
        { name: 'copy-explicit-skill', description: 'test', path: skillDir },
        'kiro-cli',
        { cwd: projectDir, mode: 'copy', global: false, createMissingAgentRoot: true }
      );

      expect(result.skipped).toBeUndefined();
      await expect(
        readFile(join(projectDir, '.kiro/skills/copy-explicit-skill/SKILL.md'), 'utf-8')
      ).resolves.toContain('name: copy-explicit-skill');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('skips a missing project agent directory for blob installs too', async () => {
    const root = await mkdtemp(join(tmpdir(), 'add-skill-copy-blob-skip-'));
    const projectDir = join(root, 'project');
    await mkdir(projectDir, { recursive: true });

    try {
      const result = await installBlobSkillForAgent(
        {
          installName: 'copy-blob-skill',
          files: [
            { path: 'SKILL.md', contents: '---\nname: copy-blob-skill\ndescription: test\n---\n' },
          ],
        },
        'kiro-cli',
        { cwd: projectDir, mode: 'copy', global: false }
      );

      expect(result.success).toBe(true);
      expect(result.skipped).toBe(true);
      await expect(access(join(projectDir, '.kiro'))).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
