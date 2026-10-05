import { describe, expect, it } from 'vitest';
import {
  access,
  chmod,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
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

  it('skips a self-referential AAIF symlink instead of recursing (ENAMETOOLONG regression)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'add-skill-cycle-'));
    const projectDir = join(root, 'project');
    await mkdir(projectDir, { recursive: true });

    // .agents/skills/<name> -> ../.. : a self-symlink to the repo root that used to recurse forever.
    const skillName = 'cycle-skill';
    const skillDir = join(root, 'skill-root');
    await mkdir(join(skillDir, 'scripts'), { recursive: true });
    await writeFile(
      join(skillDir, 'SKILL.md'),
      `---\nname: ${skillName}\ndescription: test\n---\n`,
      'utf-8'
    );
    await writeFile(join(skillDir, 'scripts', 'run.sh'), '#!/bin/bash\necho hi\n', 'utf-8');
    await mkdir(join(skillDir, '.agents', 'skills'), { recursive: true });
    await symlink('../..', join(skillDir, '.agents', 'skills', skillName));

    try {
      const result = await installSkillForAgent(
        { name: skillName, description: 'test', path: skillDir },
        'codex',
        { cwd: projectDir, mode: 'copy', global: false }
      );

      expect(result.success).toBe(true);

      const installedDir = join(projectDir, '.agents/skills', skillName);
      await expect(access(join(installedDir, 'SKILL.md'))).resolves.toBeUndefined();
      await expect(access(join(installedDir, 'scripts', 'run.sh'))).resolves.toBeUndefined();
      await expect(access(join(installedDir, '.agents', 'skills', skillName))).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
