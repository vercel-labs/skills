import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execFileSync } from 'child_process';
import { pathToFileURL } from 'url';
import { runCli } from '../src/test-utils.ts';

describe('add --rename', () => {
  let root: string;
  let repo: string;
  let project: string;
  let home: string;
  let repoUrl: string;

  const git = (...args: string[]) =>
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
      cwd: repo,
      stdio: 'ignore',
    });

  function writeUpstream(name: string, body: string): void {
    mkdirSync(join(repo, 'skills', name), { recursive: true });
    writeFileSync(
      join(repo, 'skills', name, 'SKILL.md'),
      `---\nname: ${name}\ndescription: the ${name} skill\nlicense: MIT\n---\n${body}\n`
    );
  }

  function commit(): void {
    git('add', '.');
    git('commit', '-q', '-m', 'skills');
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'skills-rename-'));
    repo = join(root, 'repo');
    project = join(root, 'project');
    home = join(root, 'home');
    mkdirSync(repo, { recursive: true });
    mkdirSync(join(project, '.claude'), { recursive: true });
    mkdirSync(home, { recursive: true });
    writeUpstream('alpha', '# alpha v1');
    writeUpstream('gamma', '# gamma');
    git('init', '-q');
    commit();
    repoUrl = pathToFileURL(repo).href;
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const cli = (args: string[]) => runCli(args, project, { HOME: home });
  // Git on Windows checks the clone out with CRLF; the rewrite keeps the file's line endings.
  const readText = (path: string) => readFileSync(path, 'utf-8').replace(/\r\n/g, '\n');
  const readLock = () => JSON.parse(readFileSync(join(project, 'skills-lock.json'), 'utf-8'));
  // A single non-universal agent gets a copy in its own directory.
  const claudeSkill = (name: string) => join(project, '.claude', 'skills', name, 'SKILL.md');
  const addRenamed = (...extra: string[]) =>
    cli([
      'add',
      repoUrl,
      '--skill',
      'alpha',
      '--rename',
      'beta',
      '-a',
      'claude-code',
      '-y',
      ...extra,
    ]);
  // Restore re-fetches git sources by URL + subpath, which file:// repos do not
  // support, so restore tests install from the local path instead.
  const addLocalRenamed = () =>
    cli(['add', repo, '--skill', 'alpha', '--rename', 'beta', '-a', 'claude-code', '-y']);

  it('installs the skill under the new name and records the source name', () => {
    const result = addRenamed();

    expect(result.exitCode).toBe(0);
    expect(existsSync(join(project, '.claude', 'skills', 'alpha'))).toBe(false);
    expect(readText(claudeSkill('beta'))).toBe(
      '---\nname: beta\ndescription: the alpha skill\nlicense: MIT\n---\n# alpha v1\n'
    );
    const lock = readLock();
    expect(Object.keys(lock.skills)).toEqual(['beta']);
    expect(lock.skills.beta).toMatchObject({
      skillName: 'alpha',
      skillPath: 'skills/alpha/SKILL.md',
    });
  });

  it('rewrites the shared copy and links agents to it in symlink mode', () => {
    const result = cli([
      'add',
      repoUrl,
      '--skill',
      'alpha',
      '--rename',
      'beta',
      '-a',
      'claude-code',
      '-a',
      'codex',
      '-y',
    ]);

    expect(result.exitCode).toBe(0);
    const canonical = join(project, '.agents', 'skills', 'beta', 'SKILL.md');
    expect(readText(canonical)).toContain('name: beta\n');
    expect(lstatSync(join(project, '.claude', 'skills', 'beta')).isSymbolicLink()).toBe(true);
    expect(readText(claudeSkill('beta'))).toContain('name: beta\n');
    // The source repo is never touched
    expect(readText(join(repo, 'skills', 'alpha', 'SKILL.md'))).toContain('name: alpha\n');
  });

  it('keeps the new name when the skill is updated', () => {
    expect(addRenamed().exitCode).toBe(0);
    writeUpstream('alpha', '# alpha v2');
    commit();

    const check = cli(['check']);
    expect(check.stdout).toContain('beta has an update');

    const result = cli(['update', '-y']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Updated beta');
    const installed = readText(claudeSkill('beta'));
    expect(installed).toContain('name: beta\n');
    expect(installed).toContain('# alpha v2');
    expect(existsSync(join(project, '.claude', 'skills', 'alpha'))).toBe(false);
    expect(readLock().skills.beta.skillName).toBe('alpha');

    expect(cli(['update', '-y']).stdout).toContain('All project skills are up to date');
  });

  it('restores the skill under the new name from skills-lock.json', () => {
    expect(addLocalRenamed().exitCode).toBe(0);
    const lockBefore = readLock();
    rmSync(join(project, '.claude', 'skills'), { recursive: true });

    const result = cli(['experimental_install', '--agent', 'claude-code']);

    expect(result.exitCode).toBe(0);
    expect(readText(claudeSkill('beta'))).toContain('name: beta\n');
    expect(existsSync(join(project, '.claude', 'skills', 'alpha'))).toBe(false);
    expect(readLock()).toEqual(lockBefore);
  });

  it('restores with --frozen-lockfile', () => {
    expect(addLocalRenamed().exitCode).toBe(0);
    rmSync(join(project, '.claude', 'skills'), { recursive: true });

    const result = cli(['experimental_install', '--agent', 'claude-code', '--frozen-lockfile']);

    expect(result.exitCode).toBe(0);
    expect(readText(claudeSkill('beta'))).toContain('name: beta\n');
  });

  it('can install the same skill both as-is and renamed', () => {
    expect(addLocalRenamed().exitCode).toBe(0);
    expect(cli(['add', repo, '--skill', 'alpha', '-a', 'claude-code', '-y']).exitCode).toBe(0);
    rmSync(join(project, '.claude', 'skills'), { recursive: true });

    const result = cli(['experimental_install', '--agent', 'claude-code']);

    expect(result.exitCode).toBe(0);
    expect(readText(claudeSkill('beta'))).toContain('name: beta\n');
    expect(readText(claudeSkill('alpha'))).toContain('name: alpha\n');
  });

  it('shows the source name in list', () => {
    expect(addRenamed().exitCode).toBe(0);

    expect(cli(['list']).stdout).toContain('(renamed from alpha)');
    const json = JSON.parse(cli(['list', '--json']).stdout);
    expect(json).toEqual([expect.objectContaining({ name: 'beta', renamedFrom: 'alpha' })]);
  });

  it('removes the skill by its new name', () => {
    expect(addRenamed().exitCode).toBe(0);

    expect(cli(['remove', 'beta', '-y']).exitCode).toBe(0);

    expect(existsSync(join(project, '.claude', 'skills', 'beta'))).toBe(false);
    expect(readLock().skills).toEqual({});
  });

  it('refuses to rename more than one skill', () => {
    const result = cli(['add', repoUrl, '--all', '--rename', 'beta']);

    expect(result.exitCode).toBe(1);
    expect(result.stdout + result.stderr).toContain('--rename installs one skill');
    expect(existsSync(join(project, 'skills-lock.json'))).toBe(false);
  });

  it('refuses a name that is not a safe folder name', () => {
    const result = cli(['add', repoUrl, '--skill', 'alpha', '--rename', 'Bad Name', '-y']);

    expect(result.exitCode).toBe(1);
    expect(result.stdout + result.stderr).toContain('--rename must be a skill name');
    expect(result.stdout + result.stderr).toContain('bad-name');
  });
});
