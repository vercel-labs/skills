/**
 * Debug logger for the skills CLI.
 *
 * Enabled when any of:
 * - --debug / --verbose / -d flag is present in process.argv (including --debug=/path)
 * - SKILLS_DEBUG env var is set (e.g. SKILLS_DEBUG=1 or SKILLS_DEBUG=/tmp/foo.log)
 * - SKILLS_DEBUG_FILE env var is set
 * - DEBUG env var contains "skills" (e.g. DEBUG=skills* or DEBUG=*)
 *
 * When enabled, output goes to a file (not stderr) so the Clack TUI stays clean:
 * - Default: $XDG_STATE_HOME/skills/debug.log else ~/.local/state/skills/debug.log
 * - Override order (first wins):
 *   1. --debug=/custom/path.log (relative to cwd)
 *   2. SKILLS_DEBUG_FILE env
 *   3. SKILLS_DEBUG when it looks like a path (contains / or \ or ends with .log)
 *   4. Default state file
 * - Escape hatch: SKILLS_DEBUG=stderr (or SKILLS_DEBUG_FILE=stderr) restores stderr
 */

import { appendFileSync, mkdirSync, statSync, renameSync, existsSync, readFileSync } from 'fs';
import { join, dirname, resolve, isAbsolute } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';

export const DEBUG_FLAGS = new Set(['--debug', '--verbose', '-d']);

export function isDebugFlag(arg: string): boolean {
  if (DEBUG_FLAGS.has(arg)) return true;
  if (arg.startsWith('--debug=')) return true;
  return false;
}

function argvHasDebugFlag(): boolean {
  for (const arg of process.argv) {
    if (isDebugFlag(arg)) return true;
  }
  return false;
}

export function isDebugEnabled(): boolean {
  if (process.env.SKILLS_DEBUG) return true;
  if (process.env.SKILLS_DEBUG_FILE) return true;
  if (argvHasDebugFlag()) return true;
  const dbg = process.env.DEBUG;
  if (dbg && (dbg.includes('skills') || dbg === '*')) return true;
  return false;
}

export function enableDebug(): void {
  // Preserve existing SKILLS_DEBUG when it already encodes a file path or stderr mode
  // so that `SKILLS_DEBUG=/tmp/x.log` and `SKILLS_DEBUG=stderr` survive propagation
  // to child processes (src/update.ts spawns `node bin/cli.mjs add …`).
  if (process.env.SKILLS_DEBUG) return;
  process.env.SKILLS_DEBUG = '1';
}

// Backwards compat alias — some call sites import `isDebug` as function
export const isDebug = isDebugEnabled;

function redact(str: string): string {
  // Bearer tokens
  let out = str.replace(/(Bearer\s+)[^\s"']+/gi, '$1[redacted]');
  // GH tokens in URLs or env dumps (ghp_, gho_, github_pat_)
  out = out.replace(/(gh[ops]_[a-zA-Z0-9_]+|github_pat_[a-zA-Z0-9_]+)/g, '[redacted]');
  // Generic token= query param
  out = out.replace(/(token=)[^&\s"']+/gi, '$1[redacted]');
  // Env-style GITHUB_TOKEN=xxx
  out = out.replace(/(GITHUB_TOKEN|GH_TOKEN)\s*=\s*[^\s]+/gi, '$1=[redacted]');
  return out;
}

function formatArgs(args: unknown[]): unknown[] {
  return args.map((a) => {
    if (typeof a === 'string') return redact(a);
    if (a instanceof Error) return redact(a.message);
    return a;
  });
}

const DIM = '\x1b[38;5;102m';
const RESET = '\x1b[0m';

// ---------------------------------------------------------------------------
// File sink
// ---------------------------------------------------------------------------

let explicitDebugFile: string | null = null;
let headerWrittenForFile: string | null = null;
let fallbackWarned = false;

function getVersion(): string {
  try {
    const pkgPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    return `${pkg.version} (bermudi fork)`;
  } catch {
    try {
      const alt = join(process.cwd(), 'package.json');
      const pkg2 = JSON.parse(readFileSync(alt, 'utf-8'));
      return `${pkg2.version} (bermudi fork)`;
    } catch {
      return 'unknown (bermudi fork)';
    }
  }
}

function defaultLogPath(): string {
  const xdg = process.env.XDG_STATE_HOME;
  if (xdg) return join(xdg, 'skills', 'debug.log');
  return join(homedir(), '.local', 'state', 'skills', 'debug.log');
}

function looksLikePath(v: string): boolean {
  return v.includes('/') || v.includes('\\') || v.endsWith('.log');
}

export function isStderrMode(): boolean {
  return process.env.SKILLS_DEBUG === 'stderr' || process.env.SKILLS_DEBUG_FILE === 'stderr';
}

export function setDebugFile(path: string): void {
  explicitDebugFile = path;
  // Propagate to child processes (src/update.ts spawns `node bin/cli.mjs add ...`)
  if (path && path !== 'stderr') {
    try {
      const abs = isAbsolute(path) ? path : resolve(process.cwd(), path);
      process.env.SKILLS_DEBUG_FILE = abs;
    } catch {
      // ignore
    }
  }
}

export function getLogFilePath(): string | null {
  if (isStderrMode()) return null;

  if (explicitDebugFile) {
    return isAbsolute(explicitDebugFile)
      ? explicitDebugFile
      : resolve(process.cwd(), explicitDebugFile);
  }

  const envFile = process.env.SKILLS_DEBUG_FILE;
  if (envFile) {
    if (envFile === 'stderr') return null;
    return isAbsolute(envFile) ? envFile : resolve(process.cwd(), envFile);
  }

  const sd = process.env.SKILLS_DEBUG;
  if (sd && sd !== '1' && sd !== 'true' && sd !== 'false' && sd !== '0' && sd !== 'stderr') {
    if (looksLikePath(sd)) {
      return isAbsolute(sd) ? sd : resolve(process.cwd(), sd);
    }
  }

  return defaultLogPath();
}

// Backwards compat / spec aliases
export function getDebugFilePath(): string | null {
  return getLogFilePath();
}
export function getDebugLogPath(): string | null {
  return getLogFilePath();
}
// Live binding for `debugFilePath` - kept in sync via getLogFilePath
export let debugFilePath: string | null = null;

function timestamp(): string {
  const d = new Date();
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

function ensureLogFile(file: string): void {
  if (headerWrittenForFile === file) return;
  try {
    mkdirSync(dirname(file), { recursive: true });
  } catch {
    // fallback to stderr later
  }
  // Rotation: if >5MB, rename to debug.log.1
  try {
    if (existsSync(file)) {
      const st = statSync(file);
      if (st.size > 5 * 1024 * 1024) {
        try {
          renameSync(file, `${file}.1`);
        } catch {
          // ignore
        }
      }
    }
  } catch {
    // ignore
  }
  try {
    const header = `=== skills --debug ${new Date().toISOString()} args=${JSON.stringify(process.argv.slice(2))} version=${getVersion()} cwd=${process.cwd()} ===\n`;
    appendFileSync(file, header);
    headerWrittenForFile = file;
    debugFilePath = file;
  } catch (e) {
    if (!fallbackWarned) {
      console.error(`${DIM}[debug:fs]${RESET} log write fail ${String(e).slice(0, 200)}`);
      fallbackWarned = true;
    }
  }
}

export function writeHeader(): void {
  if (!isDebugEnabled()) return;
  if (isStderrMode()) return;
  const file = getLogFilePath();
  if (!file) return;
  ensureLogFile(file);
}

function formatForFile(args: unknown[]): string {
  return formatArgs(args)
    .map((a) => {
      if (typeof a === 'string') return a;
      try {
        const j = JSON.stringify(a);
        return j === undefined ? String(a) : redact(j);
      } catch {
        return redact(String(a));
      }
    })
    .join(' ');
}

export function debug(ns: string, ...args: unknown[]): void {
  if (!isDebugEnabled()) return;
  if (isStderrMode()) {
    console.error(`${DIM}[debug:${ns}]${RESET}`, ...formatArgs(args));
    return;
  }
  const file = getLogFilePath();
  if (!file) {
    console.error(`${DIM}[debug:${ns}]${RESET}`, ...formatArgs(args));
    return;
  }
  try {
    ensureLogFile(file);
    const line = `[${timestamp()}] [debug:${ns}] ${formatForFile(args)}\n`;
    appendFileSync(file, line);
    debugFilePath = file;
  } catch (e) {
    if (!fallbackWarned) {
      console.error(`${DIM}[debug:${ns}]${RESET}`, ...formatArgs(args));
      console.error(`${DIM}[debug:fs]${RESET} log write fail ${String(e).slice(0, 200)}`);
      fallbackWarned = true;
    }
  }
}

/** For tests: reset header/rotation state */
export function __resetDebugState(): void {
  headerWrittenForFile = null;
  fallbackWarned = false;
  explicitDebugFile = null;
}

export function getDisplayLogPath(): string | null {
  const p = getLogFilePath();
  if (!p) return null;
  const home = homedir();
  if (p === home || p.startsWith(home + '/')) {
    return `~${p.slice(home.length)}`;
  }
  return p;
}

/** Sugar for file operations: debugFs('mkdir', path, {recursive:true}) */
export function debugFs(op: string, path: string, extra?: Record<string, unknown>): void {
  if (!isDebugEnabled()) return;
  const detail = extra && Object.keys(extra).length ? ` ${JSON.stringify(extra)}` : '';
  debug('fs', `${op} ${path}${detail}`);
}

export function debugFsResult(
  op: string,
  path: string,
  ok: boolean,
  ms?: number,
  err?: unknown
): void {
  if (!isDebugEnabled()) return;
  const timing = ms != null ? ` (${ms}ms)` : '';
  if (ok) {
    debug('fs', `${op} ${path} -> ok${timing}`);
  } else {
    const msg = err instanceof Error ? err.message : String(err ?? 'unknown');
    debug('fs', `${op} ${path} -> fail ${redact(msg).slice(0, 200)}${timing}`);
  }
}

/** Sugar for API calls: debugApi('GET', url, {status, ms}) */
export function debugApi(method: string, url: string, info?: Record<string, unknown>): void {
  if (!isDebugEnabled()) return;
  const extra = info && Object.keys(info).length ? ` ${JSON.stringify(info)}` : '';
  debug('api', `${method} ${redact(url)}${extra}`);
}
