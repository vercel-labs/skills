import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { runCli } from '../src/test-utils.ts';

describe('check/update for project-local skills', () => {
  let rootDir: string;
  let projectDir: string;
  let sourceSkillDir: string;

  beforeEach(() => {
    rootDir = join(tmpdir(), `skills-local-update-${Date.now()}`);
    projectDir = join(rootDir, 'project');
    sourceSkillDir = join(rootDir, 'local-skill');

    mkdirSync(projectDir, { recursive: true });
    mkdirSync(sourceSkillDir, { recursive: true });

    writeFileSync(
      join(sourceSkillDir, 'SKILL.md'),
      `---
name: local-update-skill
description: test local update flow
---

# Local Update Skill
`
    );
    writeFileSync(join(sourceSkillDir, 'prompt.txt'), 'version one\n');
  });

  afterEach(() => {
    if (existsSync(rootDir)) {
      rmSync(rootDir, { recursive: true, force: true });
    }
  });

  it('detects and reapplies project-local skill changes from skills-lock.json', () => {
    const addResult = runCli(
      ['add', sourceSkillDir, '-y', '-a', 'github-copilot'],
      projectDir
    );
    expect(addResult.exitCode).toBe(0);

    const installedPromptPath = join(
      projectDir,
      '.agents',
      'skills',
      'local-update-skill',
      'prompt.txt'
    );
    expect(readFileSync(installedPromptPath, 'utf-8')).toBe('version one\n');

    writeFileSync(join(sourceSkillDir, 'prompt.txt'), 'version two\n');

    const checkResult = runCli(['check'], projectDir);
    expect(checkResult.exitCode).toBe(0);
    expect(checkResult.stdout).toContain('Updates available for 1 local skill');
    expect(checkResult.stdout).toContain('local-update-skill');

    const updateResult = runCli(['update'], projectDir);
    expect(updateResult.exitCode).toBe(0);
    expect(updateResult.stdout).toContain('Updated 1 local skill');
    expect(readFileSync(installedPromptPath, 'utf-8')).toBe('version two\n');

    const lock = JSON.parse(readFileSync(join(projectDir, 'skills-lock.json'), 'utf-8'));
    expect(lock.skills['local-update-skill']).toBeDefined();
    expect(lock.skills['local-update-skill'].sourceType).toBe('local');
  });
});
