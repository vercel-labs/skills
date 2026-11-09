import { join } from 'path';
import { homedir } from 'os';
import { describe, it, expect } from 'vitest';
import { getAgentConfig, isUniversalAgent } from '../src/agents.ts';

describe('WorkBuddy agent paths', () => {
  it('installs into WorkBuddy’s own skill folders', () => {
    const config = getAgentConfig('workbuddy');

    expect(config.name).toBe('workbuddy');
    expect(config.displayName).toBe('WorkBuddy');
    expect(config.skillsDir).toBe('.workbuddy/skills');
    expect(config.globalSkillsDir).toBe(join(homedir(), '.workbuddy/skills'));
  });

  it('is not a universal agent, so it keeps its own global folder', () => {
    expect(isUniversalAgent('workbuddy')).toBe(false);
  });
});
