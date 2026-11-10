import { afterEach, describe, expect, it, vi } from 'vitest';
import { homedir } from 'os';
import { join } from 'path';

vi.mock('fs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('fs')>()),
  existsSync: vi.fn(() => false),
}));

import { existsSync } from 'fs';

const exists = vi.mocked(existsSync);

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  exists.mockReset().mockReturnValue(false);
});

describe('KronOS agent', () => {
  it('has its own identity and project and global skill paths', async () => {
    vi.stubEnv('KRONOS_HOME', '');
    const { agents } = await import('../src/agents.ts');
    expect(agents.kronos).toMatchObject({
      name: 'kronos',
      displayName: 'KronOS',
      skillsDir: '.kronos/skills',
      globalSkillsDir: join(homedir(), '.kronos', 'skills'),
    });
    expect(await agents.kronos.detectInstalled('/project')).toBe(false);
  });

  it('detects the home directory initialized by KronOS without Hermes', async () => {
    vi.stubEnv('KRONOS_HOME', '');
    exists.mockImplementation((path) => path === join(homedir(), '.kronos'));
    const { agents, detectInstalledAgents } = await import('../src/agents.ts');
    expect(await agents.kronos.detectInstalled('/project')).toBe(true);
    expect(await agents['hermes-agent'].detectInstalled('/project')).toBe(false);
    expect(await detectInstalledAgents('/project')).toContain('kronos');
  });

  it('detects a project-local installation', async () => {
    exists.mockImplementation((path) => path === join('/project', '.kronos'));
    const { agents } = await import('../src/agents.ts');
    expect(await agents.kronos.detectInstalled('/project')).toBe(true);
    expect(await agents.kronos.detectInstalled('/elsewhere')).toBe(false);
  });

  it('uses KRONOS_HOME for both detection and global installation', async () => {
    const custom = join(homedir(), 'custom-kronos');
    vi.stubEnv('KRONOS_HOME', `  ${custom}  `);
    exists.mockImplementation((path) => path === custom);
    const { agents } = await import('../src/agents.ts');
    expect(agents.kronos.globalSkillsDir).toBe(join(custom, 'skills'));
    expect(await agents.kronos.detectInstalled('/project')).toBe(true);
  });

  it('does not identify Hermes or legacy KronosCode installations as KronOS', async () => {
    vi.stubEnv('KRONOS_HOME', '');
    exists.mockImplementation((path) =>
      [join(homedir(), '.hermes'), join(homedir(), '.kronoscode')].includes(String(path))
    );
    const { agents } = await import('../src/agents.ts');
    expect(await agents.kronos.detectInstalled('/project')).toBe(false);
  });
});
