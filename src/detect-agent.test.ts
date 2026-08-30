import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('detectAgent', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.stubEnv('JCODE_NON_INTERACTIVE', '');
    vi.stubEnv('JCODE_ACTIVE_PROVIDER', '');
    vi.stubEnv('JCODE_SESSION_ID', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('does not treat Cursor integrated terminal (CURSOR_TRACE_ID only) as agent', async () => {
    vi.stubEnv('CURSOR_TRACE_ID', 'trace-123');
    vi.stubEnv('CURSOR_AGENT', '');
    vi.stubEnv('CURSOR_EXTENSION_HOST_ROLE', '');

    const { detectAgent } = await import('./detect-agent.ts');
    const result = await detectAgent();

    expect(result.isAgent).toBe(false);
  });

  it('treats Cursor agent execution (CURSOR_AGENT) as agent', async () => {
    vi.stubEnv('CURSOR_TRACE_ID', 'trace-123');
    vi.stubEnv('CURSOR_AGENT', '1');

    const { detectAgent } = await import('./detect-agent.ts');
    const result = await detectAgent();

    expect(result.isAgent).toBe(true);
    expect(result.agent?.name).toBe('cursor-cli');
  });

  it('treats Cursor agent execution (agent-exec role) as agent', async () => {
    vi.stubEnv('CURSOR_TRACE_ID', 'trace-123');
    vi.stubEnv('CURSOR_EXTENSION_HOST_ROLE', 'agent-exec');

    const { detectAgent } = await import('./detect-agent.ts');
    const result = await detectAgent();

    expect(result.isAgent).toBe(true);
    expect(result.agent?.name).toBe('cursor-cli');
  });

  it('detects Jcode from its non-interactive environment signal', async () => {
    vi.stubEnv('JCODE_NON_INTERACTIVE', '1');

    const { detectAgent, getAgentType } = await import('./detect-agent.ts');
    const result = await detectAgent();

    expect(result.isAgent).toBe(true);
    expect(result.agent?.name).toBe('jcode');
    expect(getAgentType('jcode')).toBe('jcode');
  });
});
