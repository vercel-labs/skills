import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execFileSync } from 'child_process';
import { pathToFileURL } from 'url';
import { runCli } from '../src/test-utils.ts';
import { hashSkillText } from '../src/lineage.ts';

describe('add --record-lineage', () => {
  let root: string;
  let project: string;
  let repo: string;
  let source: string;

  const publish = (content: string) => {
    source = content;
    writeFileSync(join(repo, 'skills', 'alpha', 'SKILL.md'), content);
    const git = (...args: string[]) =>
      execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
        cwd: repo,
        stdio: 'ignore',
      });
    git('add', '.');
    git('commit', '-q', '-m', 'publish');
  };
  const head = () => execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo }).toString().trim();
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
  const installed = (agentDir = '.agents') =>
    readFileSync(join(project, agentDir, 'skills', 'alpha', 'SKILL.md'), 'utf-8');
  const derivedFrom = () => `${pathToFileURL(repo).href}/tree/${head()}/skills/alpha`;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'skills-lineage-'));
    project = join(root, 'project');
    repo = join(root, 'repo');
    mkdirSync(join(repo, 'skills', 'alpha'), { recursive: true });
    mkdirSync(join(project, '.claude'), { recursive: true });
    execFileSync('git', ['init', '-q'], { cwd: repo });
    publish(
      '---\nname: alpha\ndescription: Alpha skill\nmetadata:\n  author: acme\n  internal: false\n---\n# Alpha\n\nDo the thing.\n'
    );
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('writes derived-from and derived-from-hash into the installed copy', () => {
    expect(add('--record-lineage').exitCode).toBe(0);

    expect(installed()).toBe(
      '---\nname: alpha\ndescription: Alpha skill\nmetadata:\n  author: acme\n  internal: false\n' +
        `  derived-from: "${derivedFrom()}"\n` +
        `  derived-from-hash: "${hashSkillText(source)}"\n` +
        '---\n# Alpha\n\nDo the thing.\n'
    );
    // The copy is verbatim: its own normalised hash equals derived-from-hash.
    expect(hashSkillText(installed())).toBe(hashSkillText(source));
    // The source repository is untouched.
    expect(readFileSync(join(repo, 'skills', 'alpha', 'SKILL.md'), 'utf-8')).toBe(source);
  });

  it('leaves the installed copy unchanged without the flag', () => {
    expect(add().exitCode).toBe(0);
    expect(installed()).toBe(source);
  });

  it('creates metadata when the source has none', () => {
    publish('---\nname: alpha\ndescription: Alpha skill\n---\n# Alpha\n');
    expect(add('--record-lineage').exitCode).toBe(0);
    expect(installed()).toBe(
      '---\nname: alpha\ndescription: Alpha skill\nmetadata:\n' +
        `  derived-from: "${derivedFrom()}"\n` +
        `  derived-from-hash: "${hashSkillText(source)}"\n` +
        '---\n# Alpha\n'
    );
  });

  it('stamps every agent directory with --copy', () => {
    expect(add('--record-lineage', '--copy').exitCode).toBe(0);
    for (const agentDir of ['.agents', '.claude']) {
      expect(installed(agentDir)).toContain(`derived-from: "${derivedFrom()}"`);
    }
  });

  it('overwrites the keys on reinstall without duplicating them', () => {
    expect(add('--record-lineage').exitCode).toBe(0);
    const first = derivedFrom();
    publish(source.replace('Do the thing.', 'Do the other thing.'));
    expect(add('--record-lineage').exitCode).toBe(0);

    const content = installed();
    expect(content.match(/derived-from:/g)).toHaveLength(1);
    expect(content.match(/derived-from-hash:/g)).toHaveLength(1);
    expect(content).not.toContain(first);
    expect(content).toContain(`derived-from: "${derivedFrom()}"`);
    expect(content).toContain(`derived-from-hash: "${hashSkillText(source)}"`);
  });

  it('warns and still installs when the source is not a Git repository', () => {
    const result = runCli(
      [
        'add',
        join(repo, 'skills', 'alpha'),
        '-a',
        'claude-code',
        'universal',
        '-y',
        '--record-lineage',
      ],
      project
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Lineage not recorded');
    expect(installed()).toBe(source);
  });
});
