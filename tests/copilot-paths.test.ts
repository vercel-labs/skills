import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

async function loadAgentsModule() {
  vi.resetModules();
  return import('../src/agents.ts');
}

describe('github-copilot path resolution', () => {
  const originalCopilotHome = process.env.COPILOT_HOME;
  const originalHome = process.env.HOME;
  let tempDir: string | undefined;

  afterEach(async () => {
    if (originalCopilotHome === undefined) {
      delete process.env.COPILOT_HOME;
    } else {
      process.env.COPILOT_HOME = originalCopilotHome;
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

  it('uses COPILOT_HOME for install detection', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'copilot-home-'));
    process.env.COPILOT_HOME = tempDir;
    const { agents } = await loadAgentsModule();

    await expect(agents['github-copilot'].detectInstalled()).resolves.toBe(true);
    expect(agents['github-copilot'].globalSkillsDir).toBe(join(tempDir, 'skills'));
  });

  it('trims COPILOT_HOME values', async () => {
    process.env.COPILOT_HOME = '  /tmp/copilot-home  ';
    const { agents } = await loadAgentsModule();

    expect(agents['github-copilot'].globalSkillsDir).toBe('/tmp/copilot-home/skills');
  });

  it('falls back to ~/.copilot when COPILOT_HOME is empty', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'copilot-home-'));
    process.env.HOME = tempDir;
    process.env.COPILOT_HOME = '   ';
    const { agents } = await loadAgentsModule();
    await mkdir(join(tempDir, '.copilot'), { recursive: true });

    await expect(agents['github-copilot'].detectInstalled()).resolves.toBe(true);

    expect(agents['github-copilot'].globalSkillsDir).toBe(join(tempDir, '.copilot', 'skills'));
  });
});
