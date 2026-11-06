import { describe, expect, it, vi } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTestHomeEnvironment, runCli, runCliWithInput, stripLogo } from './test-utils.ts';

describe('CLI test environment', () => {
  it('redirects Grok and Sarvam home overrides into the test home', () => {
    const home = join(tmpdir(), 'isolated-skills-home');
    expect(createTestHomeEnvironment(home)).toMatchObject({
      GROK_HOME: join(home, '.grok'),
      SARVAM_HOME: join(home, '.sarvam'),
    });
  });

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
