import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'fs';
import { execFileSync } from 'child_process';
import { tmpdir } from 'os';
import { join, relative } from 'path';
import { pathToFileURL } from 'url';
import { createTestHomeEnvironment, runCli } from '../src/test-utils.ts';

const source = 'https://gitlab.com/skills-fixture/update-targets.git';

describe.each(['project', 'global'] as const)('%s update symlink destinations', (scope) => {
  let root: string;
  let repo: string;
  let project: string;
  let base: string;
  let env: Record<string, string>;
  const scopeFlags = scope === 'global' ? ['-g'] : ['--project'];
  const agentPath = (agent: string, skill = 'alpha') => join(base, agent, 'skills', skill);
  const canonicalPath = () => agentPath('.agents');
  const content = (path: string) => readFileSync(join(path, 'SKILL.md'), 'utf8');
  const git = (...args: string[]) =>
    execFileSync(
      'git',
      ['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.test', ...args],
      {
        cwd: repo,
        env: { ...process.env, ...env },
        stdio: 'pipe',
      }
    );
  const publish = (version: string, skill = 'alpha') => {
    mkdirSync(join(repo, 'skills', skill), { recursive: true });
    writeFileSync(
      join(repo, 'skills', skill, 'SKILL.md'),
      `---\nname: ${skill}\ndescription: ${skill}\n---\n${version}\n`
    );
    git('add', '.');
    git('commit', '-qm', `${skill} ${version}`);
  };
  const cli = (args: string[]) => {
    const result = runCli(args, project, env);
    expect(result.exitCode, result.stdout + result.stderr).toBe(0);
    return result;
  };
  const add = (skill = 'alpha', agent = 'claude-code') =>
    cli([
      'add',
      source,
      '--skill',
      skill,
      '-a',
      agent,
      'universal',
      '-y',
      ...(scope === 'global' ? ['-g'] : []),
    ]);
  const update = () => {
    const result = cli(['update', 'alpha', '-y', ...scopeFlags]);
    expect(result.stdout).toContain('Updated alpha');
  };

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'skills-update-targets-'));
    repo = join(root, 'repo');
    project = join(root, 'project');
    const home = join(root, 'home');
    base = scope === 'global' ? home : project;
    env = {
      ...createTestHomeEnvironment(home),
      GROK_HOME: join(home, '.grok'),
      SARVAM_HOME: join(home, '.sarvam'),
      GH_CONFIG_DIR: join(home, '.config', 'gh'),
      GITHUB_TOKEN: '',
      GH_TOKEN: '',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: join(root, 'gitconfig'),
      GIT_CONFIG_COUNT: '0',
      GIT_ALLOW_PROTOCOL: 'file',
      GIT_TERMINAL_PROMPT: '0',
    };
    mkdirSync(repo, { recursive: true });
    mkdirSync(project, { recursive: true });
    mkdirSync(join(base, '.claude'), { recursive: true });
    mkdirSync(join(base, '.hermes', 'skills'), { recursive: true });
    mkdirSync(join(home, '.hermes', 'skills'), { recursive: true });
    git('init', '-q');
    git(
      'config',
      '--file',
      join(root, 'gitconfig'),
      `url.${pathToFileURL(repo).href}.insteadOf`,
      source
    );
    publish('alpha v1');
    publish('beta v1', 'beta');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('updates shared content without adding destinations or restoring removed links', () => {
    add('beta', 'hermes-agent');
    add();
    const claude = agentPath('.claude');
    const hermes = agentPath('.hermes');
    const beta = agentPath('.hermes', 'beta');
    const claudeLink = readlinkSync(claude);
    const betaLink = readlinkSync(beta);
    expect(lstatSync(claude).isSymbolicLink()).toBe(true);
    expect(existsSync(hermes)).toBe(false);

    publish('alpha v2');
    update();

    expect(readlinkSync(claude)).toBe(claudeLink);
    expect(content(claude)).toContain('alpha v2');
    expect(() => lstatSync(hermes)).toThrow(/ENOENT/);
    expect(readlinkSync(beta)).toBe(betaLink);
    expect(content(beta)).toContain('beta v1');
    expect(existsSync(agentPath('.claude', 'beta'))).toBe(false);

    unlinkSync(claude);
    publish('alpha v3');
    update();

    expect(() => lstatSync(claude)).toThrow(/ENOENT/);
    expect(() => lstatSync(hermes)).toThrow(/ENOENT/);
    expect(content(canonicalPath())).toContain('alpha v3');

    add('alpha', 'hermes-agent');
    expect(lstatSync(hermes).isSymbolicLink()).toBe(true);
    expect(content(hermes)).toContain('alpha v3');
    expect(() => lstatSync(claude)).toThrow(/ENOENT/);
    expect(readlinkSync(beta)).toBe(betaLink);
    expect(content(beta)).toContain('beta v1');
    expect(existsSync(agentPath('.claude', 'beta'))).toBe(false);
  });

  it.each(['relative', 'absolute'] as const)(
    'preserves %s links through a symlinked parent',
    (kind) => {
      add();
      const skillsDir = join(base, '.claude', 'skills');
      const storage = join(root, 'claude-skills');
      renameSync(skillsDir, storage);
      symlinkSync(storage, skillsDir, process.platform === 'win32' ? 'junction' : 'dir');
      const claude = agentPath('.claude');
      unlinkSync(claude);
      const target =
        kind === 'absolute' || process.platform === 'win32'
          ? canonicalPath()
          : relative(storage, canonicalPath());
      symlinkSync(target, claude, process.platform === 'win32' ? 'junction' : 'dir');
      const link = readlinkSync(claude);
      rmSync(canonicalPath(), { recursive: true });
      expect(existsSync(claude)).toBe(false);

      publish('alpha v2');
      update();

      expect(readlinkSync(claude)).toBe(link);
      expect(content(claude)).toContain('alpha v2');
      expect(() => lstatSync(agentPath('.hermes'))).toThrow(/ENOENT/);
    }
  );

  it('leaves independent copies and foreign symlinks untouched', () => {
    add();
    const foreign = join(root, 'foreign-alpha');
    mkdirSync(foreign);
    writeFileSync(join(foreign, 'SKILL.md'), 'foreign content');
    const claude = agentPath('.claude');
    unlinkSync(claude);
    symlinkSync(foreign, claude, process.platform === 'win32' ? 'junction' : 'dir');
    const hermes = agentPath('.hermes');
    mkdirSync(hermes);
    writeFileSync(join(hermes, 'SKILL.md'), 'independent copy');
    const link = readlinkSync(claude);

    publish('alpha v2');
    update();

    expect(content(canonicalPath())).toContain('alpha v2');
    expect(readlinkSync(claude)).toBe(link);
    expect(content(claude)).toBe('foreign content');
    expect(lstatSync(hermes).isSymbolicLink()).toBe(false);
    expect(content(hermes)).toBe('independent copy');
  });
});
