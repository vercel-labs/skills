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

import { describe, it, expect } from 'vitest';
import { homedir } from 'os';
import { join } from 'path';
import { agents } from '../src/agents.ts';
import { isUniversalAgent, getUniversalAgents, getNonUniversalAgents } from '../src/agents.ts';
import { getAgentBaseDir } from '../src/installer.ts';

describe('XDG config paths', () => {
  const home = homedir();

  describe('OpenCode', () => {
    it('uses ~/.config/opencode/skills for global skills (not ~/Library/Preferences)', () => {
      const expected = join(home, '.config', 'opencode', 'skills');
      expect(agents.opencode.globalSkillsDir).toBe(expected);
    });

    it('does NOT use platform-specific paths like ~/Library/Preferences', () => {
      expect(agents.opencode.globalSkillsDir).not.toContain('Library');
      expect(agents.opencode.globalSkillsDir).not.toContain('Preferences');
      expect(agents.opencode.globalSkillsDir).not.toContain('AppData');
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

  describe('Antigravity 2.0', () => {
    it('uses ~/.gemini/config/skills for global skills', () => {
      const expected = join(home, '.gemini', 'config', 'skills');
      expect(agents.antigravity.globalSkillsDir).toBe(expected);
    });

    it('is NOT universal so global installs use its own globalSkillsDir', () => {
      expect(isUniversalAgent('antigravity')).toBe(false);
      expect(getUniversalAgents()).not.toContain('antigravity');
      expect(getNonUniversalAgents()).toContain('antigravity');
      // getAgentBaseDir must honor globalSkillsDir for global installs
      expect(getAgentBaseDir('antigravity', true)).toBe(join(home, '.gemini', 'config', 'skills'));
    });

    it('still reads workspace skills from the canonical .agents/skills dir', () => {
      expect(agents.antigravity.skillsDir).toBe('.agents/skills');
      expect(getAgentBaseDir('antigravity', false, '/proj')).toBe('/proj/.agents/skills');
    });
  });

  describe('Antigravity IDE', () => {
    it('uses ~/.gemini/antigravity/skills for global skills', () => {
      const expected = join(home, '.gemini', 'antigravity', 'skills');
      expect(agents['antigravity-ide'].globalSkillsDir).toBe(expected);
    });

    it('is NOT universal so global installs use its own globalSkillsDir', () => {
      expect(isUniversalAgent('antigravity-ide')).toBe(false);
      expect(getNonUniversalAgents()).toContain('antigravity-ide');
      expect(getAgentBaseDir('antigravity-ide', true)).toBe(
        join(home, '.gemini', 'antigravity', 'skills')
      );
    });
  });

  describe('Antigravity CLI', () => {
    it('uses ~/.gemini/antigravity-cli/skills for global skills', () => {
      const expected = join(home, '.gemini', 'antigravity-cli', 'skills');
      expect(agents['antigravity-cli'].globalSkillsDir).toBe(expected);
    });

    it('uses a distinct global directory from Antigravity 2.0 and Antigravity IDE', () => {
      const dirs = new Set([
        agents.antigravity.globalSkillsDir,
        agents['antigravity-ide'].globalSkillsDir,
        agents['antigravity-cli'].globalSkillsDir,
      ]);
      expect(dirs.size).toBe(3);
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
