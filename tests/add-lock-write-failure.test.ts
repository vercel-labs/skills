import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { runCli } from '../src/test-utils.ts';

describe('add when the lock file cannot be written', () => {
  let root: string;
  let project: string;
  let home: string;
  const readOnlyLocks: string[] = [];

  /** A valid lock that can be read but not rewritten. */
  function writeReadOnlyLock(path: string, version: number): void {
    writeFileSync(path, JSON.stringify({ version, skills: {} }));
    chmodSync(path, 0o444);
    readOnlyLocks.push(path);
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'skills-lock-write-'));
    project = join(root, 'project');
    home = join(root, 'home');
    const skill = join(project, 'src', 'alpha');
    mkdirSync(skill, { recursive: true });
    writeFileSync(join(skill, 'SKILL.md'), '---\nname: alpha\ndescription: alpha\n---\n');
  });

  afterEach(() => {
    for (const path of readOnlyLocks.splice(0)) chmodSync(path, 0o644);
    rmSync(root, { recursive: true, force: true });
  });

  it('reports a project lock it could not update and exits 1', () => {
    writeReadOnlyLock(join(project, 'skills-lock.json'), 1);

    const result = runCli(['add', './src', '-a', 'universal', '-y'], project);

    expect(existsSync(join(project, '.agents', 'skills', 'alpha', 'SKILL.md'))).toBe(true);
    expect(result.stdout).toContain('could not record it in');
    expect(result.exitCode).toBe(1);
  });

  it('reports a global lock it could not update and exits 1', () => {
    const lockDir = join(home, '.local', 'state', 'skills');
    mkdirSync(lockDir, { recursive: true });
    writeReadOnlyLock(join(lockDir, '.skill-lock.json'), 3);

    const result = runCli(['add', './src', '-g', '-a', 'universal', '-y'], project, {
      HOME: home,
    });

    expect(existsSync(join(home, '.agents', 'skills', 'alpha', 'SKILL.md'))).toBe(true);
    expect(result.stdout).toContain('could not record it in');
    expect(result.exitCode).toBe(1);
  });
});
