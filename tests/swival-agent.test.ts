import { describe, it, expect } from 'vitest';
import { join } from 'path';
import { homedir, tmpdir } from 'os';
import { agents, isUniversalAgent } from '../src/agents.ts';
import { getAgentBaseDir } from '../src/installer.ts';

describe('Swival agent', () => {
  it('is a universal agent (uses .agents/skills)', () => {
    expect(agents.swival.skillsDir).toBe('.agents/skills');
    expect(isUniversalAgent('swival')).toBe(true);
  });

  it('uses ~/.agents/skills for global skills', () => {
    expect(agents.swival.globalSkillsDir).toBe(join(homedir(), '.agents', 'skills'));
  });

  it('project install uses canonical .agents/skills path', () => {
    const projectDir = join(tmpdir(), 'swival-test-project');
    expect(getAgentBaseDir('swival', false, projectDir)).toBe(
      join(projectDir, '.agents', 'skills')
    );
  });

  it('global install uses canonical ~/.agents/skills path', () => {
    expect(getAgentBaseDir('swival', true)).toBe(join(homedir(), '.agents', 'skills'));
  });
});
