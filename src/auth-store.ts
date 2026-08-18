import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, chmodSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

export interface AuthUser {
  id: string;
  handle: string;
  email: string;
}

export interface StoredAuth {
  version: 1;
  token: string;
  user?: AuthUser;
  expiresAt?: string | null;
}

export interface ResolvedToken {
  token: string;
  source: 'env' | 'file';
}

function configDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME?.trim();
  const base = xdg && xdg.length > 0 ? xdg : join(homedir(), '.config');
  return join(base, 'skills');
}

export function getConfigPath(): string {
  return join(configDir(), 'auth.json');
}

export function isEnvToken(): boolean {
  return !!process.env.SKILLS_TOKEN?.trim();
}

function readStored(): StoredAuth | null {
  const path = getConfigPath();
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as StoredAuth;
    if (parsed && typeof parsed.token === 'string' && parsed.token.trim().length > 0) return parsed;
    return null;
  } catch {
    return null;
  }
}

export function getToken(): ResolvedToken | null {
  const env = process.env.SKILLS_TOKEN?.trim();
  if (env) return { token: env, source: 'env' };
  const stored = readStored();
  if (stored) return { token: stored.token, source: 'file' };
  return null;
}

export function getStoredUser(): AuthUser | null {
  return readStored()?.user ?? null;
}

export function setToken(token: string, user?: AuthUser): void {
  const dir = configDir();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  const data: StoredAuth = { version: 1, token, user, expiresAt: null };
  const path = getConfigPath();
  writeFileSync(path, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
  chmodSync(path, 0o600);
}

export function clearToken(): void {
  const path = getConfigPath();
  if (existsSync(path)) rmSync(path, { force: true });
}
