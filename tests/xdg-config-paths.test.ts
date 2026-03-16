/**
 * Tests for XDG config path handling (cross-platform).
 *
 * These tests verify that agents using XDG Base Directory specification
 * (OpenCode, Amp, Goose) use ~/.config paths consistently across all platforms,
 * NOT platform-specific paths like ~/Library/Preferences on macOS.
 *
 * This is critical because OpenCode uses xdg-basedir which always returns
 * ~/.config (or $XDG_CONFIG_HOME if set), regardless of platform.
 * The agents CLI must match this behavior to install agents in the correct location.
 *
 * See: https://github.com/vercel-labs/agents/pull/66
 * See: https://github.com/vercel-labs/agents/issues/63
 */

import { describe, it, expect } from 'vitest';
import { homedir } from 'os';
import { join } from 'path';
import { agents } from '../src/agents.ts';

describe('XDG config paths', () => {
  const home = homedir();

  describe('OpenCode', () => {
    it('uses ~/.config/opencode/agents for global agents (not ~/Library/Preferences)', () => {
      const expected = join(home, '.config', 'opencode', 'agents');
      expect(agents.opencode.globalAgentsDir).toBe(expected);
    });

    it('does NOT use platform-specific paths like ~/Library/Preferences', () => {
      expect(agents.opencode.globalAgentsDir).not.toContain('Library');
      expect(agents.opencode.globalAgentsDir).not.toContain('Preferences');
      expect(agents.opencode.globalAgentsDir).not.toContain('AppData');
    });
  });

  describe('Amp', () => {
    it('uses ~/.config/agents/agents for global agents', () => {
      const expected = join(home, '.config', 'agents', 'agents');
      expect(agents.amp.globalAgentsDir).toBe(expected);
    });

    it('does NOT use platform-specific paths', () => {
      expect(agents.amp.globalAgentsDir).not.toContain('Library');
      expect(agents.amp.globalAgentsDir).not.toContain('Preferences');
      expect(agents.amp.globalAgentsDir).not.toContain('AppData');
    });
  });

  describe('Goose', () => {
    it('uses ~/.config/goose/agents for global agents', () => {
      const expected = join(home, '.config', 'goose', 'agents');
      expect(agents.goose.globalAgentsDir).toBe(expected);
    });

    it('does NOT use platform-specific paths', () => {
      expect(agents.goose.globalAgentsDir).not.toContain('Library');
      expect(agents.goose.globalAgentsDir).not.toContain('Preferences');
      expect(agents.goose.globalAgentsDir).not.toContain('AppData');
    });
  });

  describe('agent lock file path', () => {
    function getAgentLockPath(xdgStateHome: string | undefined, homeDir: string): string {
      if (xdgStateHome) {
        return join(xdgStateHome, 'agents', '.agent-lock.json');
      }
      return join(homeDir, '.agents', '.agent-lock.json');
    }

    it('uses XDG_STATE_HOME when set', () => {
      const result = getAgentLockPath('/custom/state', home);
      expect(result).toBe(join('/custom/state', 'agents', '.agent-lock.json'));
    });

    it('falls back to ~/.agents when XDG_STATE_HOME is not set', () => {
      const result = getAgentLockPath(undefined, home);
      expect(result).toBe(join(home, '.agents', '.agent-lock.json'));
    });
  });

  describe('non-XDG agents', () => {
    it('cursor uses ~/.cursor/agents (home-based, not XDG)', () => {
      const expected = join(home, '.cursor', 'agents');
      expect(agents.cursor.globalAgentsDir).toBe(expected);
    });

    it('cline uses ~/.agents/agents (home-based, not XDG)', () => {
      const expected = join(home, '.agents', 'agents');
      expect(agents.cline.globalAgentsDir).toBe(expected);
    });
  });
});
