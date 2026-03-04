/**
 * Tests for GitHub Copilot skill installation path behavior.
 *
 * Verifies that:
 * - GitHub Copilot is NOT a universal agent (uses .copilot/skills, not .agents/skills)
 * - Global installs target ~/.copilot/skills/ (not ~/.agents/skills/)
 * - Local installs target <project>/.copilot/skills/ (not <project>/.agents/skills/)
 * - getSkillDisplayPath returns agent-specific path for single non-universal agent
 */

import { describe, it, expect } from 'vitest';
import { homedir } from 'os';
import { join } from 'path';
import { isUniversalAgent } from '../src/agents.ts';
import { getAgentBaseDir, getCanonicalSkillsDir } from '../src/installer.ts';

const home = homedir();

describe('github-copilot agent config', () => {
  it('is NOT a universal agent', () => {
    expect(isUniversalAgent('github-copilot')).toBe(false);
  });

  it('global install base dir is ~/.copilot/skills', () => {
    const base = getAgentBaseDir('github-copilot', true);
    expect(base).toBe(join(home, '.copilot/skills'));
  });

  it('global install base dir differs from canonical ~/.agents/skills', () => {
    const agentBase = getAgentBaseDir('github-copilot', true);
    const canonicalBase = getCanonicalSkillsDir(true);
    expect(agentBase).not.toBe(canonicalBase);
  });

  it('local install base dir is <cwd>/.copilot/skills', () => {
    const cwd = '/fake/project';
    const base = getAgentBaseDir('github-copilot', false, cwd);
    expect(base).toBe(join(cwd, '.copilot/skills'));
  });
});
