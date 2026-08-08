import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'path';
import { tmpdir } from 'os';
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync } from 'fs';
import {
  isDebugEnabled,
  isDebugFlag,
  getLogFilePath,
  setDebugFile,
  isStderrMode,
  getDisplayLogPath,
  __resetDebugState,
  debug,
} from './debug.ts';

describe('debug', () => {
  const origArgv = process.argv.slice();
  const origSkillsDebug = process.env.SKILLS_DEBUG;
  const origSkillsDebugFile = process.env.SKILLS_DEBUG_FILE;
  const origDebug = process.env.DEBUG;
  const origXdg = process.env.XDG_STATE_HOME;

  afterEach(() => {
    process.argv = origArgv.slice();
    if (origSkillsDebug === undefined) delete process.env.SKILLS_DEBUG;
    else process.env.SKILLS_DEBUG = origSkillsDebug;
    if (origSkillsDebugFile === undefined) delete process.env.SKILLS_DEBUG_FILE;
    else process.env.SKILLS_DEBUG_FILE = origSkillsDebugFile;
    if (origDebug === undefined) delete process.env.DEBUG;
    else process.env.DEBUG = origDebug;
    if (origXdg === undefined) delete process.env.XDG_STATE_HOME;
    else process.env.XDG_STATE_HOME = origXdg;
    __resetDebugState();
  });

  it('enabled via SKILLS_DEBUG', () => {
    process.argv = ['node', 'cli.ts'];
    process.env.SKILLS_DEBUG = '1';
    delete process.env.DEBUG;
    delete process.env.SKILLS_DEBUG_FILE;
    expect(isDebugEnabled()).toBe(true);
  });

  it('enabled via DEBUG=skills*', () => {
    process.argv = ['node', 'cli.ts'];
    delete process.env.SKILLS_DEBUG;
    delete process.env.SKILLS_DEBUG_FILE;
    process.env.DEBUG = 'skills*';
    expect(isDebugEnabled()).toBe(true);
  });

  it('enabled via DEBUG=*', () => {
    process.argv = ['node', 'cli.ts'];
    delete process.env.SKILLS_DEBUG;
    delete process.env.SKILLS_DEBUG_FILE;
    process.env.DEBUG = '*';
    expect(isDebugEnabled()).toBe(true);
  });

  it('enabled via --debug flag', () => {
    process.argv = ['node', 'cli.ts', '--debug'];
    delete process.env.SKILLS_DEBUG;
    delete process.env.SKILLS_DEBUG_FILE;
    delete process.env.DEBUG;
    expect(isDebugEnabled()).toBe(true);
  });

  it('enabled via -d flag', () => {
    process.argv = ['node', 'cli.ts', '-d'];
    delete process.env.SKILLS_DEBUG;
    delete process.env.SKILLS_DEBUG_FILE;
    delete process.env.DEBUG;
    expect(isDebugEnabled()).toBe(true);
  });

  it('enabled via --verbose flag', () => {
    process.argv = ['node', 'cli.ts', '--verbose'];
    delete process.env.SKILLS_DEBUG;
    delete process.env.SKILLS_DEBUG_FILE;
    delete process.env.DEBUG;
    expect(isDebugEnabled()).toBe(true);
  });

  it('enabled via --debug=/path flag', () => {
    process.argv = ['node', 'cli.ts', '--debug=/tmp/custom.log'];
    delete process.env.SKILLS_DEBUG;
    delete process.env.SKILLS_DEBUG_FILE;
    delete process.env.DEBUG;
    expect(isDebugEnabled()).toBe(true);
    expect(isDebugFlag('--debug=/tmp/custom.log')).toBe(true);
  });

  it('enabled via SKILLS_DEBUG_FILE', () => {
    process.argv = ['node', 'cli.ts'];
    delete process.env.SKILLS_DEBUG;
    delete process.env.DEBUG;
    process.env.SKILLS_DEBUG_FILE = '/tmp/foo.log';
    expect(isDebugEnabled()).toBe(true);
  });

  it('enabled via SKILLS_DEBUG as path', () => {
    process.argv = ['node', 'cli.ts'];
    delete process.env.DEBUG;
    delete process.env.SKILLS_DEBUG_FILE;
    process.env.SKILLS_DEBUG = '/tmp/bar.log';
    expect(isDebugEnabled()).toBe(true);
  });

  it('disabled by default', () => {
    process.argv = ['node', 'cli.ts'];
    delete process.env.SKILLS_DEBUG;
    delete process.env.SKILLS_DEBUG_FILE;
    delete process.env.DEBUG;
    expect(isDebugEnabled()).toBe(false);
  });

  it('DEBUG without skills does not enable', () => {
    process.argv = ['node', 'cli.ts'];
    delete process.env.SKILLS_DEBUG;
    delete process.env.SKILLS_DEBUG_FILE;
    process.env.DEBUG = 'other';
    expect(isDebugEnabled()).toBe(false);
  });

  describe('getLogFilePath', () => {
    it('defaults to XDG_STATE_HOME when set', () => {
      delete process.env.SKILLS_DEBUG_FILE;
      process.env.SKILLS_DEBUG = '1';
      process.env.XDG_STATE_HOME = '/tmp/xdg-state';
      __resetDebugState();
      expect(getLogFilePath()).toBe(join('/tmp/xdg-state', 'skills', 'debug.log'));
    });

    it('falls back to ~/.local/state when XDG not set', () => {
      delete process.env.XDG_STATE_HOME;
      delete process.env.SKILLS_DEBUG_FILE;
      process.env.SKILLS_DEBUG = '1';
      __resetDebugState();
      const p = getLogFilePath();
      expect(p).toContain('.local/state/skills/debug.log');
    });

    it('--debug=/tmp/x via setDebugFile wins over env', () => {
      process.env.XDG_STATE_HOME = '/tmp/xdg';
      process.env.SKILLS_DEBUG_FILE = '/tmp/env.log';
      process.env.SKILLS_DEBUG = '1';
      setDebugFile('/tmp/custom.log');
      expect(getLogFilePath()).toBe('/tmp/custom.log');
    });

    it('SKILLS_DEBUG_FILE overrides default', () => {
      delete process.env.XDG_STATE_HOME;
      __resetDebugState();
      process.env.SKILLS_DEBUG_FILE = '/tmp/from-env.log';
      delete process.env.SKILLS_DEBUG;
      // isDebugEnabled via file, but getLogFilePath should return it
      expect(getLogFilePath()).toBe('/tmp/from-env.log');
    });

    it('SKILLS_DEBUG=/path.log is treated as path', () => {
      __resetDebugState();
      delete process.env.SKILLS_DEBUG_FILE;
      delete process.env.XDG_STATE_HOME;
      process.env.SKILLS_DEBUG = '/tmp/skills-path.log';
      // contains / and ends with .log
      expect(getLogFilePath()).toBe('/tmp/skills-path.log');
    });

    it('SKILLS_DEBUG=1 falls back to default, not path', () => {
      __resetDebugState();
      delete process.env.SKILLS_DEBUG_FILE;
      process.env.XDG_STATE_HOME = '/tmp/xdg2';
      process.env.SKILLS_DEBUG = '1';
      expect(getLogFilePath()).toBe(join('/tmp/xdg2', 'skills', 'debug.log'));
    });

    it('SKILLS_DEBUG=stderr returns null and isStderrMode true', () => {
      __resetDebugState();
      process.env.SKILLS_DEBUG = 'stderr';
      delete process.env.SKILLS_DEBUG_FILE;
      expect(isStderrMode()).toBe(true);
      expect(getLogFilePath()).toBeNull();
    });

    it('relative --debug=./rel.log resolves against cwd', () => {
      __resetDebugState();
      delete process.env.SKILLS_DEBUG_FILE;
      delete process.env.SKILLS_DEBUG;
      setDebugFile('./rel.log');
      const p = getLogFilePath();
      expect(p).toBe(join(process.cwd(), 'rel.log'));
    });

    it('getDisplayLogPath shortens homedir to ~', () => {
      __resetDebugState();
      delete process.env.SKILLS_DEBUG_FILE;
      delete process.env.XDG_STATE_HOME;
      process.env.SKILLS_DEBUG = '1';
      const p = getLogFilePath();
      const d = getDisplayLogPath();
      if (p && p.includes('.local/state')) {
        expect(d?.startsWith('~')).toBe(true);
      } else {
        expect(d).toBe(p);
      }
    });
  });

  describe('isDebugFlag', () => {
    it('recognizes --debug, -d, --verbose, --debug=/path', () => {
      expect(isDebugFlag('--debug')).toBe(true);
      expect(isDebugFlag('-d')).toBe(true);
      expect(isDebugFlag('--verbose')).toBe(true);
      expect(isDebugFlag('--debug=/tmp/x.log')).toBe(true);
      expect(isDebugFlag('--debug=./rel.log')).toBe(true);
    });
    it('rejects non-debug flags', () => {
      expect(isDebugFlag('--help')).toBe(false);
      expect(isDebugFlag('list')).toBe(false);
      expect(isDebugFlag('--debugger')).toBe(false);
    });
  });

  describe('file sink', () => {
    it('writes debug lines to file, not stderr', () => {
      const dir = mkdtempSync(join(tmpdir(), 'skills-debug-test-'));
      const logFile = join(dir, 'debug.log');
      process.env.SKILLS_DEBUG_FILE = logFile;
      process.env.SKILLS_DEBUG = '1';
      __resetDebugState();
      debug('cli', 'hello', { x: 1 });
      expect(existsSync(logFile)).toBe(true);
      const content = readFileSync(logFile, 'utf-8');
      expect(content).toContain('[debug:cli]');
      expect(content).toContain('hello');
      expect(content).toContain('=== skills --debug');
      // cleanup
      rmSync(dir, { recursive: true, force: true });
    });

    it('appends header per process and rotates when >5MB', () => {
      const dir = mkdtempSync(join(tmpdir(), 'skills-debug-test-'));
      const logFile = join(dir, 'debug.log');
      // Create a 5MB+ file beforehand
      const big = 'x'.repeat(5 * 1024 * 1024 + 10);
      writeFileSync(logFile, big);
      process.env.SKILLS_DEBUG_FILE = logFile;
      process.env.SKILLS_DEBUG = '1';
      __resetDebugState();
      debug('fs', 'after-big');
      // Should have rotated to .1
      expect(existsSync(`${logFile}.1`)).toBe(true);
      const content = readFileSync(logFile, 'utf-8');
      expect(content).toContain('[debug:fs]');
      rmSync(dir, { recursive: true, force: true });
    });
  });
});
