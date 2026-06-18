import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile, symlink } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { inferInstallModeForSkill } from '../src/installer.ts';

describe('install mode inference', () => {
  async function createSkillDir(path: string) {
    await mkdir(path, { recursive: true });
    await writeFile(join(path, 'SKILL.md'), '---\nname: legacy-skill\ndescription: Test\n---\n');
  }

  it('infers symlink mode from canonical storage and agent symlinks', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'install-mode-'));
    try {
      const canonical = join(dir, '.agents', 'skills', 'legacy-skill');
      const claude = join(dir, '.claude', 'skills', 'legacy-skill');
      const continuePath = join(dir, '.continue', 'skills', 'legacy-skill');
      await createSkillDir(canonical);
      await mkdir(join(dir, '.claude', 'skills'), { recursive: true });
      await mkdir(join(dir, '.continue', 'skills'), { recursive: true });
      await symlink(relative(join(dir, '.claude', 'skills'), canonical), claude, 'dir');
      await symlink(relative(join(dir, '.continue', 'skills'), canonical), continuePath, 'dir');

      await expect(
        inferInstallModeForSkill('legacy-skill', ['claude-code', 'continue'], { cwd: dir })
      ).resolves.toBe('symlink');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('infers copy mode from independent agent skill directories', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'install-mode-'));
    try {
      await createSkillDir(join(dir, '.claude', 'skills', 'legacy-skill'));
      await createSkillDir(join(dir, '.continue', 'skills', 'legacy-skill'));

      await expect(
        inferInstallModeForSkill('legacy-skill', ['claude-code', 'continue'], { cwd: dir })
      ).resolves.toBe('copy');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('keeps single target directory installs in copy mode', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'install-mode-'));
    try {
      await createSkillDir(join(dir, '.agents', 'skills', 'legacy-skill'));

      await expect(
        inferInstallModeForSkill('legacy-skill', ['codex', 'amp'], { cwd: dir })
      ).resolves.toBe('copy');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
