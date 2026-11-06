import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { runCli } from '../src/test-utils.ts';

// Regression tests for #604: `remove --all -g` must only remove skills tracked in the
// global lock file, never user-managed skills that share the global skills directory.
describe('remove --all --global lockfile ownership', { timeout: 30000 }, () => {
  let testDir: string;
  let testHome: string;
  let globalSkillsDir: string;
  let lockPath: string;

  function createSkill(name: string): string {
    const skillDir = join(globalSkillsDir, name);
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      `---\nname: ${name}\ndescription: ${name} skill\n---\n\n# ${name}\n`
    );
    return skillDir;
  }

  function writeLock(skills: string[]) {
    mkdirSync(join(testHome, '.local', 'state', 'skills'), { recursive: true });
    const entries = Object.fromEntries(
      skills.map((name) => [
        name,
        {
          source: `example/${name}`,
          sourceType: 'github',
          sourceUrl: `https://github.com/example/${name}`,
          skillFolderHash: 'somehash',
          installedAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ])
    );
    writeFileSync(lockPath, JSON.stringify({ version: 3, skills: entries }, null, 2));
  }

  function readLockSkills(): Record<string, unknown> {
    return JSON.parse(readFileSync(lockPath, 'utf-8')).skills;
  }

  beforeEach(() => {
    testDir = join(tmpdir(), `skills-remove-global-lock-${Date.now()}`);
    testHome = join(testDir, 'home');
    globalSkillsDir = join(testHome, '.agents', 'skills');
    lockPath = join(testHome, '.local', 'state', 'skills', '.skill-lock.json');
    mkdirSync(join(testDir, 'project'), { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('removes only lockfile-tracked skills', () => {
    const managedDir = createSkill('managed-skill');
    const manualDir = createSkill('manual-skill');
    writeLock(['managed-skill']);

    const result = runCli(['remove', '--all', '--global', '-y'], join(testDir, 'project'), {
      HOME: testHome,
    });

    expect(result.exitCode).toBe(0);
    expect(existsSync(managedDir)).toBe(false);
    expect(existsSync(manualDir)).toBe(true);
    expect(readLockSkills()['managed-skill']).toBeUndefined();
  });

  it('still consults the lockfile when global directories are empty', () => {
    writeLock(['managed-skill']);

    const result = runCli(['remove', '--all', '--global', '-y'], join(testDir, 'project'), {
      HOME: testHome,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).not.toContain('No skills found to remove');
    expect(readLockSkills()['managed-skill']).toBeUndefined();
  });

  it('removes nothing when no global skills are tracked', () => {
    const manualDir = createSkill('manual-skill');

    const result = runCli(['remove', '--all', '--global', '-y'], join(testDir, 'project'), {
      HOME: testHome,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('No globally managed skills found to remove');
    expect(existsSync(manualDir)).toBe(true);
  });
});
