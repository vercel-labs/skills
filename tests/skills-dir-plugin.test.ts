/**
 * Regression tests for skills that are also Claude Code skills-dir plugins.
 *
 * A folder with `.claude-plugin/plugin.json`, `hooks/` and `skills/<name>/SKILL.md`
 * but no root `SKILL.md` is loaded by Claude Code as `<name>@skills-dir`. Installing
 * only the nested skill drops the plugin manifest and hooks.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { discoverSkills } from '../src/skills.ts';
import { installSkillForAgent } from '../src/installer.ts';
import { runCli } from '../src/test-utils.ts';

describe('skills-dir plugin installs', () => {
  let testDir: string;
  let sourceRepo: string;
  let projectDir: string;
  let pluginDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `skills-dir-plugin-test-${Date.now()}`);
    sourceRepo = join(testDir, 'repo');
    projectDir = join(testDir, 'project');
    pluginDir = join(sourceRepo, 'skills', 'my-plugin');

    mkdirSync(join(pluginDir, '.claude-plugin'), { recursive: true });
    mkdirSync(join(pluginDir, 'hooks'), { recursive: true });
    mkdirSync(join(pluginDir, 'skills', 'my-skill'), { recursive: true });
    mkdirSync(projectDir, { recursive: true });

    writeFileSync(
      join(pluginDir, '.claude-plugin', 'plugin.json'),
      JSON.stringify({ name: 'my-plugin' })
    );
    writeFileSync(join(pluginDir, 'hooks', 'hooks.json'), JSON.stringify({ hooks: {} }));
    writeFileSync(
      join(pluginDir, 'skills', 'my-skill', 'SKILL.md'),
      '---\nname: my-skill\ndescription: Nested skill\n---\n'
    );
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('discovers the nested skill as part of its skills-dir plugin', async () => {
    const skills = await discoverSkills(sourceRepo);

    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe('my-skill');
    expect(skills[0].pluginName).toBe('my-plugin');
    expect(skills[0].pluginRoot).toBe(pluginDir);
  });

  it('still finds the plugin when the source points at the nested skill', async () => {
    const skills = await discoverSkills(sourceRepo, 'skills/my-plugin/skills/my-skill');

    expect(skills).toHaveLength(1);
    expect(skills[0].pluginName).toBe('my-plugin');
    expect(skills[0].pluginRoot).toBe(pluginDir);
  });

  it('copies the whole plugin folder for Claude Code in copy mode', () => {
    const result = runCli(
      ['add', sourceRepo, '-y', '--agent', 'claude-code', '--copy'],
      projectDir
    );

    expect(result.exitCode).toBe(0);

    const installed = join(projectDir, '.claude', 'skills', 'my-plugin');
    expect(readFileSync(join(installed, '.claude-plugin', 'plugin.json'), 'utf-8')).toContain(
      'my-plugin'
    );
    expect(existsSync(join(installed, 'hooks', 'hooks.json'))).toBe(true);
    expect(existsSync(join(installed, 'skills', 'my-skill', 'SKILL.md'))).toBe(true);
    // Only the nested skill used to be installed.
    expect(existsSync(join(projectDir, '.claude', 'skills', 'my-skill'))).toBe(false);
  });

  it('links the whole plugin folder for Claude Code in symlink mode', async () => {
    const skills = await discoverSkills(sourceRepo);
    expect(skills).toHaveLength(1);

    const result = await installSkillForAgent(skills[0]!, 'claude-code', {
      cwd: projectDir,
      mode: 'symlink',
    });

    expect(result.success).toBe(true);
    expect(result.canonicalPath).toBe(join(projectDir, '.agents', 'skills', 'my-plugin'));

    const linked = join(projectDir, '.claude', 'skills', 'my-plugin');
    expect(lstatSync(linked).isSymbolicLink()).toBe(true);
    expect(existsSync(join(linked, '.claude-plugin', 'plugin.json'))).toBe(true);
    expect(existsSync(join(linked, 'hooks', 'hooks.json'))).toBe(true);
    expect(existsSync(join(linked, 'skills', 'my-skill', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(projectDir, '.agents', 'skills', 'my-skill'))).toBe(false);
  });

  it('keeps installing the nested skill for agents without skills-dir plugins', () => {
    const result = runCli(['add', sourceRepo, '-y', '--agent', 'codex', '--copy'], projectDir);

    expect(result.exitCode).toBe(0);
    expect(existsSync(join(projectDir, '.agents', 'skills', 'my-skill', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(projectDir, '.agents', 'skills', 'my-plugin'))).toBe(false);
  });

  it('still installs a plugin scaffold with a root SKILL.md as one skill', () => {
    const scaffoldRepo = join(testDir, 'scaffold-repo');
    const scaffoldPlugin = join(scaffoldRepo, 'skills', 'scaffold-plugin');
    mkdirSync(join(scaffoldPlugin, '.claude-plugin'), { recursive: true });
    mkdirSync(join(scaffoldPlugin, 'hooks'), { recursive: true });
    mkdirSync(join(scaffoldPlugin, 'skills', 'inner-skill'), { recursive: true });
    writeFileSync(
      join(scaffoldPlugin, '.claude-plugin', 'plugin.json'),
      JSON.stringify({ name: 'scaffold-plugin' })
    );
    writeFileSync(join(scaffoldPlugin, 'hooks', 'hooks.json'), JSON.stringify({ hooks: {} }));
    writeFileSync(
      join(scaffoldPlugin, 'SKILL.md'),
      '---\nname: scaffold-plugin\ndescription: Scaffolded plugin\n---\n'
    );
    writeFileSync(
      join(scaffoldPlugin, 'skills', 'inner-skill', 'SKILL.md'),
      '---\nname: inner-skill\ndescription: Inner skill\n---\n'
    );

    const result = runCli(
      ['add', scaffoldRepo, '-y', '--agent', 'claude-code', '--copy'],
      projectDir
    );

    expect(result.exitCode).toBe(0);
    const installed = join(projectDir, '.claude', 'skills', 'scaffold-plugin');
    expect(existsSync(join(installed, 'SKILL.md'))).toBe(true);
    expect(existsSync(join(installed, '.claude-plugin', 'plugin.json'))).toBe(true);
    expect(existsSync(join(installed, 'hooks', 'hooks.json'))).toBe(true);
    expect(existsSync(join(installed, 'skills', 'inner-skill', 'SKILL.md'))).toBe(true);
  });
});
