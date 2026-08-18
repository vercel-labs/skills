import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync,
  rmSync,
  existsSync,
  readFileSync,
  statSync,
  writeFileSync,
  mkdirSync,
} from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import {
  getToken,
  setToken,
  clearToken,
  getConfigPath,
  isEnvToken,
  getStoredUser,
} from './auth-store.ts';

describe('auth-store', () => {
  let home: string;
  const saved = { xdg: process.env.XDG_CONFIG_HOME, tok: process.env.SKILLS_TOKEN };

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'skills-auth-'));
    process.env.XDG_CONFIG_HOME = join(home, '.config');
    delete process.env.SKILLS_TOKEN;
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
    if (saved.xdg === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = saved.xdg;
    if (saved.tok === undefined) delete process.env.SKILLS_TOKEN;
    else process.env.SKILLS_TOKEN = saved.tok;
  });

  it('returns null when nothing is stored', () => {
    expect(getToken()).toBeNull();
  });

  it('persists and reads a token from file with user', () => {
    setToken('opaque-123', { id: 'u1', handle: 'maya', email: 'm@e.co' });
    expect(getToken()).toEqual({ token: 'opaque-123', source: 'file' });
  });

  it.skipIf(process.platform === 'win32')('writes auth.json with 0600 permissions', () => {
    setToken('opaque-123');
    const mode = statSync(getConfigPath()).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('prefers SKILLS_TOKEN env over file', () => {
    setToken('file-token');
    process.env.SKILLS_TOKEN = 'env-token';
    expect(getToken()).toEqual({ token: 'env-token', source: 'env' });
    expect(isEnvToken()).toBe(true);
  });

  it('treats a corrupt auth.json as logged-out', () => {
    setToken('good');
    writeFileSync(getConfigPath(), '{ not json');
    expect(getToken()).toBeNull();
  });

  it('clearToken removes the file', () => {
    setToken('x');
    clearToken();
    expect(existsSync(getConfigPath())).toBe(false);
    expect(getToken()).toBeNull();
  });

  it.skipIf(process.platform === 'win32')('writes the config dir with 0700 permissions', () => {
    setToken('x');
    const mode = statSync(dirname(getConfigPath())).mode & 0o777;
    expect(mode).toBe(0o700);
  });

  it.skipIf(process.platform === 'win32')('tightens an already-existing config dir to 0700', () => {
    const dir = dirname(getConfigPath());
    mkdirSync(dir, { recursive: true, mode: 0o755 });
    setToken('x');
    const mode = statSync(dir).mode & 0o777;
    expect(mode).toBe(0o700);
  });

  it('getStoredUser returns the stored user, and null when logged out', () => {
    expect(getStoredUser()).toBeNull();
    setToken('x', { id: 'u1', handle: 'maya', email: 'm@e.co' });
    expect(getStoredUser()).toEqual({ id: 'u1', handle: 'maya', email: 'm@e.co' });
  });
});
