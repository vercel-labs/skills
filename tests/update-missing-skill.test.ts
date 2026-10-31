import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execFileSync } from 'child_process';
import { pathToFileURL } from 'url';
import { runCli } from '../src/test-utils.ts';

describe('update restores locked skills missing from disk', () => {
  let root: string;
  let project: string;
  let repoUrl: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'skills-update-missing-'));
    project = join(root, 'project');
    const repo = join(root, 'repo');
    mkdirSync(join(repo, 'skills', 'alpha'), { recursive: true });
    writeFileSync(
      join(repo, 'skills', 'alpha', 'SKILL.md'),
      '---\nname: alpha\ndescription: alpha\n---\n# alpha\n'
    );
    const git = (...args: string[]) =>
      execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
        cwd: repo,
        stdio: 'ignore',
      });
    git('init', '-q');
    git('add', '.');
    git('commit', '-q', '-m', 'skills');
    repoUrl = pathToFileURL(repo).href;
    mkdirSync(join(project, '.claude'), { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  // A single non-universal agent gets a copy, so no .agents/skills canonical dir exists.
  const skillDir = () => join(project, '.claude', 'skills', 'alpha');
  const add = () =>
    runCli(['add', repoUrl, '--skill', 'alpha', '-a', 'claude-code', '-y'], project);
  const update = () => runCli(['update', '-y'], project);

  it('reinstalls a project skill whose folder was deleted', () => {
    expect(add().exitCode).toBe(0);
    rmSync(skillDir(), { recursive: true });

    const result = update();

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Updated alpha');
    expect(existsSync(join(skillDir(), 'SKILL.md'))).toBe(true);
  });

  it('leaves an unchanged skill alone', () => {
    expect(add().exitCode).toBe(0);

    const result = update();

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('All project skills are up to date');
  });
});
