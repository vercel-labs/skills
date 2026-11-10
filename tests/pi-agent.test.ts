import { homedir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('Pi agent support', () => {
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
});
