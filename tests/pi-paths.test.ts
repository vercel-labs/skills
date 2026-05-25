import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

async function loadAgentsModule() {
  vi.resetModules();
  return import('../src/agents.ts');
}

describe('pi path resolution', () => {
  const originalPiCodingAgentDir = process.env.PI_CODING_AGENT_DIR;
  const originalHome = process.env.HOME;
  let tempDir: string | undefined;

  afterEach(async () => {
    if (originalPiCodingAgentDir === undefined) {
      delete process.env.PI_CODING_AGENT_DIR;
    } else {
      process.env.PI_CODING_AGENT_DIR = originalPiCodingAgentDir;
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

  it('uses PI_CODING_AGENT_DIR for install detection', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'pi-coding-agent-'));
    process.env.PI_CODING_AGENT_DIR = tempDir;
    const { agents } = await loadAgentsModule();

    await expect(agents.pi.detectInstalled()).resolves.toBe(true);
    expect(agents.pi.globalSkillsDir).toBe(join(tempDir, 'skills'));
  });

  it('trims PI_CODING_AGENT_DIR values', async () => {
    process.env.PI_CODING_AGENT_DIR = '  /tmp/pi-coding-agent  ';
    const { agents } = await loadAgentsModule();

    expect(agents.pi.globalSkillsDir).toBe('/tmp/pi-coding-agent/skills');
  });

  it('falls back to ~/.pi/agent when PI_CODING_AGENT_DIR is empty', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'pi-home-'));
    process.env.HOME = tempDir;
    process.env.PI_CODING_AGENT_DIR = '   ';
    const { agents } = await loadAgentsModule();
    await mkdir(join(tempDir, '.pi/agent'), { recursive: true });

    await expect(agents.pi.detectInstalled()).resolves.toBe(true);
    expect(agents.pi.globalSkillsDir).toBe(join(tempDir, '.pi/agent', 'skills'));
  });
});
