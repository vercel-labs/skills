import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { findSkillMdPaths, type RepoTree } from '../src/blob.ts';
import { discoverSkills } from '../src/skills.ts';

describe('Grok Build agent support', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('uses .grok/skills and respects GROK_HOME for global skills', async () => {
    const grokHome = join(tmpdir(), 'custom-grok-home');
    vi.stubEnv('GROK_HOME', grokHome);

    const { agents } = await import('../src/agents.ts');

    expect(agents.grok.name).toBe('grok');
    expect(agents.grok.displayName).toBe('Grok Build');
    expect(agents.grok.skillsDir).toBe('.grok/skills');
    expect(agents.grok.globalSkillsDir).toBe(join(grokHome, 'skills'));
  });

  it('detects Grok Build from its resolved home directory', async () => {
    const grokHome = join(tmpdir(), `grok-home-${Date.now()}`);
    mkdirSync(grokHome);
    vi.stubEnv('GROK_HOME', grokHome);

    try {
      const { agents } = await import('../src/agents.ts');

      await expect(agents.grok.detectInstalled()).resolves.toBe(true);
    } finally {
      rmSync(grokHome, { recursive: true, force: true });
    }
  });

  it('returns false when the resolved Grok home does not exist', async () => {
    const grokHome = join(tmpdir(), `missing-grok-home-${Date.now()}`);
    vi.stubEnv('GROK_HOME', grokHome);

    const { agents } = await import('../src/agents.ts');

    await expect(agents.grok.detectInstalled()).resolves.toBe(false);
  });

  it('discovers grouped project skills under .grok/skills', async () => {
    const projectDir = join(tmpdir(), `grok-project-${Date.now()}`);
    const skillDir = join(projectDir, '.grok', 'skills', 'team', 'review');
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

  it('discovers grouped Grok project skills from remote repository trees', () => {
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
          path: '.grok/skills/team/review/SKILL.md',
          type: 'blob',
          sha: 'skill-sha',
        },
      ],
    };

    expect(findSkillMdPaths(tree).sort()).toEqual([
      '.grok/skills/team/review/SKILL.md',
      'skills/source/SKILL.md',
    ]);
  });
});
