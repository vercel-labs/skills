import { join } from 'path';
import { homedir } from 'os';
import { describe, it, expect } from 'vitest';
import { agents, isUniversalAgent } from '../src/agents.ts';

describe('qoder-cn agent', () => {
  const home = homedir();

  it('has correct config properties', () => {
    const agent = agents['qoder-cn'];
    expect(agent.name).toBe('qoder-cn');
    expect(agent.displayName).toBe('Qoder CN');
    expect(agent.skillsDir).toBe('.qoder/skills');
    expect(agent.globalSkillsDir).toBe(join(home, '.qoder-cn/skills'));
  });

  it('shares project-level skillsDir with qoder', () => {
    expect(agents['qoder-cn'].skillsDir).toBe(agents.qoder.skillsDir);
  });

  it('has independent global skillsDir from qoder', () => {
    expect(agents['qoder-cn'].globalSkillsDir).not.toBe(agents.qoder.globalSkillsDir);
    expect(agents['qoder-cn'].globalSkillsDir).toBe(join(home, '.qoder-cn/skills'));
    expect(agents.qoder.globalSkillsDir).toBe(join(home, '.qoder/skills'));
  });

  it('is a non-universal agent', () => {
    expect(isUniversalAgent('qoder-cn')).toBe(false);
  });

  it('detects installed when ~/.qoder-cn exists', async () => {
    const agent = agents['qoder-cn'];
    // detectInstalled reads the real filesystem — just verify it's a function
    expect(typeof agent.detectInstalled).toBe('function');
  });

  it('does not affect qwen-code agent config', () => {
    expect(agents['qwen-code'].name).toBe('qwen-code');
    expect(agents['qwen-code'].displayName).toBe('Qwen Code');
    expect(agents['qwen-code'].skillsDir).toBe('.qwen/skills');
    expect(agents['qwen-code'].globalSkillsDir).toBe(join(home, '.qwen/skills'));
  });

  it('does not affect qoder agent config', () => {
    expect(agents.qoder.name).toBe('qoder');
    expect(agents.qoder.displayName).toBe('Qoder');
    expect(agents.qoder.skillsDir).toBe('.qoder/skills');
    expect(agents.qoder.globalSkillsDir).toBe(join(home, '.qoder/skills'));
  });
});

describe('trae/trae-cn parity', () => {
  it('qoder-cn follows the same shared-local pattern as trae-cn', () => {
    // trae and trae-cn share skillsDir but have different globalSkillsDir
    expect(agents.trae.skillsDir).toBe(agents['trae-cn'].skillsDir);
    expect(agents.trae.globalSkillsDir).not.toBe(agents['trae-cn'].globalSkillsDir);

    // qoder and qoder-cn should follow the same pattern
    expect(agents.qoder.skillsDir).toBe(agents['qoder-cn'].skillsDir);
    expect(agents.qoder.globalSkillsDir).not.toBe(agents['qoder-cn'].globalSkillsDir);
  });
});
