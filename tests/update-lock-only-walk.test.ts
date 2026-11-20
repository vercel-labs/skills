import { afterEach, describe, it, expect, beforeEach } from 'vitest';
import { execFileSync } from 'child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { runCli } from '../src/test-utils.ts';

describe('project update reads locked skill paths', () => {
  let root: string;
  let repo: string;
  let project: string;
  let repoUrl: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'skills-update-locked-paths-'));
    repo = join(root, 'repo');
    project = join(root, 'project');
    mkdirSync(join(repo, 'skills', 'alpha'), { recursive: true });
    mkdirSync(join(repo, 'broken'), { recursive: true });
    writeFileSync(
      join(repo, 'skills', 'alpha', 'SKILL.md'),
      '---\nname: alpha\ndescription: alpha\n---\n# alpha\n'
    );
    writeFileSync(
      join(repo, 'broken', 'SKILL.md'),
      '---\nname: broken\ndescription: Broken: this YAML is invalid\n---\n# broken\n'
    );
    commitRepo('skills');
    repoUrl = pathToFileURL(repo).href;
    mkdirSync(join(project, '.claude'), { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const add = () =>
    runCli(['add', repoUrl, '--skill', 'alpha', '-a', 'claude-code', '-y'], project);
  const update = () => runCli(['update', '-p', '-y'], project);
  const lock = () =>
    JSON.parse(readFileSync(join(project, 'skills-lock.json'), 'utf-8')) as {
      skills: Record<string, { skillPath: string }>;
    };

  function commitRepo(message: string): void {
    const git = (...args: string[]) =>
      execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
        cwd: repo,
        stdio: 'ignore',
      });
    if (!existsSync(join(repo, '.git'))) git('init', '-q');
    git('add', '.');
    git('commit', '-q', '-m', message);
  }

  it('does not warn about a broken SKILL.md outside the lock', () => {
    expect(add().exitCode).toBe(0);

    const result = update();

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('All project skills are up to date');
    expect(`${result.stdout}\n${result.stderr}`).not.toContain('YAML parse error');
  });

  it('still updates the skill recorded in the lock', () => {
    expect(add().exitCode).toBe(0);
    writeFileSync(
      join(repo, 'skills', 'alpha', 'SKILL.md'),
      '---\nname: alpha\ndescription: alpha\n---\n# alpha updated\n'
    );
    commitRepo('update alpha');

    const result = update();

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Updated alpha');
    expect(
      readFileSync(join(project, '.agents', 'skills', 'alpha', 'SKILL.md'), 'utf-8')
    ).toContain('# alpha updated');
  });

  it('falls back to discovery when a locked skill path is missing', () => {
    expect(add().exitCode).toBe(0);
    renameSync(join(repo, 'skills', 'alpha'), join(repo, 'skills', 'renamed'));
    commitRepo('move alpha');

    const result = update();

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Updated alpha');
    expect(lock().skills.alpha?.skillPath).toBe('skills/renamed/SKILL.md');
    expect(`${result.stdout}\n${result.stderr}`).not.toContain('failed to read file');
  });

  it('falls back to discovery when a locked skill no longer parses', () => {
    expect(add().exitCode).toBe(0);
    writeFileSync(
      join(repo, 'skills', 'alpha', 'SKILL.md'),
      '---\nname: alpha\ndescription: Alpha: now invalid\n---\n# alpha\n'
    );
    mkdirSync(join(repo, 'moved', 'alpha'), { recursive: true });
    writeFileSync(
      join(repo, 'moved', 'alpha', 'SKILL.md'),
      '---\nname: alpha\ndescription: alpha\n---\n# alpha moved\n'
    );
    commitRepo('break alpha, add copy');

    const result = update();

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Updated alpha');
    expect(lock().skills.alpha?.skillPath).toBe('moved/alpha/SKILL.md');
  });

  it('reports a locked skill that is gone upstream', () => {
    expect(add().exitCode).toBe(0);
    rmSync(join(repo, 'skills'), { recursive: true });
    commitRepo('remove alpha');

    const result = update();

    expect(result.stdout).toContain('appear to have been deleted upstream');
    expect(result.stdout).not.toContain('Updated alpha');
    expect(lock().skills.alpha?.skillPath).toBe('skills/alpha/SKILL.md');
  });

  it.each([
    ['skill directory', 'skills/alpha', (priv: string) => priv],
    ['SKILL.md', 'skills/alpha/SKILL.md', (priv: string) => join(priv, 'SKILL.md')],
  ])('does not follow a locked %s symlink outside the clone', (_, linkPath, target) => {
    if (process.platform === 'win32') return;
    expect(add().exitCode).toBe(0);
    const priv = join(root, 'private');
    mkdirSync(priv, { recursive: true });
    writeFileSync(join(priv, 'SKILL.md'), '---\nname: private\ndescription: p\n---\n# private\n');
    writeFileSync(join(priv, 'secret.txt'), 'secret');
    rmSync(join(repo, linkPath), { recursive: true });
    symlinkSync(target(priv), join(repo, linkPath));
    commitRepo('redirect alpha');

    update();

    const leaked = readdirSync(project, { recursive: true, withFileTypes: true }).filter(
      (entry) =>
        entry.isFile() &&
        /secret|# private/.test(readFileSync(join(entry.parentPath, entry.name), 'utf-8'))
    );
    expect(leaked.map((entry) => join(entry.parentPath, entry.name))).toEqual([]);
    expect(
      readFileSync(join(project, '.claude', 'skills', 'alpha', 'SKILL.md'), 'utf-8')
    ).toContain('# alpha');
  });

  it('keeps full discovery for generic Git sources', () => {
    const bare = join(root, 'repo.git');
    execFileSync('git', ['clone', '-q', '--bare', repo, bare], { stdio: 'ignore' });
    const gitUrl = pathToFileURL(bare).href;
    expect(
      runCli(['add', gitUrl, '--skill', 'alpha', '-a', 'claude-code', '-y'], project).exitCode
    ).toBe(0);

    const result = update();

    expect(result.exitCode).toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain('YAML parse error');
  });
});
