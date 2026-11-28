import { homedir } from 'os';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import {
  agents,
  getNonUniversalAgents,
  getUniversalAgents,
  getVisibleUniversalAgents,
} from '../src/agents.ts';

describe('deepseek-harness agent support', () => {
  it('uses the shared project and global roots that dsh discovers natively', () => {
    // https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/skills.md
    expect(agents['deepseek-harness'].skillsDir).toBe('.agents/skills');
    expect(agents['deepseek-harness'].globalSkillsDir).toBe(join(homedir(), '.agents', 'skills'));
  });

  it('shows deepseek-harness in the main locked install section', () => {
    expect(getUniversalAgents()).toContain('deepseek-harness');
    expect(getVisibleUniversalAgents()).toContain('deepseek-harness');
    expect(getNonUniversalAgents()).not.toContain('deepseek-harness');
  });
});
