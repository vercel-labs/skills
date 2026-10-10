import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { runCli } from '../src/test-utils.ts';

describe('experimental_install', () => {
  let testDir: string;

  function writeSkill(dir: string, name: string): void {
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'SKILL.md'),
      `---\nname: ${name}\ndescription: ${name}\n---\n# ${name}\n`
    );
  }

  function writeLock(skills: Record<string, string>): void {
    writeFileSync(
      join(testDir, 'skills-lock.json'),
      JSON.stringify({
        version: 1,
        skills: Object.fromEntries(
          Object.entries(skills).map(([name, source]) => [
            name,
            { source, sourceType: 'local', computedHash: 'x' },
          ])
        ),
      })
    );
  }

  const installed = (name: string) =>
    existsSync(join(testDir, '.agents', 'skills', name, 'SKILL.md'));

  beforeEach(() => {
    testDir = join(
      tmpdir(),
      `skills-install-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('restores every source in the lock', () => {
    writeSkill(join(testDir, 'src-a', 'alpha'), 'alpha');
    writeSkill(join(testDir, 'src-b', 'beta'), 'beta');
    writeLock({ alpha: './src-a', beta: './src-b' });

    const result = runCli(['experimental_install'], testDir);

    expect(result.exitCode).toBe(0);
    expect(installed('alpha')).toBe(true);
    expect(installed('beta')).toBe(true);
    const lock = JSON.parse(readFileSync(join(testDir, 'skills-lock.json'), 'utf-8'));
    expect(lock.skills.alpha.computedHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('keeps restoring after a source fails', () => {
    writeSkill(join(testDir, 'src-b', 'beta'), 'beta');
    writeLock({ alpha: './missing', beta: './src-b' });

    const result = runCli(['experimental_install'], testDir);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain('Failed to install from');
    expect(installed('beta')).toBe(true);
  });
});
