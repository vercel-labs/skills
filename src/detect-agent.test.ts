import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Env vars read by @vercel/detect-agent. Cleared before each test so the suite
// still passes when it is itself run inside an AI agent (e.g. Claude Code, Codex).
const AGENT_ENV_VARS = [
  'AI_AGENT',
  'ANTIGRAVITY_AGENT',
  'AUGMENT_AGENT',
  'CLAUDECODE',
  'CLAUDE_CODE',
  'CLAUDE_CODE_IS_COWORK',
  'CODEX_CI',
  'CODEX_SANDBOX',
  'CODEX_THREAD_ID',
  'COPILOT_ALLOW_ALL',
  'COPILOT_GITHUB_TOKEN',
  'COPILOT_MODEL',
  'CURSOR_AGENT',
  'CURSOR_EXTENSION_HOST_ROLE',
  'CURSOR_TRACE_ID',
  'GEMINI_CLI',
  'OPENCODE_CLIENT',
  'REPL_ID',
];

describe('detectAgent', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    for (const name of AGENT_ENV_VARS) {
      vi.stubEnv(name, undefined);
    }
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
});
