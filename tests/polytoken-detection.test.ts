import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir, homedir } from 'os';
import { detectInstalledAgents } from '../src/agents.ts';

describe('polytoken detection', () => {
  let originalHome: string | undefined;
  let originalCwd: string | undefined;
  let tempHome: string | undefined;

  beforeEach(async () => {
    originalHome = process.env.HOME;
    originalCwd = process.cwd();
    tempHome = await mkdtemp(join(tmpdir(), 'skills-polytoken-home-'));
    process.env.HOME = tempHome;
    process.chdir(tempHome);
    vi.resetModules();
  });

  afterEach(async () => {
    if (originalCwd) process.chdir(originalCwd);
    process.env.HOME = originalHome;
    if (tempHome) {
      await rm(tempHome, { recursive: true, force: true });
    }
    vi.unstubAllEnvs();
  });

  it('detects Polytoken when ~/.polytoken exists', async () => {
    await mkdir(join(tempHome!, '.polytoken'), { recursive: true });
    const { detectInstalledAgents: detect } = await import('../src/agents.ts');
    const installed = await detect();
    expect(installed).toContain('polytoken');
  });

  it('does not detect Polytoken when ~/.polytoken is absent', async () => {
    const { detectInstalledAgents: detect } = await import('../src/agents.ts');
    const installed = await detect();
    expect(installed).not.toContain('polytoken');
  });
});
