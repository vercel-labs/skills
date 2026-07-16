import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runCli } from '../src/test-utils.ts';

function createSkillSource(root: string, skillName: string): string {
  const sourceDir = join(root, 'source');
  const skillDir = join(sourceDir, skillName);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(
    join(skillDir, 'SKILL.md'),
    `---\nname: ${skillName}\ndescription: OMP test skill\n---\n# ${skillName}\n`
  );
  return sourceDir;
}

function isolatedEnv(root: string): Record<string, string> {
  const home = join(root, 'home');
  mkdirSync(home, { recursive: true });

  return {
    HOME: home,
    USERPROFILE: home,
  };
}

describe('OMP agent support', () => {
  let root: string;
  let projectDir: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'skills-omp-agent-'));
    projectDir = join(root, 'project');
    mkdirSync(projectDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('installs project skills into .omp/skills when --agent omp is used', () => {
    const skillName = 'omp-project-skill';
    const sourceDir = createSkillSource(root, skillName);
    mkdirSync(join(projectDir, '.omp'), { recursive: true });

    const result = runCli(
      ['add', sourceDir, '--skill', skillName, '--agent', 'omp', '-y'],
      projectDir,
      isolatedEnv(root)
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Done!');

    const installedSkill = join(projectDir, '.omp', 'skills', skillName, 'SKILL.md');
    expect(readFileSync(installedSkill, 'utf-8')).toContain(`name: ${skillName}`);
  });

  it('lists and removes project skills from .omp/skills with --agent omp', () => {
    const skillName = 'omp-list-remove-skill';
    const skillDir = join(projectDir, '.omp', 'skills', skillName);
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      `---\nname: ${skillName}\ndescription: OMP list/remove skill\n---\n# ${skillName}\n`
    );

    const env = isolatedEnv(root);
    const listResult = runCli(['list', '--agent', 'omp', '--json'], projectDir, env);

    expect(listResult.exitCode).toBe(0);
    const listed = JSON.parse(listResult.stdout.trim());
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      name: skillName,
      scope: 'project',
      agents: ['OMP'],
    });
    expect(listed[0].path).toMatch(/\.omp[/\\]skills[/\\]omp-list-remove-skill$/);

    const removeResult = runCli(['remove', skillName, '--agent', 'omp', '-y'], projectDir, env);

    expect(removeResult.exitCode).toBe(0);
    expect(removeResult.stdout).toContain('Successfully removed');
    expect(existsSync(skillDir)).toBe(false);
  });

  it('installs global skills into HOME/.omp/agent/skills when --agent omp --global is used', () => {
    const skillName = 'omp-global-skill';
    const sourceDir = createSkillSource(root, skillName);
    const env = { ...isolatedEnv(root), OMP_PROFILE: '' };

    const result = runCli(
      ['add', sourceDir, '--skill', skillName, '--agent', 'omp', '--global', '-y'],
      projectDir,
      env
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Done!');

    const installedSkill = join(env.HOME, '.omp', 'agent', 'skills', skillName, 'SKILL.md');
    expect(readFileSync(installedSkill, 'utf-8')).toContain(`name: ${skillName}`);
  });

  it('installs profile global skills into HOME/.omp/profiles/<profile>/agent/skills', () => {
    const skillName = 'omp-profile-global-skill';
    const sourceDir = createSkillSource(root, skillName);
    const env = { ...isolatedEnv(root), OMP_PROFILE: 'myprofile' };

    const result = runCli(
      ['add', sourceDir, '--skill', skillName, '--agent', 'omp', '--global', '-y'],
      projectDir,
      env
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Done!');

    const installedSkill = join(
      env.HOME,
      '.omp',
      'profiles',
      'myprofile',
      'agent',
      'skills',
      skillName,
      'SKILL.md'
    );
    expect(readFileSync(installedSkill, 'utf-8')).toContain(`name: ${skillName}`);
  });
});
