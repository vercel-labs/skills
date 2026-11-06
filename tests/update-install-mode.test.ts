import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execFileSync } from 'child_process';
import { pathToFileURL } from 'url';
import { runCli } from '../src/test-utils.ts';

describe('install mode across updates', () => {
  let root: string;
  let project: string;
  let repo: string;

  const publish = (body: string) => {
    writeFileSync(
      join(repo, 'skills', 'alpha', 'SKILL.md'),
      `---\nname: alpha\ndescription: alpha\n---\n${body}\n`
    );
    const git = (...args: string[]) =>
      execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
        cwd: repo,
        stdio: 'ignore',
      });
    git('add', '.');
    git('commit', '-q', '-m', body);
  };
  const add = (...flags: string[]) =>
    runCli(
      [
        'add',
        pathToFileURL(repo).href,
        '--skill',
        'alpha',
        '-a',
        'claude-code',
        'universal',
        '-y',
        ...flags,
      ],
      project
    );
  const lockEntry = () =>
    JSON.parse(readFileSync(join(project, 'skills-lock.json'), 'utf-8')).skills.alpha;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'skills-install-mode-'));
    project = join(root, 'project');
    repo = join(root, 'repo');
    mkdirSync(join(repo, 'skills', 'alpha'), { recursive: true });
    execFileSync('git', ['init', '-q'], { cwd: repo });
    publish('v1');
    mkdirSync(join(project, '.claude'), { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('keeps a copied skill a copy when update reinstalls it', () => {
    expect(add('--copy').exitCode).toBe(0);
    expect(lockEntry().installMode).toBe('copy');
    publish('v2');

    expect(runCli(['update', '-y'], project).exitCode).toBe(0);

    const skillDir = join(project, '.claude', 'skills', 'alpha');
    expect(lstatSync(skillDir).isSymbolicLink()).toBe(false);
    expect(readFileSync(join(skillDir, 'SKILL.md'), 'utf-8')).toContain('v2');
  });

  it('records a copied global install in the global lock', () => {
    const home = join(root, 'home');
    const result = runCli(
      [
        'add',
        join(repo, 'skills', 'alpha'),
        '-g',
        '-a',
        'claude-code',
        'universal',
        '--copy',
        '-y',
      ],
      project,
      { HOME: home }
    );

    expect(result.exitCode).toBe(0);
    const lock = JSON.parse(
      readFileSync(join(home, '.local', 'state', 'skills', '.skill-lock.json'), 'utf-8')
    );
    expect(lock.skills.alpha.installMode).toBe('copy');
  });

  it('records nothing when the default mode is used', () => {
    expect(add().exitCode).toBe(0);
    expect(lockEntry()).not.toHaveProperty('installMode');
  });
});
