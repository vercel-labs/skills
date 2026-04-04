/**
 * Tests for the --skills-dir option.
 *
 * This option installs skills directly to a caller-specified directory,
 * bypassing agent detection, scope selection, symlink logic, and lock files.
 * It enables non-interactive, agent-driven installation.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, rmSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { runCli } from '../src/test-utils.ts';
import { installSkillToDir, sanitizeName } from '../src/installer.ts';
import { parseAddOptions } from '../src/add.ts';

// ─── CLI integration tests ───

describe('--skills-dir CLI', () => {
  let testDir: string;
  let targetDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `skills-dir-test-${Date.now()}`);
    targetDir = join(testDir, 'target-skills');
    mkdirSync(testDir, { recursive: true });
    mkdirSync(targetDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('installs a single skill to the specified directory', () => {
    const skillDir = join(testDir, 'my-skill');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      `---
name: my-skill
description: A test skill
---

# My Skill

Instructions here.
`
    );

    const result = runCli(['add', testDir, '--skills-dir', targetDir, '-y'], testDir);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Installed 1 skill');
    expect(result.stdout).toContain('Done!');

    // Verify the skill was copied
    const installedSkillDir = join(targetDir, 'my-skill');
    expect(existsSync(installedSkillDir)).toBe(true);
    expect(existsSync(join(installedSkillDir, 'SKILL.md'))).toBe(true);

    const content = readFileSync(join(installedSkillDir, 'SKILL.md'), 'utf-8');
    expect(content).toContain('name: my-skill');
  });

  it('installs multiple skills to the specified directory', () => {
    // Create two skills
    for (const name of ['skill-alpha', 'skill-beta']) {
      const dir = join(testDir, 'skills', name);
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, 'SKILL.md'),
        `---\nname: ${name}\ndescription: ${name} description\n---\n# ${name}\n`
      );
    }

    const result = runCli(['add', testDir, '--skills-dir', targetDir, '-y'], testDir);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Installed 2 skills');
    expect(existsSync(join(targetDir, 'skill-alpha', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(targetDir, 'skill-beta', 'SKILL.md'))).toBe(true);
  });

  it('works with --skill filter', () => {
    for (const name of ['wanted-skill', 'unwanted-skill']) {
      const dir = join(testDir, 'skills', name);
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, 'SKILL.md'),
        `---\nname: ${name}\ndescription: ${name}\n---\n# ${name}\n`
      );
    }

    const result = runCli(
      ['add', testDir, '--skills-dir', targetDir, '--skill', 'wanted-skill', '-y'],
      testDir
    );

    expect(result.exitCode).toBe(0);
    expect(existsSync(join(targetDir, 'wanted-skill', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(targetDir, 'unwanted-skill'))).toBe(false);
  });

  it('creates target directory if it does not exist', () => {
    const newTargetDir = join(testDir, 'nested', 'target');
    // newTargetDir does not exist yet

    const skillDir = join(testDir, 'my-skill');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      `---\nname: my-skill\ndescription: test\n---\n# My Skill\n`
    );

    const result = runCli(['add', testDir, '--skills-dir', newTargetDir, '-y'], testDir);

    expect(result.exitCode).toBe(0);
    expect(existsSync(join(newTargetDir, 'my-skill', 'SKILL.md'))).toBe(true);
  });

  it('does not create lock files', () => {
    const skillDir = join(testDir, 'my-skill');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      `---\nname: my-skill\ndescription: test\n---\n# My Skill\n`
    );

    runCli(['add', testDir, '--skills-dir', targetDir, '-y'], testDir);

    // No skills-lock.json should be created in the test working directory
    expect(existsSync(join(testDir, 'skills-lock.json'))).toBe(false);
  });

  it('does not create agent directories', () => {
    const skillDir = join(testDir, 'my-skill');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      `---\nname: my-skill\ndescription: test\n---\n# My Skill\n`
    );

    runCli(['add', testDir, '--skills-dir', targetDir, '-y'], testDir);

    // No .agents or .claude directories should be created
    expect(existsSync(join(testDir, '.agents'))).toBe(false);
    expect(existsSync(join(testDir, '.claude'))).toBe(false);
  });

  it('shows error for empty skill source', () => {
    // Empty directory — no skills
    const result = runCli(['add', testDir, '--skills-dir', targetDir, '-y'], testDir);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain('No skills found');
  });
});

// ─── parseAddOptions tests ───

describe('parseAddOptions --skills-dir', () => {
  it('parses --skills-dir with a path', () => {
    const { options } = parseAddOptions(['owner/repo', '--skills-dir', '/my/skills', '-y']);
    expect(options.targetDir).toBe('/my/skills');
    expect(options.yes).toBe(true);
  });

  it('parses --skills-dir with relative path', () => {
    const { options } = parseAddOptions(['source', '--skills-dir', './skills']);
    expect(options.targetDir).toBe('./skills');
  });

  it('does not set targetDir when --skills-dir is not used', () => {
    const { options } = parseAddOptions(['owner/repo', '-y', '-g']);
    expect(options.targetDir).toBeUndefined();
  });
});

// ─── installSkillToDir unit tests ───

describe('installSkillToDir', () => {
  let testDir: string;
  let targetDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `install-to-dir-test-${Date.now()}`);
    targetDir = join(testDir, 'target');
    mkdirSync(testDir, { recursive: true });
    mkdirSync(targetDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('copies skill files to the target directory', async () => {
    const skillSrc = join(testDir, 'source-skill');
    mkdirSync(skillSrc, { recursive: true });
    writeFileSync(join(skillSrc, 'SKILL.md'), '---\nname: demo\ndescription: demo\n---\n');
    writeFileSync(join(skillSrc, 'extra.txt'), 'extra content');

    const result = await installSkillToDir(
      { name: 'demo', description: 'demo', path: skillSrc },
      targetDir
    );

    expect(result.success).toBe(true);
    expect(result.path).toBe(join(targetDir, 'demo'));
    expect(readFileSync(join(targetDir, 'demo', 'SKILL.md'), 'utf-8')).toContain('name: demo');
    expect(readFileSync(join(targetDir, 'demo', 'extra.txt'), 'utf-8')).toBe('extra content');
  });

  it('sanitizes the skill name', async () => {
    const skillSrc = join(testDir, 'source');
    mkdirSync(skillSrc, { recursive: true });
    writeFileSync(join(skillSrc, 'SKILL.md'), '---\nname: My Skill!\ndescription: test\n---\n');

    const result = await installSkillToDir(
      { name: 'My Skill!', description: 'test', path: skillSrc },
      targetDir
    );

    expect(result.success).toBe(true);
    expect(result.path).toBe(join(targetDir, sanitizeName('My Skill!')));
    expect(existsSync(join(targetDir, 'my-skill', 'SKILL.md'))).toBe(true);
  });

  it('rejects path traversal in skill name', async () => {
    const skillSrc = join(testDir, 'source');
    mkdirSync(skillSrc, { recursive: true });
    writeFileSync(join(skillSrc, 'SKILL.md'), 'content');

    // sanitizeName turns '../escape' into 'escape' which is safe,
    // but let's verify the function doesn't break on adversarial names
    const result = await installSkillToDir(
      { name: '../../../escape', description: 'test', path: skillSrc },
      targetDir
    );

    // sanitizeName normalizes this to 'escape', which is safe
    expect(result.success).toBe(true);
    expect(result.path).toBe(join(targetDir, 'escape'));
  });

  it('overwrites existing skill directory', async () => {
    const skillSrc = join(testDir, 'source');
    mkdirSync(skillSrc, { recursive: true });
    writeFileSync(join(skillSrc, 'SKILL.md'), 'version 2');

    // Pre-create old version
    const existingDir = join(targetDir, 'overwrite-me');
    mkdirSync(existingDir, { recursive: true });
    writeFileSync(join(existingDir, 'SKILL.md'), 'version 1');
    writeFileSync(join(existingDir, 'old-file.txt'), 'should be removed');

    const result = await installSkillToDir(
      { name: 'overwrite-me', description: 'test', path: skillSrc },
      targetDir
    );

    expect(result.success).toBe(true);
    expect(readFileSync(join(targetDir, 'overwrite-me', 'SKILL.md'), 'utf-8')).toBe('version 2');
    // Old files should be cleaned up
    expect(existsSync(join(targetDir, 'overwrite-me', 'old-file.txt'))).toBe(false);
  });

  it('uses basename of path when skill name is empty', async () => {
    const skillSrc = join(testDir, 'fallback-name');
    mkdirSync(skillSrc, { recursive: true });
    writeFileSync(join(skillSrc, 'SKILL.md'), 'content');

    const result = await installSkillToDir(
      { name: '', description: 'test', path: skillSrc },
      targetDir
    );

    expect(result.success).toBe(true);
    // sanitizeName('') returns 'unnamed-skill', but since name is empty
    // it falls back to basename(skill.path) = 'fallback-name'
    expect(result.path).toBe(join(targetDir, 'fallback-name'));
  });
});
