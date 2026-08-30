import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('detectAgent – Prime Agent', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    // Clear any Jcode env signals that could interfere.
    vi.stubEnv('JCODE_NON_INTERACTIVE', '');
    vi.stubEnv('JCODE_ACTIVE_PROVIDER', '');
    vi.stubEnv('JCODE_SESSION_ID', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('detects Prime Agent from its config directory environment variable', async () => {
    // Simulate Prime Agent setting its config directory variable.
    vi.stubEnv('PRIME_AGENT_CODING_AGENT_DIR', '/tmp/prime-agent-config');

    const { detectAgent, getAgentType } = await import('./detect-agent.ts');
    const result = await detectAgent();

    expect(result.isAgent).toBe(true);
    expect(result.agent?.name).toBe('prime');
    // Verify the mapping function works for the prime name.
    expect(getAgentType('prime')).toBe('prime');
  });
});
