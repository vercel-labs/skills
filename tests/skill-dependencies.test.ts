import {
  resolveDependencyGraph,
  skillDependencies,
  rejectUnsupportedDependencies,
} from '../src/skill-dependencies.ts';
import type { Skill } from '../src/types.ts';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  existsSync,
  symlinkSync,
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runCli } from '../src/test-utils.ts';

describe('same-source dependencies', () => {
  let root: string;
  let source: string;
  let project: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'skill dependencies '));
    source = join(root, 'source');
    project = join(root, 'project');
    mkdirSync(project);
    skill('a', 'metadata:\n  dependencies: "b"\n');
    skill('b');
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));
  function skill(name: string, metadata = '') {
    const dir = join(source, name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'SKILL.md'),
      `---\nname: ${name}\ndescription: Test skill.\n${metadata}---\nTest.\n`
    );
  }
  function install(...flags: string[]) {
    return runCli(['add', source, '--skill', 'a', '-a', 'codex', '-y', ...flags], project);
  }
  function readLockText() {
    return readFileSync(join(project, 'skills-lock.json'), 'utf8');
  }
  function readLock() {
    return JSON.parse(readLockText());
  }
  it.each(['', '--copy'])('installs a diamond with internal dependencies (%s)', (mode) => {
    skill('a', 'metadata:\n  dependencies: "b c b"\n');
    skill('b', 'metadata:\n  dependencies: "d"\n');
    skill('c', 'metadata:\n  dependencies: "d"\n');
    skill('d', 'metadata:\n  internal: true\n');
    skill('unrelated', 'metadata:\n  dependencies: [invalid]\n');
    writeFileSync(join(source, 'd/resource.txt'), 'sibling resource');
    writeFileSync(
      join(source, 'a/read.mjs'),
      "import { readFileSync } from 'node:fs'; console.log(readFileSync(new URL('../d/resource.txt', import.meta.url), 'utf8'));"
    );
    const result = runCli(
      ['add', source, '--skill', 'a', '-a', 'claude-code', '-y', ...(mode ? [mode] : [])],
      project
    );
    expect(result.exitCode, result.stdout + result.stderr).toBe(0);
    expect(Object.keys(readLock().skills).sort()).toEqual(['a', 'b', 'c', 'd']);
    expect(
      execFileSync(process.execPath, [join(project, '.claude/skills/a/read.mjs')], {
        cwd: root,
        encoding: 'utf8',
      }).trim()
    ).toBe('sibling resource');
    expect(readFileSync(join(project, '.claude/skills/d/SKILL.md'), 'utf8')).toContain(
      'internal: true'
    );
  });

  it.each([
    ['metadata:\n  dependencies: "missing"\n', '', 'missing dependency'],
    ['metadata:\n  dependencies: "b"\n', 'metadata:\n  dependencies: "a"\n', 'dependency cycle'],
    ['metadata:\n  dependencies: [b]\n', '', 'must be a string'],
    ['metadata:\n  dependencies: "../b"\n', '', 'invalid dependency'],
  ])('preserves the installation and lock on resolution failure (%s)', (a, b, error) => {
    skill('a');
    expect(install().exitCode).toBe(0);
    const lock = readLockText();
    const content = readFileSync(join(project, '.agents/skills/a/SKILL.md'), 'utf8');
    skill('a', a);
    skill('b', b);
    const result = install('--json');
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain(error);
    expect(readLockText()).toBe(lock);
    expect(readFileSync(join(project, '.agents/skills/a/SKILL.md'), 'utf8')).toBe(content);
  });

  it('does not ascend above a local source or validate a list', () => {
    skill('a', 'metadata:\n  dependencies: "b"\n');
    skill('b');
    expect(runCli(['add', join(source, 'a'), '--list'], project).exitCode).toBe(0);
    const result = runCli(['add', join(source, 'a'), '-a', 'codex', '-y'], project);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain('missing dependency');
  });

  it('rejects an ambiguous dependency without writing', () => {
    skill('a', 'metadata:\n  dependencies: "b"\n');
    skill('b');
    mkdirSync(join(source, 'duplicate'));
    writeFileSync(join(source, 'duplicate/SKILL.md'), readFileSync(join(source, 'b/SKILL.md')));
    const result = install();
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain('ambiguous');
    expect(existsSync(join(project, 'skills-lock.json'))).toBe(false);
  });

  it('rejects a dependency whose SKILL.md escapes through a symlink', () => {
    skill('a', 'metadata:\n  dependencies: "b"\n');
    skill('b');
    const outside = join(root, 'outside.md');
    writeFileSync(outside, readFileSync(join(source, 'b/SKILL.md')));
    rmSync(join(source, 'b/SKILL.md'));
    symlinkSync(outside, join(source, 'b/SKILL.md'));
    const result = install();
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain('escapes source');
    expect(existsSync(join(project, 'skills-lock.json'))).toBe(false);
  });

  function git(...args: string[]) {
    return execFileSync(
      'git',
      ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', ...args],
      {
        cwd: source,
        encoding: 'utf8',
        env: {
          ...process.env,
          GIT_CONFIG_GLOBAL: join(root, 'empty-gitconfig'),
          GIT_CONFIG_NOSYSTEM: '1',
        },
      }
    ).trim();
  }
  function repo() {
    skill('a', 'metadata:\n  dependencies: "b"\n');
    skill('b');
    git('init', '-q');
    git('add', '.');
    git('commit', '-qm', 'fixture');
    return pathToFileURL(source).href;
  }
  function remoteEnv(url: string) {
    const remote = 'https://fixture.invalid/repo.git';
    return {
      remote,
      env: {
        GIT_CONFIG_COUNT: '1',
        GIT_CONFIG_KEY_0: `url.${url}.insteadOf`,
        GIT_CONFIG_VALUE_0: remote,
      },
    };
  }
  it('uses the requested Git reference for every dependency', () => {
    const url = repo();
    git('tag', 'fixture-v1');
    writeFileSync(join(source, 'b/new.txt'), 'later revision');
    git('add', '.');
    git('commit', '-qm', 'later');
    const { remote, env } = remoteEnv(url);
    let result = runCli(['add', `${remote}#fixture-v1@a`, '-a', 'codex', '-y'], project, env);
    expect(result.exitCode, result.stdout).toBe(0);
    expect(existsSync(join(project, '.agents/skills/b/new.txt'))).toBe(false);
    expect(readLock().skills.b.ref).toBe('fixture-v1');
    result = runCli(['add', remote, '--skill', 'a', '-a', 'codex', '-y'], project, env);
    expect(result.exitCode, result.stdout).toBe(0);
  });

  it('installs dependencies globally using an isolated home', () => {
    skill('a', 'metadata:\n  dependencies: "b"\n');
    skill('b');
    const home = join(root, 'isolated home');
    mkdirSync(home);
    const result = runCli(
      ['add', source, '--skill', 'a', '-a', 'claude-code', '-y', '-g'],
      project,
      {
        HOME: home,
      }
    );
    expect(result.exitCode, result.stdout).toBe(0);
    expect(readFileSync(join(home, '.claude/skills/b/SKILL.md'), 'utf8')).toContain('name: b');
    const lock = JSON.parse(
      readFileSync(join(home, '.local/state/skills/.skill-lock.json'), 'utf8')
    );
    expect(Object.keys(lock.skills).sort()).toEqual(['a', 'b']);
  });
  it('updates B and its hash when A is unchanged', () => {
    const url = repo();
    const { remote, env } = remoteEnv(url);
    expect(
      runCli(['add', remote, '--skill', 'a', '-a', 'codex', '-y'], project, env).exitCode
    ).toBe(0);
    const before = readLock();
    writeFileSync(join(source, 'b/new.txt'), 'updated');
    git('add', '.');
    git('commit', '-qm', 'update B');
    const result = runCli(['update', '-p', '-y'], project, env);
    expect(result.exitCode, result.stdout + result.stderr).toBe(0);
    expect(readFileSync(join(project, '.agents/skills/b/new.txt'), 'utf8')).toBe('updated');
    const after = readLock();
    expect(after.skills.b.computedHash).not.toBe(before.skills.b.computedHash);
    expect(after.skills.a.computedHash).toBe(before.skills.a.computedHash);
  });
});

describe('dependency graph', () => {
  function skill(name: string, dependencies?: unknown, path = name): Skill {
    return { name, path, description: 'Test', rawContent: '', metadata: { dependencies } };
  }
  it('orders a diamond deterministically and deduplicates declarations', () => {
    const skills = [skill('a', 'b c b\n'), skill('b', 'd'), skill('c', 'd'), skill('d')];
    expect(resolveDependencyGraph([skills[0]!], skills).map((s) => s.name)).toEqual([
      'd',
      'b',
      'c',
      'a',
    ]);
    expect(skillDependencies(skill('a', ' \n'))).toEqual([]);
  });
  it('reports the causal chain for cycles and missing dependencies', () => {
    const a = skill('a', 'b');
    const b = skill('b', 'a');
    expect(() => resolveDependencyGraph([a], [a, b])).toThrow('a -> b -> a: dependency cycle');
    expect(() => resolveDependencyGraph([a], [a])).toThrow('a: b: missing dependency');
  });
  it('rejects ambiguous locations and normalized destination collisions', () => {
    const a = skill('a', 'b');
    expect(() => resolveDependencyGraph([a], [a, skill('b'), skill('b', '', 'other')])).toThrow(
      'ambiguous'
    );
    expect(() => resolveDependencyGraph([skill('A'), a], [a, skill('b')])).toThrow(
      'destination collision'
    );
  });
  it.each([null, [], true, 'https://host/b', 'b@v1', 'b/c', '*'])(
    'rejects invalid declarations %s',
    (value) => {
      expect(() => skillDependencies(skill('a', value))).toThrow();
    }
  );
  it('unsupported sources reject requirements but accept empty declarations', () => {
    expect(() => rejectUnsupportedDependencies([skill('a', 'b')], 'npm packages')).toThrow(
      'not supported for npm packages'
    );
    expect(() => rejectUnsupportedDependencies([skill('a', '')], 'downloads')).not.toThrow();
  });
});
