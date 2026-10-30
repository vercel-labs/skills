import { mkdtempSync, rmSync } from 'fs';
import { randomUUID } from 'crypto';
import { homedir, tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('min-agent agent support', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('installs into the universal .agents/skills directory', async () => {
    const { agents, getNonUniversalAgents, getUniversalAgents, isUniversalAgent } =
      await import('../src/agents.ts');

    expect(agents['min-agent'].name).toBe('min-agent');
    expect(agents['min-agent'].displayName).toBe('min-agent');
    // min-agent reads `.agents/skills/` (project) and `~/.agents/skills/` (global)
    // natively, so it must never receive an agent-specific mirror directory.
    expect(agents['min-agent'].skillsDir).toBe('.agents/skills');
    expect(agents['min-agent'].globalSkillsDir).toBe(join(homedir(), '.agents', 'skills'));
    expect(isUniversalAgent('min-agent')).toBe(true);
    expect(getUniversalAgents()).toContain('min-agent');
    expect(getNonUniversalAgents()).not.toContain('min-agent');
  });

  it('detects min-agent from its resolved config directory', async () => {
    const minAgentHome = mkdtempSync(join(tmpdir(), 'min-agent-home-'));
    vi.stubEnv('MIN_AGENT_CONFIG_DIR', minAgentHome);

    try {
      const { agents } = await import('../src/agents.ts');

      await expect(agents['min-agent'].detectInstalled()).resolves.toBe(true);
    } finally {
      rmSync(minAgentHome, { recursive: true, force: true });
    }
  });

  it('returns false when the resolved min-agent config directory does not exist', async () => {
    const minAgentHome = join(tmpdir(), `missing-min-agent-home-${randomUUID()}`);
    vi.stubEnv('MIN_AGENT_CONFIG_DIR', minAgentHome);

    const { agents } = await import('../src/agents.ts');

    await expect(agents['min-agent'].detectInstalled()).resolves.toBe(false);
  });

  it('accepts min-agent as a valid --agent for skills use', async () => {
    const { parseUseOptions } = await import('../src/use.ts');

    const result = parseUseOptions(['vercel-labs/agent-skills', '--agent', 'min-agent']);

    expect(result.options.agent).toEqual(['min-agent']);
    expect(result.errors).toEqual([]);
  });
});
