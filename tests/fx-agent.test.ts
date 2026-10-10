import { homedir } from 'os';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import {
  agents,
  getNonUniversalAgents,
  getUniversalAgents,
  getVisibleUniversalAgents,
} from '../src/agents.ts';

describe('fx agent support', () => {
  it('uses the shared project and global roots that fx discovers natively', () => {
    // https://fx.sh/docs/capabilities/skills#discovery-roots
    expect(agents.fx.skillsDir).toBe('.agents/skills');
    expect(agents.fx.globalSkillsDir).toBe(join(homedir(), '.agents/skills'));
  });

  it('shows fx in the main locked install section instead of the other agents list', () => {
    expect(getUniversalAgents()).toContain('fx');
    expect(getVisibleUniversalAgents()).toContain('fx');
    expect(getNonUniversalAgents()).not.toContain('fx');
  });
});
