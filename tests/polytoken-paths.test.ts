import { describe, it, expect } from 'vitest';
import { join } from 'path';
import { homedir } from 'os';
import { agents, getAgentConfig } from '../src/agents.ts';

describe('polytoken paths', () => {
  const home = homedir();

  it('is registered as an agent', () => {
    expect('polytoken' in agents).toBe(true);
  });

  it('uses .polytoken/skills for project skills', () => {
    expect(getAgentConfig('polytoken').skillsDir).toBe('.polytoken/skills');
  });

  it('uses ~/.config/polytoken/skills for global skills', () => {
    const expected = join(home, '.config', 'polytoken', 'skills');
    expect(getAgentConfig('polytoken').globalSkillsDir).toBe(expected);
  });

  it('does not share the universal .agents/skills directory', () => {
    expect(getAgentConfig('polytoken').skillsDir).not.toBe('.agents/skills');
  });
});
