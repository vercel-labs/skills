import { describe, expect, it } from 'vitest';
import { access, chmod, mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  createInstallSession,
  installBlobSkillForAgent,
  installSkillForAgent,
} from '../src/installer.ts';

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

  it('writes a shared copy destination once per install session', async () => {
    const root = await mkdtemp(join(tmpdir(), 'add-skill-copy-once-'));
    const projectDir = join(root, 'project');
    await mkdir(projectDir, { recursive: true });

    const skillName = 'shared-copy-skill';
    const skillDir = await makeSkillSource(root, skillName);
    const skill = { name: skillName, description: 'test', path: skillDir };
    const session = createInstallSession();
    const installedDir = join(projectDir, '.agents/skills', skillName);
    const markerPath = join(installedDir, 'written-once.txt');

    try {
      const codexResult = await installSkillForAgent(skill, 'codex', {
        cwd: projectDir,
        mode: 'copy',
        global: false,
        session,
      });
      expect(codexResult.success).toBe(true);

      await writeFile(markerPath, 'preserved\n', 'utf-8');

      const cursorResult = await installSkillForAgent(skill, 'cursor', {
        cwd: projectDir,
        mode: 'copy',
        global: false,
        session,
      });
      expect(cursorResult.success).toBe(true);
      await expect(readFile(markerPath, 'utf-8')).resolves.toBe('preserved\n');

      const freshSessionResult = await installSkillForAgent(skill, 'amp', {
        cwd: projectDir,
        mode: 'copy',
        global: false,
        session: createInstallSession(),
      });
      expect(freshSessionResult.success).toBe(true);
      await expect(access(markerPath)).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('writes a shared blob destination once per install session', async () => {
    const root = await mkdtemp(join(tmpdir(), 'add-blob-copy-once-'));
    const projectDir = join(root, 'project');
    await mkdir(projectDir, { recursive: true });

    const skillName = 'shared-blob-skill';
    const skill = {
      installName: skillName,
      files: [
        {
          path: 'SKILL.md',
          contents: `---\nname: ${skillName}\ndescription: test\n---\n`,
        },
      ],
    };
    const session = createInstallSession();
    const installedDir = join(projectDir, '.agents/skills', skillName);
    const markerPath = join(installedDir, 'written-once.txt');

    try {
      const codexResult = await installBlobSkillForAgent(skill, 'codex', {
        cwd: projectDir,
        mode: 'copy',
        global: false,
        session,
      });
      expect(codexResult.success).toBe(true);

      await writeFile(markerPath, 'preserved\n', 'utf-8');

      const cursorResult = await installBlobSkillForAgent(skill, 'cursor', {
        cwd: projectDir,
        mode: 'copy',
        global: false,
        session,
      });
      expect(cursorResult.success).toBe(true);
      await expect(readFile(markerPath, 'utf-8')).resolves.toBe('preserved\n');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
