import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const host = vi.hoisted(() => ({ home: '', platform: 'linux' }));
vi.mock('os', async (importOriginal) => ({
  ...(await importOriginal<typeof import('os')>()),
  homedir: () => host.home,
  platform: () => host.platform,
}));

describe('Reasonix skill installation', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'skills-reasonix-'));
    host.home = join(root, 'home');
    host.platform = 'linux';
    vi.stubEnv('REASONIX_HOME', '');
    vi.stubEnv('APPDATA', '');
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    rmSync(root, { recursive: true, force: true });
  });

  it.each(['linux', 'darwin'])('uses ~/.reasonix on %s even with APPDATA set', async (platform) => {
    host.platform = platform;
    vi.stubEnv('APPDATA', join(root, 'roaming'));
    const { agents } = await import('../src/agents.ts');
    expect(agents.reasonix.globalSkillsDir).toBe(join(host.home, '.reasonix', 'skills'));
    expect(agents.reasonix.skillsDir).toBe('.reasonix/skills');
  });

  it('uses the Windows roaming directory and detects that installation', async () => {
    host.platform = 'win32';
    const roaming = join(root, 'roaming');
    vi.stubEnv('APPDATA', roaming);
    mkdirSync(join(roaming, 'reasonix'), { recursive: true });
    const { agents } = await import('../src/agents.ts');
    expect(agents.reasonix.globalSkillsDir).toBe(join(roaming, 'reasonix', 'skills'));
    await expect(agents.reasonix.detectInstalled()).resolves.toBe(true);
  });

  it('falls back to AppData/Roaming when APPDATA is blank on Windows', async () => {
    host.platform = 'win32';
    vi.stubEnv('APPDATA', '   ');
    const { agents } = await import('../src/agents.ts');
    expect(agents.reasonix.globalSkillsDir).toBe(
      join(host.home, 'AppData', 'Roaming', 'reasonix', 'skills')
    );
  });

  it.each(['linux', 'win32'])('installs into REASONIX_HOME on %s', async (platform) => {
    host.platform = platform;
    const reasonixHome = join(root, 'custom-reasonix');
    vi.stubEnv('REASONIX_HOME', reasonixHome);
    vi.stubEnv('APPDATA', join(root, 'roaming'));
    const { agents } = await import('../src/agents.ts');
    await expect(agents.reasonix.detectInstalled()).resolves.toBe(false);
    const source = join(root, 'source');
    mkdirSync(source);
    const content = '---\nname: review\ndescription: Review changes.\n---\n\n# Review\n';
    writeFileSync(join(source, 'SKILL.md'), content);
    const { installSkillForAgent } = await import('../src/installer.ts');
    const result = await installSkillForAgent(
      { name: 'review', description: 'Review changes.', path: source },
      'reasonix',
      { global: true, mode: 'copy' }
    );
    expect(result.success).toBe(true);
    expect(result.path).toBe(join(reasonixHome, 'skills', 'review'));
    expect(readFileSync(join(result.path, 'SKILL.md'), 'utf8')).toBe(content);
    await expect(agents.reasonix.detectInstalled()).resolves.toBe(true);
  });
});
