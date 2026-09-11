import { mkdirSync, rmSync } from 'fs';
import { homedir, tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('Sarvam Code agent support', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('installs into the universal .agents/skills directory', async () => {
    const { agents, isUniversalAgent } = await import('../src/agents.ts');

    expect(agents['sarvam-code'].name).toBe('sarvam-code');
    expect(agents['sarvam-code'].displayName).toBe('Sarvam Code');
    expect(agents['sarvam-code'].skillsDir).toBe('.agents/skills');
    expect(agents['sarvam-code'].globalSkillsDir).toBe(join(homedir(), '.agents', 'skills'));
    expect(isUniversalAgent('sarvam-code')).toBe(true);
  });

  it('detects Sarvam Code from its resolved home directory', async () => {
    const sarvamHome = join(tmpdir(), `sarvam-home-${Date.now()}`);
    mkdirSync(sarvamHome);
    vi.stubEnv('SARVAM_HOME', sarvamHome);

    try {
      const { agents } = await import('../src/agents.ts');

      await expect(agents['sarvam-code'].detectInstalled()).resolves.toBe(true);
    } finally {
      rmSync(sarvamHome, { recursive: true, force: true });
    }
  });

  it('returns false when the resolved Sarvam home does not exist', async () => {
    const sarvamHome = join(tmpdir(), `missing-sarvam-home-${Date.now()}`);
    vi.stubEnv('SARVAM_HOME', sarvamHome);

    const { agents } = await import('../src/agents.ts');

    await expect(agents['sarvam-code'].detectInstalled()).resolves.toBe(false);
  });

  it('accepts sarvam-code as a valid --agent for skills use', async () => {
    const { parseUseOptions } = await import('../src/use.ts');

    const result = parseUseOptions(['vercel-labs/agent-skills', '--agent', 'sarvam-code']);

    expect(result.options.agent).toEqual(['sarvam-code']);
    expect(result.errors).toEqual([]);
  });
});
