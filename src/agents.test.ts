import { mkdirSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getHermesHome, getOpenClawGlobalSkillsDir, getQwenHome } from './agents.ts';

describe('agent home resolution', () => {
  const home = join(tmpdir(), 'skills-path-home');

  describe('OpenClaw', () => {
    it('uses an explicit state directory before existing default or legacy directories', () => {
      const state = join(home, 'work');
      expect(getOpenClawGlobalSkillsDir(home, () => true, { OPENCLAW_STATE_DIR: state })).toBe(
        join(state, 'skills')
      );
    });

    it('expands the state directory relative to the effective OpenClaw home', () => {
      const alternateHome = join(home, 'alternate');
      expect(
        getOpenClawGlobalSkillsDir(home, () => true, {
          OPENCLAW_HOME: alternateHome,
          OPENCLAW_STATE_DIR: ' ~/work ',
        })
      ).toBe(join(alternateHome, 'work', 'skills'));
    });

    it('resolves a relative state directory against cwd', () => {
      expect(getOpenClawGlobalSkillsDir(home, () => false, { OPENCLAW_STATE_DIR: './work' })).toBe(
        join(resolve('work'), 'skills')
      );
    });

    it('expands OPENCLAW_HOME against the OS home', () => {
      expect(getOpenClawGlobalSkillsDir(home, () => false, { OPENCLAW_HOME: '~/alternate' })).toBe(
        join(home, 'alternate', '.openclaw', 'skills')
      );
    });

    it.each(['', ' ', 'undefined', 'null'])('ignores an unset OPENCLAW_HOME value %j', (value) => {
      expect(getOpenClawGlobalSkillsDir(home, () => false, { OPENCLAW_HOME: value })).toBe(
        join(home, '.openclaw', 'skills')
      );
    });
  });

  describe('Hermes', () => {
    it('uses the default home with a literal data-directory suffix', () => {
      expect(getHermesHome(home, {}, 'linux')).toBe(join(home, '.hermes'));
      expect(getHermesHome(home, { HERMES_DATA_DIR_SUFFIX: '-work' }, 'linux')).toBe(
        join(home, '.hermes-work')
      );
    });

    it('lets HERMES_HOME take precedence over the suffix and platform default', () => {
      const override = join(home, 'profile');
      expect(
        getHermesHome(
          home,
          { HERMES_HOME: ` ${override} `, HERMES_DATA_DIR_SUFFIX: '-work' },
          'win32'
        )
      ).toBe(override);
    });

    it('expands environment variables before a leading home prefix', () => {
      expect(
        getHermesHome(
          home,
          { HERMES_HOME: '$PROFILE_ROOT/${PROFILE}', PROFILE_ROOT: '~/profiles', PROFILE: 'work' },
          'linux'
        )
      ).toBe(join(home, 'profiles', 'work'));
      expect(getHermesHome(home, { HERMES_HOME: '$UNDEFINED_PROFILE/work' }, 'linux')).toBe(
        '$UNDEFINED_PROFILE/work'
      );
    });

    it('preserves relative homes and literal percent syntax on POSIX', () => {
      expect(getHermesHome(home, { HERMES_HOME: './work' }, 'linux')).toBe('./work');
      expect(
        getHermesHome(home, { HERMES_HOME: '%PROFILE%/work', PROFILE: 'other' }, 'linux')
      ).toBe('%PROFILE%/work');
    });

    it('uses LOCALAPPDATA and the suffix on Windows', () => {
      const local = join(home, 'Local');
      expect(
        getHermesHome(home, { LOCALAPPDATA: local, HERMES_DATA_DIR_SUFFIX: '-work' }, 'win32')
      ).toBe(join(local, 'hermes-work'));
      expect(getHermesHome(home, { LOCALAPPDATA: ' ' }, 'win32')).toBe(
        join(home, 'AppData', 'Local', 'hermes')
      );
    });

    it('expands Windows environment syntax in an explicit home', () => {
      expect(
        getHermesHome(home, { HERMES_HOME: '%LOCALAPPDATA%/work', LOCALAPPDATA: home }, 'win32')
      ).toBe(`${home}/work`);
    });
  });

  describe('Qwen Code', () => {
    it('falls back only when QWEN_HOME is empty or absent', () => {
      expect(getQwenHome(home, {})).toBe(join(home, '.qwen'));
      expect(getQwenHome(home, { QWEN_HOME: '' })).toBe(join(home, '.qwen'));
      expect(getQwenHome(home, { QWEN_HOME: ' ' })).toBe(resolve(' '));
    });

    it.each(['~', '~/work', '~\\work'])('expands the home prefix in %j', (value) => {
      expect(getQwenHome(home, { QWEN_HOME: value })).toBe(
        value === '~' ? home : join(home, 'work')
      );
    });

    it('resolves relative paths without expanding environment variables', () => {
      expect(getQwenHome(home, { QWEN_HOME: './work' })).toBe(resolve('work'));
      expect(getQwenHome(home, { QWEN_HOME: '$PROFILE/work', PROFILE: 'other' })).toBe(
        resolve('$PROFILE/work')
      );
    });
  });
});

describe('active profile detection', () => {
  let root: string;

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it.each([
    { agent: 'openclaw', key: 'OPENCLAW_STATE_DIR', defaultDir: '.openclaw' },
    { agent: 'hermes-agent', key: 'HERMES_HOME', defaultDir: '.hermes' },
    { agent: 'qwen-code', key: 'QWEN_HOME', defaultDir: '.qwen' },
  ] as const)(
    '$agent does not detect the inactive default profile',
    async ({ agent, key, defaultDir }) => {
      root = mkdtempSync(join(tmpdir(), 'skills-profile-detection-'));
      vi.stubEnv('HOME', root);
      vi.stubEnv('USERPROFILE', root);
      vi.stubEnv('OPENCLAW_HOME', root);
      const selected = join(root, 'active');
      vi.stubEnv(key, selected);
      mkdirSync(join(root, defaultDir));
      vi.resetModules();
      const { agents } = await import('./agents.ts');
      expect(agents[agent].globalSkillsDir).toBe(join(selected, 'skills'));
      await expect(agents[agent].detectInstalled()).resolves.toBe(false);
      mkdirSync(selected);
      await expect(agents[agent].detectInstalled()).resolves.toBe(true);
    }
  );
});
