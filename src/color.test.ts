import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const CLI_PATH = join(import.meta.dirname, 'cli.ts');

/**
 * Runs `skills list` in a subprocess writing to a pipe, returning the RAW
 * stdout (unlike runCli, which strips terminal escapes). The piped stdout is
 * never a TTY, so this exercises exactly the surface where color output leaks
 * as garbage into `| less`, `| code -`, CI logs, etc.
 */
function runListRaw(overrides: Record<string, string>): string {
  const env: NodeJS.ProcessEnv = { ...process.env, DISABLE_TELEMETRY: '1' };
  // Neither variable may leak in from the surrounding environment: the
  // detector's contract is defined entirely by the overrides below.
  delete env.NO_COLOR;
  delete env.FORCE_COLOR;
  Object.assign(env, overrides);

  const cwd = mkdtempSync(join(tmpdir(), 'skills-color-test-'));
  try {
    return execFileSync(process.execPath, [CLI_PATH, 'list'], {
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
  it('emits no ANSI codes when stdout is piped', () => {
    const output = runListRaw({});
    expect(output).toContain('No project skills found');
    expect(output).not.toMatch(/\x1b\[/);
  });

  it('emits ANSI codes when FORCE_COLOR is set', () => {
    const output = runListRaw({ FORCE_COLOR: '1' });
    expect(output).toContain('No project skills found');
    expect(output).toMatch(/\x1b\[/);
  });

  it('NO_COLOR wins over FORCE_COLOR', () => {
    const output = runListRaw({ NO_COLOR: '1', FORCE_COLOR: '1' });
    expect(output).toContain('No project skills found');
    expect(output).not.toMatch(/\x1b\[/);
  });
});
