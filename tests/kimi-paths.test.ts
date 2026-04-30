import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

async function loadAgentsModule() {
  vi.resetModules();
  return import('../src/agents.ts');
}

describe('kimi-cli path resolution', () => {
  const originalKimiShareDir = process.env.KIMI_SHARE_DIR;
  const originalHome = process.env.HOME;
  let tempDir: string | undefined;

  afterEach(async () => {
    if (originalKimiShareDir === undefined) {
      delete process.env.KIMI_SHARE_DIR;
    } else {
      process.env.KIMI_SHARE_DIR = originalKimiShareDir;
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

  it('uses KIMI_SHARE_DIR for install detection', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'kimi-share-'));
    process.env.KIMI_SHARE_DIR = tempDir;
    const { agents } = await loadAgentsModule();

    await expect(agents['kimi-cli'].detectInstalled()).resolves.toBe(true);
  });

  it('trims KIMI_SHARE_DIR values', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'kimi-share-'));
    process.env.KIMI_SHARE_DIR = `  ${tempDir}  `;
    const { agents } = await loadAgentsModule();

    await expect(agents['kimi-cli'].detectInstalled()).resolves.toBe(true);
  });

  it('falls back to ~/.kimi when KIMI_SHARE_DIR is empty', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'kimi-home-'));
    process.env.HOME = tempDir;
    process.env.KIMI_SHARE_DIR = '   ';
    const { agents } = await loadAgentsModule();
    await mkdir(join(tempDir, '.kimi'), { recursive: true });

    await expect(agents['kimi-cli'].detectInstalled()).resolves.toBe(true);
  });
});
