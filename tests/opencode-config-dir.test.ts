/**
 * Tests for OPENCODE_CONFIG_DIR support.
 *
 * OpenCode searches the directory named by OPENCODE_CONFIG_DIR in addition to
 * its default ~/.config/opencode, and loads skills from <dir>/skills there.
 * Tools that manage per-context OpenCode configurations (one config directory
 * per project or persona) set this variable, so global installs must follow it
 * rather than always writing to ~/.config/opencode/skills.
 *
 * See: https://opencode.ai/docs/config/#custom-directory
 */

import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { homedir, tmpdir } from 'os';
import { xdgConfig } from 'xdg-basedir';
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('OpenCode custom config directory', () => {
  // Matches how src/agents.ts resolves the XDG config home, so these assertions
  // hold on machines that set XDG_CONFIG_HOME as well as on ones that do not.
  const defaultSkillsDir = join(xdgConfig ?? join(homedir(), '.config'), 'opencode', 'skills');

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('installs global skills under OPENCODE_CONFIG_DIR when it is set', async () => {
    const configDir = join(tmpdir(), 'custom-opencode-config');
    vi.stubEnv('OPENCODE_CONFIG_DIR', configDir);

    vi.resetModules();
    const { agents } = await import('../src/agents.ts');

    expect(agents.opencode.skillsDir).toBe('.agents/skills');
    expect(agents.opencode.globalSkillsDir).toBe(join(configDir, 'skills'));
  });

  it('falls back to ~/.config/opencode/skills when the variable is unset', async () => {
    vi.stubEnv('OPENCODE_CONFIG_DIR', '');

    vi.resetModules();
    const { agents } = await import('../src/agents.ts');

    expect(agents.opencode.globalSkillsDir).toBe(defaultSkillsDir);
  });

  it('ignores a blank OPENCODE_CONFIG_DIR', async () => {
    vi.stubEnv('OPENCODE_CONFIG_DIR', '   ');

    vi.resetModules();
    const { agents } = await import('../src/agents.ts');

    expect(agents.opencode.globalSkillsDir).toBe(defaultSkillsDir);
  });

  it('detects OpenCode from a custom config directory that exists', async () => {
    const configDir = join(tmpdir(), `opencode-config-${process.pid}`);
    mkdirSync(configDir, { recursive: true });
    vi.stubEnv('OPENCODE_CONFIG_DIR', configDir);

    try {
      vi.resetModules();
      const { agents } = await import('../src/agents.ts');

      await expect(agents.opencode.detectInstalled()).resolves.toBe(true);
    } finally {
      rmSync(configDir, { recursive: true, force: true });
    }
  });
});
