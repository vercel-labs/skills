import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const SRC_DIR = import.meta.dirname;
const CLI_PATH = join(SRC_DIR, 'cli.ts');
const ANSI = /\x1b\[/;

/**
 * Runs the CLI in a subprocess writing to a pipe and returns the RAW stdout
 * (unlike runCli, which strips terminal escapes). A pipe is never a TTY, so
 * this is exactly the `| less`, `| code -` case.
 */
function runRaw(args: string[], overrides: Record<string, string> = {}): string {
  const env: NodeJS.ProcessEnv = { ...process.env, DISABLE_TELEMETRY: '1' };
  // The detection contract is defined entirely by the overrides below.
  for (const key of ['NO_COLOR', 'FORCE_COLOR', 'CI', 'TERM']) delete env[key];
  Object.assign(env, overrides);

  const cwd = mkdtempSync(join(tmpdir(), 'skills-color-test-'));
  try {
    return execFileSync(process.execPath, [CLI_PATH, ...args], {
      encoding: 'utf-8',
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
    });
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

describe('color support detection', () => {
  it.each(['list', '--help'])('emits no ANSI codes when piped: `skills %s`', (args) => {
    const output = runRaw([args]);
    expect(output.trim()).not.toBe('');
    expect(output).not.toMatch(ANSI);
  });

  it.each<Record<string, string>>([{ FORCE_COLOR: '1' }, { CI: 'true' }])(
    'emits color when %o',
    (env) => {
      expect(runRaw(['list'], env)).toMatch(ANSI);
    }
  );

  it('honors --color', () => {
    expect(runRaw(['list', '--color'])).toMatch(ANSI);
  });

  it.each<Record<string, string>>([
    { NO_COLOR: '1', FORCE_COLOR: '1' },
    { NO_COLOR: '1', CI: 'true' },
  ])('NO_COLOR wins: %o', (env) => {
    expect(runRaw(['list'], env)).not.toMatch(ANSI);
  });

  it('honors --no-color over FORCE_COLOR', () => {
    expect(runRaw(['list', '--no-color'], { FORCE_COLOR: '1' })).not.toMatch(ANSI);
  });
});

/** Non-test source files under src/, as forward-slash paths relative to src/. */
function sourceFiles(): string[] {
  return readdirSync(SRC_DIR, { recursive: true, encoding: 'utf-8' })
    .map((f) => f.replaceAll('\\', '/'))
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && f !== 'test-utils.ts');
}

describe('escape code hygiene', () => {
  // Files allowed to contain raw escape literals:
  // - color.ts: the gated palette itself
  // - sanitize.ts: regexes that strip escapes from untrusted metadata
  // - find.ts, prompts/search-multiselect.ts: cursor control for interactive
  //   pickers, which only run on a TTY
  const ALLOWED = new Set(['color.ts', 'sanitize.ts', 'find.ts', 'prompts/search-multiselect.ts']);
  const RAW_ESCAPE = /\\x1b\[|\\u001b\[|\\033\[|\\e\[/;

  it('keeps raw ANSI literals out of the rest of src/', () => {
    const offenders = sourceFiles()
      .filter((f) => !ALLOWED.has(f))
      .filter((f) => RAW_ESCAPE.test(readFileSync(join(SRC_DIR, f), 'utf-8')));

    // Import from ./color.ts so NO_COLOR and pipes are respected.
    expect(offenders).toEqual([]);
  });

  it('routes picocolors through color.ts', () => {
    const offenders = sourceFiles()
      .filter((f) => f !== 'color.ts')
      .filter((f) => /from ['"]picocolors['"]/.test(readFileSync(join(SRC_DIR, f), 'utf-8')));

    // picocolors' own detection turns color on for every win32 process, pipes included.
    expect(offenders).toEqual([]);
  });
});
