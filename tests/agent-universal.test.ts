import { describe, expect, it } from 'vitest';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  agents,
  getNonUniversalAgents,
  getUniversalAgents,
  isUniversalAgent,
} from '../src/agents.ts';
import { getAgentBaseDir } from '../src/installer.ts';

describe('scope-aware universal agent classification', () => {
  it('keeps project-level universal agents separate from global universal agents', () => {
    expect(isUniversalAgent('amp')).toBe(true);
    expect(isUniversalAgent('antigravity')).toBe(true);

    expect(isUniversalAgent('amp', { global: true })).toBe(false);
    expect(isUniversalAgent('antigravity', { global: true })).toBe(false);
    expect(isUniversalAgent('cline', { global: true })).toBe(true);
  });

  it('uses agent-specific global directories for agents that only share project .agents/skills', () => {
    const projectDir = join(homedir(), 'example-project');

    expect(getAgentBaseDir('amp', false, projectDir)).toBe(join(projectDir, '.agents', 'skills'));
    expect(getAgentBaseDir('amp', true, projectDir)).toBe(agents.amp.globalSkillsDir);
    expect(getAgentBaseDir('antigravity', true, projectDir)).toBe(
      agents.antigravity.globalSkillsDir
    );
  });

  it('builds universal agent lists for the selected install scope', () => {
    expect(getUniversalAgents()).toContain('amp');
    expect(getUniversalAgents({ global: true })).not.toContain('amp');
    expect(getUniversalAgents({ global: true })).not.toContain('antigravity');
    expect(getUniversalAgents({ global: true })).toContain('cline');

    expect(getNonUniversalAgents({ global: true })).toContain('amp');
    expect(getNonUniversalAgents({ global: true })).toContain('antigravity');
    expect(getNonUniversalAgents({ global: true })).not.toContain('universal');
  });
});
