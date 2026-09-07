/**
 * Tests for XDG config path handling (cross-platform).
 *
 * These tests verify that agents using XDG Base Directory specification
 * (OpenCode, Amp, Goose) use ~/.config paths consistently across all platforms,
 * NOT platform-specific paths like ~/Library/Preferences on macOS.
 *
 * This is critical because OpenCode uses xdg-basedir which always returns
 * ~/.config (or $XDG_CONFIG_HOME if set), regardless of platform.
 * The skills CLI must match this behavior to install skills in the correct location.
 *
 * See: https://github.com/vercel-labs/skills/pull/66
 * See: https://github.com/vercel-labs/skills/issues/63
 */

import { afterEach, describe, it, expect, vi } from 'vitest';
import { homedir } from 'os';
import { join } from 'path';
import { agents } from '../src/agents.ts';

describe('XDG config paths', () => {
  const home = homedir();

  describe('OpenCode', () => {
    // OPENCODE_CONFIG_DIR overrides the default, so clear it before asserting
    // what the default is - otherwise these fail on a machine that sets it.
    async function loadDefaultOpenCodeAgent() {
      vi.stubEnv('OPENCODE_CONFIG_DIR', '');
      // Reset first: src/agents.ts is already imported at the top of this file,
      // so without this the dynamic import returns the cached module and the
      // stubbed environment has no effect.
      vi.resetModules();
      const { agents: freshAgents } = await import('../src/agents.ts');
      return freshAgents.opencode;
    }

    afterEach(() => {
      vi.unstubAllEnvs();
      vi.resetModules();
    });

    it('uses ~/.config/opencode/skills for global skills (not ~/Library/Preferences)', async () => {
      const opencode = await loadDefaultOpenCodeAgent();
      const expected = join(home, '.config', 'opencode', 'skills');
      expect(opencode.globalSkillsDir).toBe(expected);
    });

    it('does NOT use platform-specific paths like ~/Library/Preferences', async () => {
      const opencode = await loadDefaultOpenCodeAgent();
      expect(opencode.globalSkillsDir).not.toContain('Library');
      expect(opencode.globalSkillsDir).not.toContain('Preferences');
      expect(opencode.globalSkillsDir).not.toContain('AppData');
    });
  });

  describe('Amp', () => {
    it('uses ~/.config/agents/skills for global skills', () => {
      const expected = join(home, '.config', 'agents', 'skills');
      expect(agents.amp.globalSkillsDir).toBe(expected);
    });

    it('does NOT use platform-specific paths', () => {
      expect(agents.amp.globalSkillsDir).not.toContain('Library');
      expect(agents.amp.globalSkillsDir).not.toContain('Preferences');
      expect(agents.amp.globalSkillsDir).not.toContain('AppData');
    });
  });

  describe('Kimi Code CLI', () => {
    it('uses the current agent id', () => {
      expect('kimi-code-cli' in agents).toBe(true);
      expect('kimi-cli' in agents).toBe(false);
    });

    it('uses ~/.agents/skills for global skills', () => {
      const expected = join(home, '.agents', 'skills');
      expect(agents['kimi-code-cli'].globalSkillsDir).toBe(expected);
    });
  });

  describe('Goose', () => {
    it('uses ~/.config/goose/skills for global skills', () => {
      const expected = join(home, '.config', 'goose', 'skills');
      expect(agents.goose.globalSkillsDir).toBe(expected);
    });

    it('does NOT use platform-specific paths', () => {
      expect(agents.goose.globalSkillsDir).not.toContain('Library');
      expect(agents.goose.globalSkillsDir).not.toContain('Preferences');
      expect(agents.goose.globalSkillsDir).not.toContain('AppData');
    });
  });

  describe('Antigravity CLI', () => {
    it('uses ~/.gemini/antigravity-cli/skills for global skills', () => {
      const expected = join(home, '.gemini', 'antigravity-cli', 'skills');
      expect(agents['antigravity-cli'].globalSkillsDir).toBe(expected);
    });

    it('uses a distinct global directory from the Antigravity IDE', () => {
      expect(agents['antigravity-cli'].globalSkillsDir).not.toBe(
        agents.antigravity.globalSkillsDir
      );
    });
  });

  describe('skill lock file path', () => {
    function getSkillLockPath(xdgStateHome: string | undefined, homeDir: string): string {
      if (xdgStateHome) {
        return join(xdgStateHome, 'skills', '.skill-lock.json');
      }
      return join(homeDir, '.agents', '.skill-lock.json');
    }

    it('uses XDG_STATE_HOME when set', () => {
      const result = getSkillLockPath('/custom/state', home);
      expect(result).toBe(join('/custom/state', 'skills', '.skill-lock.json'));
    });

    it('falls back to ~/.agents when XDG_STATE_HOME is not set', () => {
      const result = getSkillLockPath(undefined, home);
      expect(result).toBe(join(home, '.agents', '.skill-lock.json'));
    });
  });

  describe('non-XDG agents', () => {
    it('cursor uses ~/.cursor/skills (home-based, not XDG)', () => {
      const expected = join(home, '.cursor', 'skills');
      expect(agents.cursor.globalSkillsDir).toBe(expected);
    });

    it('cline uses ~/.agents/skills (home-based, not XDG)', () => {
      const expected = join(home, '.agents', 'skills');
      expect(agents.cline.globalSkillsDir).toBe(expected);
    });
  });
});
