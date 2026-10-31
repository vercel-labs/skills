import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { runCli } from '../src/test-utils.ts';

const CONFLICTED_LOCK = `<<<<<<< HEAD
{ "version": 1, "skills": {} }
=======
{ "version": 1, "skills": {} }
>>>>>>> feature-branch
`;

function skillMd(name: string): string {
  return `---
name: ${name}
description: ${name} description
---
# ${name}
`;
}

describe('commands with an invalid skills-lock.json', { timeout: 30000 }, () => {
  let testDir: string;
  let sourceDir: string;
  let projectDir: string;
  let lockPath: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `skills-invalid-lock-${Date.now()}-${process.pid}`);
    sourceDir = join(testDir, 'source');
    projectDir = join(testDir, 'project');
    lockPath = join(projectDir, 'skills-lock.json');
    for (const name of ['alpha', 'beta']) {
      mkdirSync(join(sourceDir, 'skills', name), { recursive: true });
      writeFileSync(join(sourceDir, 'skills', name, 'SKILL.md'), skillMd(name));
    }
    mkdirSync(join(projectDir, '.agents', 'skills', 'alpha'), { recursive: true });
    writeFileSync(join(projectDir, '.agents', 'skills', 'alpha', 'SKILL.md'), skillMd('alpha'));
    writeFileSync(lockPath, CONFLICTED_LOCK);
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  function expectLockUntouched(): void {
    expect(readFileSync(lockPath, 'utf-8')).toBe(CONFLICTED_LOCK);
  }

  it('add refuses a project install and installs nothing', () => {
    const result = runCli(['add', sourceDir, '--skill', 'beta', '-y'], projectDir);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain(`Invalid ${lockPath}`);
    expect(existsSync(join(projectDir, '.agents', 'skills', 'beta'))).toBe(false);
    expectLockUntouched();
  });

  it('add -g ignores the project lock', () => {
    const home = join(testDir, 'home');
    mkdirSync(home, { recursive: true });

    const result = runCli(
      ['add', sourceDir, '--skill', 'beta', '-y', '-g', '--agent', 'claude-code'],
      projectDir,
      { HOME: home, USERPROFILE: home }
    );

    expect(result.exitCode).toBe(0);
    expect(existsSync(join(home, '.claude', 'skills', 'beta', 'SKILL.md'))).toBe(true);
  });

  it('remove refuses and keeps the skill on disk', () => {
    const result = runCli(['remove', 'alpha', '-y'], projectDir);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(`Invalid ${lockPath}`);
    expect(existsSync(join(projectDir, '.agents', 'skills', 'alpha', 'SKILL.md'))).toBe(true);
    expectLockUntouched();
  });

  it.each([
    ['update', ['update', '--project', '-y']],
    ['experimental_install', ['experimental_install']],
    ['experimental_sync', ['experimental_sync', '-y']],
  ])('%s refuses', (_, args) => {
    const result = runCli(args, projectDir);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(`Invalid ${lockPath}`);
    expectLockUntouched();
  });

  it('list warns and still lists installed skills', () => {
    const result = runCli(['list'], projectDir);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain(`Warning: Invalid ${lockPath}`);
    expect(result.stdout).toContain('alpha');
    expectLockUntouched();
  });

  it('add treats an invalid lock inside the source repo as empty', () => {
    writeFileSync(join(sourceDir, 'skills-lock.json'), CONFLICTED_LOCK);
    rmSync(lockPath);

    const result = runCli(['add', sourceDir, '--skill', 'beta', '-y'], projectDir);

    expect(result.exitCode).toBe(0);
    expect(existsSync(join(projectDir, '.agents', 'skills', 'beta', 'SKILL.md'))).toBe(true);
  });
});
