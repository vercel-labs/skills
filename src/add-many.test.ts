import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { runCli } from './test-utils.ts';
import { buildChildArgs, groupSources } from './add-many.ts';

function writeSkill(root: string, name: string): void {
  const dir = join(root, 'skills', name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: Test skill ${name}\n---\n\n# ${name}\n`
  );
}

describe('groupSources', () => {
  it('keeps distinct repositories apart and reads @skill selections', () => {
    expect(
      groupSources([
        'anthropics/skills',
        'cloudflare/skills@wrangler,workers-best-practices',
        'vercel-labs/skills@find-skills',
      ])
    ).toEqual([
      { token: 'anthropics/skills', label: 'anthropics/skills' },
      {
        token: 'cloudflare/skills@wrangler,workers-best-practices',
        label: 'cloudflare/skills',
        skills: ['wrangler', 'workers-best-practices'],
      },
      {
        token: 'vercel-labs/skills@find-skills',
        label: 'vercel-labs/skills',
        skills: ['find-skills'],
      },
    ]);
  });

  it('merges tokens that name the same repository into one group', () => {
    expect(
      groupSources(['cloudflare/skills@wrangler', 'cloudflare/skills@durable-objects,wrangler'])
    ).toEqual([
      {
        token: 'cloudflare/skills@wrangler',
        label: 'cloudflare/skills',
        skills: ['wrangler', 'durable-objects'],
      },
    ]);
  });

  it('a token without a selection widens the group to the whole source', () => {
    expect(groupSources(['cloudflare/skills@wrangler', 'cloudflare/skills'])).toEqual([
      { token: 'cloudflare/skills', label: 'cloudflare/skills' },
    ]);
  });

  it('treats different refs of one repository as different sources', () => {
    const groups = groupSources(['owner/repo#main@a', 'owner/repo#v2@b']);
    expect(groups.map((g) => g.label)).toEqual(['owner/repo#main', 'owner/repo#v2']);
    expect(groups.map((g) => g.skills)).toEqual([['a'], ['b']]);
  });

  it('accepts URLs, git addresses and local paths', () => {
    const groups = groupSources([
      'https://github.com/owner/repo',
      'git@github.com:owner/other.git',
      '/tmp/some/skills',
    ]);
    expect(groups.map((g) => g.label)).toEqual([
      'https://github.com/owner/repo',
      'git@github.com:owner/other.git',
      '/tmp/some/skills',
    ]);
  });
});

describe('buildChildArgs', () => {
  it('runs each source as a non-interactive json install with the shared flags', () => {
    expect(
      buildChildArgs(
        { token: 'o/r@a', label: 'o/r', skills: ['a', 'b'] },
        { global: true, agent: ['claude-code', 'universal'], copy: true, fullDepth: true }
      )
    ).toEqual([
      'add',
      'o/r@a',
      '--json',
      '-y',
      '--skill',
      'a',
      'b',
      '-g',
      '--agent',
      'claude-code',
      'universal',
      '--copy',
      '--full-depth',
    ]);
  });

  it('forwards --list instead of installing', () => {
    expect(buildChildArgs({ token: 'o/r', label: 'o/r' }, { list: true })).toEqual([
      'add',
      'o/r',
      '--list',
    ]);
  });
});

describe('add with several sources', () => {
  let root: string;
  let home: string;
  let sourceA: string;
  let sourceB: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'skills-add-many-'));
    home = join(root, 'home');
    mkdirSync(home);
    sourceA = join(root, 'source-a');
    sourceB = join(root, 'source-b');
    writeSkill(sourceA, 'alpha');
    writeSkill(sourceA, 'alpha-two');
    writeSkill(sourceB, 'beta');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  // Local-path sources are not recorded in the global lock (upstream behaviour:
  // getOwnerRepo() is null for them), so these tests assert on installed files.
  // The lock plumbing is covered by lock-entries.test.ts and the project-scope
  // test below, whose skills-lock.json is written through the same child →
  // entries file → parent merge path.
  const installedSkills = () =>
    existsSync(join(home, '.claude', 'skills'))
      ? readdirSync(join(home, '.claude', 'skills')).sort()
      : [];

  it('installs every source and prints one line per source', () => {
    const result = runCli(['add', sourceA, sourceB, '-g', '--agent', 'claude-code', '-y'], root, {
      HOME: home,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(`+ ${sourceA}: `);
    expect(result.stdout).toContain('alpha');
    expect(result.stdout).toContain('alpha-two');
    expect(result.stdout).toContain(`+ ${sourceB}: beta`);
    expect(result.stdout).toMatch(/Installed 3 skills from 2 of 2 sources in \d+\.\ds/);
    // Single-source decoration must not leak through.
    expect(result.stdout).not.toContain('Done!');
    expect(installedSkills()).toEqual(['alpha', 'alpha-two', 'beta']);
  });

  it('rejects --skill with several sources and points at the @skill form', () => {
    const result = runCli(
      ['add', sourceA, sourceB, '-s', 'alpha', '-g', '--agent', 'claude-code', '-y'],
      root,
      { HOME: home }
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('--skill is ambiguous with several sources');
    expect(result.stderr).toContain('owner/repo@alpha');
    expect(installedSkills()).toEqual([]);
  });

  it('--json prints one merged array with the source on every entry', () => {
    const result = runCli(
      ['add', sourceA, sourceB, '-g', '--agent', 'claude-code', '-y', '--json'],
      root,
      { HOME: home }
    );

    expect(result.exitCode).toBe(0);
    const entries = JSON.parse(result.stdout);
    expect(entries.map((e: any) => [e.source, e.name, e.status, e.scope])).toEqual([
      [sourceA, 'alpha', 'installed', 'global'],
      [sourceA, 'alpha-two', 'installed', 'global'],
      [sourceB, 'beta', 'installed', 'global'],
    ]);
  });

  it('reports a failed source, keeps installing the others and exits non-zero', () => {
    const missing = join(root, 'does-not-exist');
    const result = runCli(['add', sourceB, missing, '-g', '--agent', 'claude-code', '-y'], root, {
      HOME: home,
    });

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain(`+ ${sourceB}: beta`);
    expect(result.stdout).toContain(`FAILED ${missing}: `);
    expect(result.stdout).toContain('does not exist');
    expect(result.stdout).toMatch(/Installed 1 skill from 1 of 2 sources in \d+\.\ds \(1 failed\)/);
    expect(installedSkills()).toEqual(['beta']);
  });

  it('project scope merges every source into skills-lock.json', () => {
    const project = join(root, 'project');
    mkdirSync(project);
    const result = runCli(['add', sourceA, sourceB, '--agent', 'claude-code', '-y'], project, {
      HOME: home,
    });

    expect(result.exitCode).toBe(0);
    const lock = JSON.parse(readFileSync(join(project, 'skills-lock.json'), 'utf-8'));
    expect(Object.keys(lock.skills).sort()).toEqual(['alpha', 'alpha-two', 'beta']);
    expect(existsSync(join(project, '.claude', 'skills', 'beta'))).toBe(true);
  });

  it('a prompt that cannot run without a TTY surfaces as a failure instead of hanging', () => {
    // No --agent and no detected agents: the child would have to ask.
    const result = runCli(['add', sourceA, sourceB, '-g', '-y'], root, { HOME: home }, 20000);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain('FAILED');
    expect(result.stdout).toContain('(2 failed)');
  });
});
