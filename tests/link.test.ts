import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, writeFileSync, rmSync, readFileSync, lstatSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { runCli } from '../src/test-utils.ts';

function createCanonicalSkill(root: string, skillName: string, content = '# Shared Skill\n') {
  const skillDir = join(root, '.agents', 'skills', skillName);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(
    join(skillDir, 'SKILL.md'),
    `---\nname: ${skillName}\ndescription: test skill\n---\n\n${content}`,
    'utf-8'
  );
}

function createGlobalCanonicalSkill(
  homeDir: string,
  skillName: string,
  content = '# Shared Skill\n'
) {
  const skillDir = join(homeDir, '.agents', 'skills', skillName);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(
    join(skillDir, 'SKILL.md'),
    `---\nname: ${skillName}\ndescription: test skill\n---\n\n${content}`,
    'utf-8'
  );
}

describe('link command', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(
      tmpdir(),
      `skills-link-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('shows link in help output', () => {
    const result = runCli(['--help']);
    expect(result.stdout).toContain('link [agent]');
    expect(result.stdout).toContain('Link global skills from ~/.agents/skills');
  });

  it('shows link in banner output', () => {
    const result = runCli([]);
    expect(result.stdout).toContain('npx skills link');
  });

  it('links canonical skills into a non-universal agent directory', () => {
    createCanonicalSkill(testDir, 'shared-skill');

    const result = runCli(['link', 'claude-code'], testDir);
    expect(result.exitCode).toBe(0);

    const canonicalPath = join(testDir, '.agents', 'skills', 'shared-skill');
    const agentPath = join(testDir, '.claude', 'skills', 'shared-skill');

    expect(existsSync(canonicalPath)).toBe(true);
    expect(existsSync(join(agentPath, 'SKILL.md'))).toBe(true);
    expect(readFileSync(join(agentPath, 'SKILL.md'), 'utf-8')).toContain('name: shared-skill');
    const agentStats = lstatSync(agentPath);
    expect(agentStats.isSymbolicLink() || agentStats.isDirectory()).toBe(true);
  });

  it('preserves canonical directories for universal agents', () => {
    createCanonicalSkill(testDir, 'universal-skill');

    const result = runCli(['link', 'codex'], testDir);
    expect(result.exitCode).toBe(0);

    const canonicalPath = join(testDir, '.agents', 'skills', 'universal-skill');
    expect(lstatSync(canonicalPath).isDirectory()).toBe(true);
    expect(readFileSync(join(canonicalPath, 'SKILL.md'), 'utf-8')).toContain(
      'name: universal-skill'
    );
  });

  it('auto-detects installed agents when none are provided', () => {
    createCanonicalSkill(testDir, 'detected-skill');
    mkdirSync(join(testDir, '.continue'), { recursive: true });

    const result = runCli(['link'], testDir);
    expect(result.exitCode).toBe(0);
    expect(existsSync(join(testDir, '.continue', 'skills', 'detected-skill', 'SKILL.md'))).toBe(
      true
    );
  });

  it('supports forced copy mode', () => {
    createCanonicalSkill(testDir, 'copy-skill');

    const result = runCli(['link', 'continue', '--copy'], testDir);
    expect(result.exitCode).toBe(0);

    const agentPath = join(testDir, '.continue', 'skills', 'copy-skill');
    expect(lstatSync(agentPath).isSymbolicLink()).toBe(false);
    expect(lstatSync(agentPath).isDirectory()).toBe(true);
    expect(readFileSync(join(agentPath, 'SKILL.md'), 'utf-8')).toContain('name: copy-skill');
  });

  it('links global canonical skills when -g is provided', () => {
    const homeDir = join(testDir, 'fake-home');
    createGlobalCanonicalSkill(homeDir, 'global-skill');

    const result = runCli(['link', '-g', 'continue'], testDir, {
      HOME: homeDir,
      USERPROFILE: homeDir,
    });
    expect(result.exitCode).toBe(0);

    const globalCanonicalPath = join(homeDir, '.agents', 'skills', 'global-skill');
    const globalAgentPath = join(homeDir, '.continue', 'skills', 'global-skill');
    const projectAgentPath = join(testDir, '.continue', 'skills', 'global-skill');

    expect(existsSync(globalCanonicalPath)).toBe(true);
    expect(existsSync(join(globalAgentPath, 'SKILL.md'))).toBe(true);
    expect(existsSync(projectAgentPath)).toBe(false);
    expect(readFileSync(join(globalAgentPath, 'SKILL.md'), 'utf-8')).toContain(
      'name: global-skill'
    );
  });
});
