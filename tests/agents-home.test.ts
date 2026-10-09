import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, lstatSync, readdirSync } from 'fs';
import { rm } from 'fs/promises';
import { tmpdir, homedir } from 'os';
import { join } from 'path';
import { getAgentsHome } from '../src/constants.ts';
import { getCanonicalSkillsDir } from '../src/installer.ts';
import { getSkillLockPath } from '../src/skill-lock.ts';
import { runCli } from '../src/test-utils.ts';

describe('AGENTS_HOME', () => {
  const originalAgentsHome = process.env.AGENTS_HOME;
  const originalXdgStateHome = process.env.XDG_STATE_HOME;

  afterEach(() => {
    if (originalAgentsHome === undefined) delete process.env.AGENTS_HOME;
    else process.env.AGENTS_HOME = originalAgentsHome;
    if (originalXdgStateHome === undefined) delete process.env.XDG_STATE_HOME;
    else process.env.XDG_STATE_HOME = originalXdgStateHome;
  });

  it('defaults to ~/.agents when unset or blank', () => {
    delete process.env.AGENTS_HOME;
    expect(getAgentsHome()).toBe(join(homedir(), '.agents'));
    process.env.AGENTS_HOME = '   ';
    expect(getAgentsHome()).toBe(join(homedir(), '.agents'));
  });

  it('relocates the global canonical skills dir but not the project one', () => {
    const store = join(tmpdir(), 'agents-home-store');
    process.env.AGENTS_HOME = store;
    expect(getCanonicalSkillsDir(true)).toBe(join(store, 'skills'));
    expect(getCanonicalSkillsDir(false, '/some/project')).toBe(
      join('/some/project', '.agents', 'skills')
    );
  });

  it('relocates the global lock file unless XDG_STATE_HOME takes precedence', () => {
    const store = join(tmpdir(), 'agents-home-store');
    process.env.AGENTS_HOME = store;
    delete process.env.XDG_STATE_HOME;
    expect(getSkillLockPath()).toBe(join(store, '.skill-lock.json'));
    process.env.XDG_STATE_HOME = join(tmpdir(), 'xdg-state');
    expect(getSkillLockPath()).toBe(join(tmpdir(), 'xdg-state', 'skills', '.skill-lock.json'));
  });
});

describe('AGENTS_HOME (CLI)', () => {
  let testDir: string;
  let home: string;
  let store: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'agents-home-cli-'));
    home = join(testDir, 'home');
    store = join(testDir, 'store');
    mkdirSync(home, { recursive: true });

    const skillDir = join(testDir, 'source', 'skills', 'store-skill');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      `---
name: store-skill
description: Installed into a custom AGENTS_HOME
---

# Store skill
`
    );
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  const env = () => ({
    HOME: home,
    USERPROFILE: home,
    AGENTS_HOME: store,
    // Let the lock fall back to AGENTS_HOME instead of the isolated XDG state dir.
    XDG_STATE_HOME: '',
  });

  it('installs, lists and removes global skills entirely inside AGENTS_HOME', () => {
    const projectDir = join(testDir, 'project');
    mkdirSync(projectDir, { recursive: true });

    const add = runCli(
      ['add', join(testDir, 'source'), '-y', '-g', '--agent', 'universal'],
      projectDir,
      env()
    );
    expect(add.exitCode).toBe(0);

    const installed = join(store, 'skills', 'store-skill');
    expect(existsSync(join(installed, 'SKILL.md'))).toBe(true);
    expect(lstatSync(installed).isSymbolicLink()).toBe(false);
    // Local-path sources are not tracked in the global lock; the lock location
    // itself is covered by the getSkillLockPath unit test above.
    expect(existsSync(join(home, '.agents'))).toBe(false);
    expect(readdirSync(home)).not.toContain('.agents');

    const list = runCli(['list', '-g', '--json'], projectDir, env());
    expect(list.exitCode).toBe(0);
    const entries = JSON.parse(list.stdout) as Array<{ name: string; path: string }>;
    const entry = entries.find((e) => e.name === 'store-skill');
    expect(entry?.path.startsWith(store)).toBe(true);

    const remove = runCli(
      ['remove', 'store-skill', '-y', '-g', '--agent', 'universal'],
      projectDir,
      env()
    );
    expect(remove.exitCode).toBe(0);
    expect(existsSync(installed)).toBe(false);
  });
});
