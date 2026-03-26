import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile, lstat, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { installSkillForAgent } from '../src/installer.ts';
import { agents, isUniversalAgent } from '../src/agents.ts';

describe('opencode agent configuration', () => {
  it('opencode should not be a universal agent', () => {
    expect(isUniversalAgent('opencode')).toBe(false);
  });

  it('opencode should have correct skillsDir', () => {
    expect(agents.opencode.skillsDir).toBe('.opencode/skills');
  });

  it('opencode skillsDir should differ from universal .agents/skills', () => {
    expect(agents.opencode.skillsDir).not.toBe('.agents/skills');
  });

  it('opencode globalSkillsDir should end with opencode/skills', () => {
    expect(agents.opencode.globalSkillsDir).toContain('opencode/skills');
  });
});

describe('opencode project-level installation', () => {
  it('creates symlink at .opencode/skills/<skill>', async () => {
    // Setup: create temp project dir and skill source
    const root = await mkdtemp(join(tmpdir(), 'opencode-test-'));
    const projectDir = join(root, 'project');
    await mkdir(projectDir, { recursive: true });

    const skillDir = join(root, 'source');
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, 'SKILL.md'), '---\nname: proj-skill\ndescription: test\n---', 'utf-8');

    try {
      // Install skill for opencode in project directory (non-global)
      const result = await installSkillForAgent(
        { name: 'proj-skill', description: 'test', path: skillDir },
        'opencode',
        { cwd: projectDir, mode: 'symlink', global: false }
      );

      expect(result.success).toBe(true);

      // Verify: symlink exists at .opencode/skills/<skill>
      const symlinkPath = join(projectDir, '.opencode/skills/proj-skill');
      const stats = await lstat(symlinkPath);
      expect(stats.isSymbolicLink()).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('copy mode installs directly without symlink', async () => {
    const root = await mkdtemp(join(tmpdir(), 'opencode-copy-'));
    const projectDir = join(root, 'project');
    await mkdir(projectDir, { recursive: true });

    const skillDir = join(root, 'source');
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, 'SKILL.md'), '---\nname: copy-skill\ndescription: test\n---', 'utf-8');

    try {
      // Copy mode: no symlinks, direct copy to agent dir
      const result = await installSkillForAgent(
        { name: 'copy-skill', description: 'test', path: skillDir },
        'opencode',
        { cwd: projectDir, mode: 'copy', global: false }
      );

      expect(result.success).toBe(true);
      expect(result.mode).toBe('copy');

      // Verify: no symlink, real directory at .opencode/skills/<skill>
      const skillPath = join(projectDir, '.opencode/skills/copy-skill');
      const stats = await lstat(skillPath);
      expect(stats.isDirectory()).toBe(true);
      expect(stats.isSymbolicLink()).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('opencode global-level installation', () => {
  it('installs to ~/.config/opencode/skills/', async () => {
    const root = await mkdtemp(join(tmpdir(), 'opencode-global-'));
    const homeDir = join(root, 'home');
    await mkdir(homeDir, { recursive: true });

    const skillDir = join(root, 'source');
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, 'SKILL.md'), '---\nname: global-skill\ndescription: test\n---', 'utf-8');

    try {
      // Global install for opencode
      const result = await installSkillForAgent(
        { name: 'global-skill', description: 'test', path: skillDir },
        'opencode',
        { mode: 'symlink', global: true }
      );

      expect(result.success).toBe(true);

      // Verify: skill is accessible at globalSkillsDir
      expect(result.path).toContain('.config/opencode/skills/global-skill');
      expect(result.canonicalPath).toContain('.agents/skills/global-skill');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
