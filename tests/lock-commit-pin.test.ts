import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execFileSync } from 'child_process';
import { pathToFileURL } from 'url';
import { runCli } from '../src/test-utils.ts';

// A file:// source cannot carry a #ref, so the fixture is reached through an
// HTTPS Git URL that git rewrites to the local repository.
// The global lock only tracks sources with an owner/repo path.
const SOURCE = 'https://git.example.test/owner/skills.git';

describe('lock commit pin', () => {
  let root: string;
  let project: string;
  let repo: string;
  let env: Record<string, string>;

  const git = (...args: string[]) =>
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
      cwd: repo,
      encoding: 'utf-8',
    }).trim();
  const publish = (body: string, names = ['alpha']): string => {
    for (const name of names) {
      mkdirSync(join(repo, 'skills', name), { recursive: true });
      writeFileSync(
        join(repo, 'skills', name, 'SKILL.md'),
        `---\nname: ${name}\ndescription: ${name}\n---\n${body}\n`
      );
    }
    git('add', '.');
    git('commit', '-q', '-m', body);
    return git('rev-parse', 'HEAD');
  };
  const cli = (...args: string[]) => runCli(args, project, env);
  const add = () => cli('add', SOURCE, '--skill', 'alpha', '-a', 'universal', '-y');
  const lockPath = () => join(project, 'skills-lock.json');
  const readLock = () => JSON.parse(readFileSync(lockPath(), 'utf-8'));
  const lockEntry = () => readLock().skills.alpha;
  const installedBody = (name = 'alpha') =>
    readFileSync(join(project, '.agents', 'skills', name, 'SKILL.md'), 'utf-8');
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

  it('records the commit in the global lock and moves it forward on update', () => {
    env.HOME = join(root, 'home');
    const globalEntry = () =>
      JSON.parse(
        readFileSync(join(env.HOME!, '.local', 'state', 'skills', '.skill-lock.json'), 'utf-8')
      ).skills.alpha;
    const v1 = publish('v1');
    expect(cli('add', SOURCE, '--skill', 'alpha', '-g', '-a', 'universal', '-y').exitCode).toBe(0);
    expect(globalEntry().commit).toBe(v1);

    const v2 = publish('v2');
    expect(cli('update', '-g', '-y').exitCode).toBe(0);
    expect(globalEntry().commit).toBe(v2);
  });

  describe('experimental_sync', () => {
    const sync = (...flags: string[]) =>
      cli('experimental_sync', '-y', '-a', 'universal', ...flags);
    const declare = (skills: unknown[]) =>
      writeFileSync(join(project, 'package.json'), JSON.stringify({ name: 'project', skills }));

    it('restores the locked commit under --frozen-lockfile after upstream moves on', () => {
      declare([SOURCE]);
      const v1 = publish('v1');
      expect(sync('--no-frozen-lockfile').exitCode).toBe(0);
      expect(lockEntry().commit).toBe(v1);
      const before = readFileSync(lockPath(), 'utf-8');

      publish('v2');
      clearInstall();

      expect(sync('--frozen-lockfile').exitCode).toBe(0);
      expect(installedBody()).toContain('v1');
      expect(readFileSync(lockPath(), 'utf-8')).toBe(before);
    });

    it('restores each skill at its own locked commit', () => {
      declare([SOURCE]);
      publish('v1', ['alpha', 'beta']);
      expect(sync('--no-frozen-lockfile').exitCode).toBe(0);
      const alpha = readLock().skills.alpha;
      publish('v2', ['alpha', 'beta']);
      clearInstall();
      expect(sync('--no-frozen-lockfile').exitCode).toBe(0);
      const lock = readLock();
      lock.skills.alpha = alpha;
      writeFileSync(lockPath(), JSON.stringify(lock));

      publish('v3', ['alpha', 'beta']);
      clearInstall();

      expect(sync('--frozen-lockfile').exitCode).toBe(0);
      expect(installedBody('alpha')).toContain('v1');
      expect(installedBody('beta')).toContain('v2');
    });

    it('still fails when a requested skill is missing from the lock', () => {
      declare([{ source: SOURCE, skills: ['alpha'] }]);
      publish('v1');
      expect(sync('--no-frozen-lockfile').exitCode).toBe(0);

      publish('v2', ['beta']);
      declare([{ source: SOURCE, skills: ['alpha', 'beta'] }]);

      const frozen = sync('--frozen-lockfile');
      expect(frozen.exitCode).toBe(1);
      expect(frozen.stdout + frozen.stderr).toContain('beta');
    });
  });
});
