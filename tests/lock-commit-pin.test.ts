import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execFileSync } from 'child_process';
import { pathToFileURL } from 'url';
import { runCli } from '../src/test-utils.ts';

// A file:// source cannot carry a #ref, so the fixture is reached through an
// HTTPS Git URL that git rewrites to the local repository.
const SOURCE = 'https://git.example.test/skills.git';

describe('project lock commit pin', () => {
  let root: string;
  let project: string;
  let repo: string;
  let env: Record<string, string>;

  const git = (...args: string[]) =>
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
      cwd: repo,
      encoding: 'utf-8',
    }).trim();
  const publish = (body: string): string => {
    writeFileSync(
      join(repo, 'skills', 'alpha', 'SKILL.md'),
      `---\nname: alpha\ndescription: alpha\n---\n${body}\n`
    );
    git('add', '.');
    git('commit', '-q', '-m', body);
    return git('rev-parse', 'HEAD');
  };
  const cli = (...args: string[]) => runCli(args, project, env);
  const add = () => cli('add', SOURCE, '--skill', 'alpha', '-a', 'universal', '-y');
  const lockPath = () => join(project, 'skills-lock.json');
  const lockEntry = () => JSON.parse(readFileSync(lockPath(), 'utf-8')).skills.alpha;
  const installedBody = () =>
    readFileSync(join(project, '.agents', 'skills', 'alpha', 'SKILL.md'), 'utf-8');
  const clearInstall = () => rmSync(join(project, '.agents'), { recursive: true, force: true });

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'skills-commit-pin-'));
    project = join(root, 'project');
    repo = join(root, 'repo');
    mkdirSync(join(repo, 'skills', 'alpha'), { recursive: true });
    mkdirSync(project, { recursive: true });
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo });
    env = {
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: `url.${pathToFileURL(repo).href}.insteadOf`,
      GIT_CONFIG_VALUE_0: SOURCE,
    };
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('records the commit and restores it after upstream moves on', () => {
    const v1 = publish('v1');
    expect(add().exitCode).toBe(0);
    expect(lockEntry().commit).toBe(v1);
    const before = readFileSync(lockPath(), 'utf-8');

    publish('v2');
    clearInstall();

    const frozen = cli('experimental_install', '--frozen-lockfile');
    expect(frozen.exitCode).toBe(0);
    expect(installedBody()).toContain('v1');
    expect(readFileSync(lockPath(), 'utf-8')).toBe(before);

    // A non-frozen restore also keeps the locked commit, and the lock keeps no SHA as its ref
    clearInstall();
    expect(cli('experimental_install').exitCode).toBe(0);
    expect(installedBody()).toContain('v1');
    expect(readFileSync(lockPath(), 'utf-8')).toBe(before);
  });

  it('moves the commit forward on update', () => {
    publish('v1');
    expect(add().exitCode).toBe(0);
    const v2 = publish('v2');

    expect(cli('update', '-y').exitCode).toBe(0);
    expect(lockEntry().commit).toBe(v2);
    expect(installedBody()).toContain('v2');
  });

  it('pins an older lock entry without a commit on update', () => {
    const v1 = publish('v1');
    expect(add().exitCode).toBe(0);
    const lock = JSON.parse(readFileSync(lockPath(), 'utf-8'));
    delete lock.skills.alpha.commit;
    writeFileSync(lockPath(), JSON.stringify(lock));

    expect(cli('update', '-y').exitCode).toBe(0);
    expect(lockEntry().commit).toBe(v1);
  });
});
