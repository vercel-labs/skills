import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { findSkillMdPaths, type RepoTree } from '../src/blob.ts';
import { discoverSkills } from '../src/skills.ts';

describe('Aster agent support', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('uses .aster/skills and respects XDG_DATA_HOME for global skills', async () => {
    const dataHome = join(tmpdir(), 'custom-xdg-data-home');
    vi.stubEnv('XDG_DATA_HOME', dataHome);

    const { agents } = await import('../src/agents.ts');

    expect(agents.aster.name).toBe('aster');
    expect(agents.aster.displayName).toBe('Aster');
    expect(agents.aster.skillsDir).toBe('.aster/skills');
    expect(agents.aster.globalSkillsDir).toBe(join(dataHome, 'aster/skills'));
  });

  it('detects Aster from its resolved data directory', async () => {
    const dataHome = join(tmpdir(), `aster-data-home-${Date.now()}`);
    mkdirSync(join(dataHome, 'aster'), { recursive: true });
    vi.stubEnv('XDG_DATA_HOME', dataHome);

    try {
      const { agents } = await import('../src/agents.ts');

      await expect(agents.aster.detectInstalled()).resolves.toBe(true);
    } finally {
      rmSync(dataHome, { recursive: true, force: true });
    }
  });

  it('returns false when the resolved Aster data directory does not exist', async () => {
    const dataHome = join(tmpdir(), `missing-aster-data-home-${Date.now()}`);
    vi.stubEnv('XDG_DATA_HOME', dataHome);

    const { agents } = await import('../src/agents.ts');

    await expect(agents.aster.detectInstalled()).resolves.toBe(false);
  });

  it('discovers grouped project skills under .aster/skills', async () => {
    const projectDir = join(tmpdir(), `aster-project-${Date.now()}`);
    const skillDir = join(projectDir, '.aster', 'skills', 'team', 'review');
    const sourceSkillDir = join(projectDir, 'skills', 'source');
    mkdirSync(skillDir, { recursive: true });
    mkdirSync(sourceSkillDir, { recursive: true });
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      '---\nname: review\ndescription: Review code changes.\n---\n\n# Review\n'
    );
    writeFileSync(
      join(sourceSkillDir, 'SKILL.md'),
      '---\nname: source\ndescription: Source skill.\n---\n\n# Source\n'
    );

    try {
      const skills = await discoverSkills(projectDir);

      expect(skills.map((skill) => skill.name).sort()).toEqual(['review', 'source']);
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it('discovers grouped Aster project skills from remote repository trees', () => {
    const tree: RepoTree = {
      sha: 'root-sha',
      branch: 'main',
      tree: [
        {
          path: 'skills/source/SKILL.md',
          type: 'blob',
          sha: 'source-skill-sha',
        },
        {
          path: '.aster/skills/team/review/SKILL.md',
          type: 'blob',
          sha: 'skill-sha',
        },
      ],
    };

    expect(findSkillMdPaths(tree).sort()).toEqual([
      '.aster/skills/team/review/SKILL.md',
      'skills/source/SKILL.md',
    ]);
  });
});
