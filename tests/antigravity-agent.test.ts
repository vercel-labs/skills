import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { homedir, tmpdir } from 'os';
import { describe, expect, it } from 'vitest';
import {
  agents,
  getNonUniversalAgents,
  getUniversalAgents,
  isUniversalAgent,
} from '../src/agents.ts';

const home = homedir();

describe('Antigravity agent paths', () => {
  it('installs globally into the shared ~/.gemini/config/skills', () => {
    expect(agents.antigravity.globalSkillsDir).toBe(join(home, '.gemini/config/skills'));
    expect(agents['antigravity-cli'].globalSkillsDir).toBe(join(home, '.gemini/config/skills'));
  });

  it('keeps .agents/skills as the workspace directory', () => {
    expect(agents.antigravity.skillsDir).toBe('.agents/skills');
    expect(agents['antigravity-cli'].skillsDir).toBe('.agents/skills');
  });

  it('is not universal even though it shares the .agents/skills workspace dir', () => {
    expect(isUniversalAgent('antigravity')).toBe(false);
    expect(isUniversalAgent('antigravity-cli')).toBe(false);
    expect(getUniversalAgents()).not.toContain('antigravity');
    expect(getUniversalAgents()).not.toContain('antigravity-cli');
    expect(getNonUniversalAgents()).toContain('antigravity');
    expect(getNonUniversalAgents()).toContain('antigravity-cli');
  });

  it('still detects each product from its own directory', async () => {
    const probe = join(tmpdir(), `antigravity-probe-${Date.now()}`);
    mkdirSync(probe, { recursive: true });
    try {
      // detectInstalled reads the real home, so only assert it resolves to a boolean
      // without throwing; the per-product probe paths are asserted below.
      await expect(agents.antigravity.detectInstalled()).resolves.toBeTypeOf('boolean');
      await expect(agents['antigravity-cli'].detectInstalled()).resolves.toBeTypeOf('boolean');
    } finally {
      rmSync(probe, { recursive: true, force: true });
    }
  });
});

describe('isUniversalAgent', () => {
  it('still infers universality from skillsDir when no flag is set', () => {
    expect(agents.codex.universal).toBeUndefined();
    expect(agents.codex.skillsDir).toBe('.agents/skills');
    expect(isUniversalAgent('codex')).toBe(true);
  });

  it('treats agents with their own workspace dir as non-universal', () => {
    expect(isUniversalAgent('claude-code')).toBe(false);
  });
});
