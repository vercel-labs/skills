import { homedir } from 'os';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { agents, isExplytInstalled } from '../src/agents.ts';
import { findSkillMdPaths } from '../src/blob.ts';

describe('Explyt agent support', () => {
  it('uses the documented project and global skill directories', () => {
    const agent = agents.explyt;

    expect(agent.name).toBe('explyt');
    expect(agent.displayName).toBe('Explyt');
    expect(agent.skillsDir).toBe('.explyt/skills');
    expect(agent.globalSkillsDir).toBe(join(homedir(), '.explyt', 'skills'));
  });

  it('detects Explyt from its user configuration directory', () => {
    const home = '/tmp/home';
    const exists = (path: string) => path === join(home, '.explyt');

    expect(isExplytInstalled(home, exists)).toBe(true);
  });

  it('returns false when the Explyt configuration directory does not exist', () => {
    expect(isExplytInstalled('/tmp/home', () => false)).toBe(false);
  });

  it('discovers .explyt/skills through the GitHub tree fast path', () => {
    const discovered = findSkillMdPaths({
      sha: 'root-sha',
      branch: 'main',
      tree: [
        {
          path: '.claude/skills/standard-skill/SKILL.md',
          type: 'blob',
          sha: 'standard-sha',
        },
        {
          path: '.explyt/skills/explyt-skill/SKILL.md',
          type: 'blob',
          sha: 'explyt-sha',
        },
      ],
    });

    expect(discovered).toContain('.explyt/skills/explyt-skill/SKILL.md');
  });
});
