import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const CLI_PATH = join(import.meta.dirname, '..', 'src', 'cli.ts');

function runCli(args: string[], cwd?: string) {
  return spawnSync('node', [CLI_PATH, ...args], {
    cwd: cwd || process.cwd(),
    encoding: 'utf-8',
    env: { ...process.env, NODE_ENV: 'test' },
    timeout: 30000,
  });
}

describe('status command', () => {
  it('should be listed in help output', () => {
    const result = runCli(['--help']);
    expect(result.stdout).toContain('status');
  });

  it('should handle no installed skills gracefully', () => {
    // Run from a temp-like dir with no skills
    const result = runCli(['status']);
    const output = result.stdout + result.stderr;
    // Either shows "No installed skills" or lists active skills
    expect(result.status).toBe(0);
  });
});
