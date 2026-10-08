import { describe, expect, it, vi } from 'vitest';
import { runCli, runCliWithInput, stripLogo } from './test-utils.ts';

describe('CLI test environment', () => {
  it('does not inherit the parent agent environment in runCli', () => {
    vi.stubEnv('CODEX_SANDBOX', 'sandboxed');

    try {
      const result = runCli([]);

      expect(stripLogo(result.stdout)).toContain('The open agent skills ecosystem');
      expect(result.exitCode).toBe(0);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('does not inherit the parent agent environment in runCliWithInput', () => {
    vi.stubEnv('CODEX_SANDBOX', 'sandboxed');

    try {
      const result = runCliWithInput([], '');

      expect(stripLogo(result.stdout)).toContain('The open agent skills ecosystem');
      expect(result.exitCode).toBe(0);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('allows tests to opt in to agent mode explicitly', () => {
    const result = runCli([], undefined, { AI_AGENT: 'codex' });

    expect(result.stdout).toBe('');
    expect(result.exitCode).toBe(0);
  });
});
