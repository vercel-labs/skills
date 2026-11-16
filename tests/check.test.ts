import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execFileSync } from 'child_process';
import { pathToFileURL } from 'url';
import { runCli } from '../src/test-utils.ts';

describe('check', () => {
  let root: string;
  let project: string;
  let repo: string;

  const writeUpstream = (body: string) => {
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
  const installed = () =>
    readFileSync(join(project, '.claude', 'skills', 'alpha', 'SKILL.md'), 'utf-8');

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'skills-check-'));
    project = join(root, 'project');
    repo = join(root, 'repo');
    mkdirSync(join(repo, 'skills', 'alpha'), { recursive: true });
    execFileSync('git', ['init', '-q'], { cwd: repo });
    writeUpstream('v1');
    mkdirSync(join(project, '.claude'), { recursive: true });
    const url = pathToFileURL(repo).href;
    expect(
      runCli(['add', url, '--skill', 'alpha', '-a', 'claude-code', '-y'], project).exitCode
    ).toBe(0);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('reports an update without installing it', () => {
    writeUpstream('v2');

    const result = runCli(['check'], project);

    expect(installed()).toContain('v1');
    expect(result.stdout).toContain('alpha has an update');
    expect(result.exitCode).toBe(1);
  });

  it('exits 0 when every skill is up to date', () => {
    expect(runCli(['check'], project).exitCode).toBe(0);
  });

  it('reports a skill whose installed files differ from the lock', () => {
    const skillMd = join(project, '.claude', 'skills', 'alpha', 'SKILL.md');
    writeFileSync(skillMd, readFileSync(skillMd, 'utf-8') + 'edited\n');

    const result = runCli(['check'], project);

    expect(result.stdout).toContain('alpha has local changes');
    expect(result.stdout).not.toContain('alpha has an update');
    expect(readFileSync(skillMd, 'utf-8')).toContain('edited');
    expect(result.exitCode).toBe(1);
  });

  it('does not report line-ending changes', () => {
    const skillMd = join(project, '.claude', 'skills', 'alpha', 'SKILL.md');
    // Flip the line endings: the clone is already CRLF where git uses core.autocrlf (Windows)
    const content = readFileSync(skillMd, 'utf-8');
    writeFileSync(
      skillMd,
      content.includes('\r\n') ? content.replaceAll('\r\n', '\n') : content.replaceAll('\n', '\r\n')
    );

    expect(runCli(['check'], project).exitCode).toBe(0);
  });
});
