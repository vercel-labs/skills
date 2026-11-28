import { homedir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('Pi agent support', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('installs into the universal .agents/skills directory', async () => {
    const { agents, isUniversalAgent } = await import('../src/agents.ts');

    expect(agents.pi.name).toBe('pi');
    expect(agents.pi.displayName).toBe('Pi');
    expect(agents.pi.skillsDir).toBe('.agents/skills');
    expect(agents.pi.globalSkillsDir).toBe(join(homedir(), '.agents', 'skills'));

    // Pi reads `~/.agents/skills/` and `.agents/skills/` (working directory up through its
    // ancestors) natively, so it must never receive an agent-specific mirror directory.
    expect(isUniversalAgent('pi')).toBe(true);
  });

  it('accepts pi as a valid --agent for skills use', async () => {
    const { parseUseOptions } = await import('../src/use.ts');

    const result = parseUseOptions(['vercel-labs/agent-skills', '--agent', 'pi']);

    expect(result.options.agent).toEqual(['pi']);
    expect(result.errors).toEqual([]);
  });

  it('targets Pi native skill directories when the PI_* env overrides are set', async () => {
    vi.stubEnv('PI_SKILLS_DIR', '.pi/skills');
    vi.stubEnv('PI_GLOBAL_SKILLS_DIR', join(homedir(), '.pi', 'agent', 'skills'));
    const { agents, isUniversalAgent } = await import('../src/agents.ts');

    expect(agents.pi.skillsDir).toBe('.pi/skills');
    expect(agents.pi.globalSkillsDir).toBe(join(homedir(), '.pi', 'agent', 'skills'));

    // Overridden dirs are no longer the canonical store, so Pi becomes a
    // non-universal target whose native directories symlink into it.
    expect(isUniversalAgent('pi')).toBe(false);
  });

  it('ignores blank PI_* env overrides', async () => {
    vi.stubEnv('PI_SKILLS_DIR', '   ');
    vi.stubEnv('PI_GLOBAL_SKILLS_DIR', '');
    const { agents, isUniversalAgent } = await import('../src/agents.ts');

    expect(agents.pi.skillsDir).toBe('.agents/skills');
    expect(agents.pi.globalSkillsDir).toBe(join(homedir(), '.agents', 'skills'));
    expect(isUniversalAgent('pi')).toBe(true);
  });
});
