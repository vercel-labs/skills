import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

async function loadAgentsModule() {
  vi.resetModules();
  return import('../src/agents.ts');
}

describe('gemini-cli path resolution', () => {
  const originalGeminiCliHome = process.env.GEMINI_CLI_HOME;
  const originalHome = process.env.HOME;
  let tempDir: string | undefined;

  afterEach(async () => {
    if (originalGeminiCliHome === undefined) {
      delete process.env.GEMINI_CLI_HOME;
    } else {
      process.env.GEMINI_CLI_HOME = originalGeminiCliHome;
    }

    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }

    vi.resetModules();

    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  it('uses GEMINI_CLI_HOME for install detection', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'gemini-cli-home-'));
    process.env.GEMINI_CLI_HOME = tempDir;
    const { agents } = await loadAgentsModule();
    await mkdir(join(tempDir, '.gemini'), { recursive: true });

    await expect(agents['gemini-cli'].detectInstalled()).resolves.toBe(true);
    expect(agents['gemini-cli'].globalSkillsDir).toBe(join(tempDir, '.gemini', 'skills'));
  });

  it('trims GEMINI_CLI_HOME values', () => {
    process.env.GEMINI_CLI_HOME = '  /tmp/gemini-home  ';
    return loadAgentsModule().then(({ agents }) => {
      expect(agents['gemini-cli'].globalSkillsDir).toBe('/tmp/gemini-home/.gemini/skills');
    });
  });

  it('falls back to ~/.gemini when GEMINI_CLI_HOME is empty', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'gemini-cli-home-'));
    process.env.HOME = tempDir;
    process.env.GEMINI_CLI_HOME = '   ';
    const { agents } = await loadAgentsModule();
    await mkdir(join(tempDir, '.gemini'), { recursive: true });

    await expect(agents['gemini-cli'].detectInstalled()).resolves.toBe(true);
    expect(agents['gemini-cli'].globalSkillsDir).toBe(join(tempDir, '.gemini', 'skills'));
  });
});
