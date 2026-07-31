import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { homedir, tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { agents, isOhMyPiInstalled } from '../src/agents.ts';
import { findSkillMdPaths, type RepoTree } from '../src/blob.ts';
import { discoverSkills } from '../src/skills.ts';

describe('Oh My Pi agent support', () => {
  it('uses the documented OMP project and global skill directories', () => {
    expect(agents.omp.name).toBe('omp');
    expect(agents.omp.displayName).toBe('Oh My Pi');
    expect(agents.omp.skillsDir).toBe('.omp/skills');
    expect(agents.omp.globalSkillsDir).toBe(join(homedir(), '.omp', 'agent', 'skills'));
  });

  it('detects Oh My Pi from its agent directory', () => {
    const home = '/tmp/home';
    const exists = (path: string) => path === join(home, '.omp', 'agent');

    expect(isOhMyPiInstalled(home, exists)).toBe(true);
  });

  it('returns false when the Oh My Pi agent directory does not exist', () => {
    expect(isOhMyPiInstalled('/tmp/home', () => false)).toBe(false);
  });

  it('discovers grouped project skills under .omp/skills', async () => {
    const projectDir = join(tmpdir(), `omp-project-${Date.now()}`);
    const skillDir = join(projectDir, '.omp', 'skills', 'team', 'review');
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

  it('discovers grouped OMP project skills from remote repository trees', () => {
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
          path: '.omp/skills/team/review/SKILL.md',
          type: 'blob',
          sha: 'skill-sha',
        },
      ],
    };

    expect(findSkillMdPaths(tree).sort()).toEqual([
      '.omp/skills/team/review/SKILL.md',
      'skills/source/SKILL.md',
    ]);
  });
});
