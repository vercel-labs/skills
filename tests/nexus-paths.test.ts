/**
 * Nexus Code reads Agent Skills from the shared `.agents/skills` (project) and
 * `~/.agents/skills` (global) directories, so it is registered as a universal agent.
 */

import { describe, it, expect } from 'vitest';
import { homedir } from 'os';
import { join } from 'path';
import { agents, getUniversalAgents, isUniversalAgent } from '../src/agents.ts';
import { getAgentBaseDir } from '../src/installer.ts';

describe('Nexus Code agent', () => {
  it('is registered as "nexus" with display name "Nexus Code"', () => {
    expect(agents.nexus.name).toBe('nexus');
    expect(agents.nexus.displayName).toBe('Nexus Code');
  });

  it('uses the universal .agents/skills project directory', () => {
    expect(agents.nexus.skillsDir).toBe('.agents/skills');
    expect(isUniversalAgent('nexus')).toBe(true);
    expect(getUniversalAgents()).toContain('nexus');
  });

  it('uses ~/.agents/skills for global installs', () => {
    expect(agents.nexus.globalSkillsDir).toBe(join(homedir(), '.agents', 'skills'));
    expect(getAgentBaseDir('nexus', true)).toBe(join(homedir(), '.agents', 'skills'));
  });

  it('installs project skills into <cwd>/.agents/skills', () => {
    const cwd = join('/', 'tmp', 'project');
    expect(getAgentBaseDir('nexus', false, cwd)).toBe(join(cwd, '.agents', 'skills'));
  });
});
