import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { runCli } from '../src/test-utils.ts';

function writeSkillMd(dir: string, name: string, description: string) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'SKILL.md'),
    `---
name: ${name}
description: ${description}
---

# ${name}
Instructions.
`
  );
}

describe('experimental_sync command', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `skills-sync-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('node_modules discovery', () => {
    it('should find SKILL.md at package root', () => {
      writeSkillMd(
        join(testDir, 'node_modules', 'my-skill-pkg'),
        'root-skill',
        'A skill at package root'
      );

      const result = runCli(['experimental_sync', '-y', '-a', 'claude-code'], testDir);
      expect(result.stdout).toContain('root-skill');
      expect(result.stdout).toContain('my-skill-pkg');
    });

    it('should find skills in skills/ subdirectory', () => {
      writeSkillMd(
        join(testDir, 'node_modules', 'my-lib', 'skills', 'helper-skill'),
        'helper-skill',
        'A helper skill in skills/ dir'
      );

      const result = runCli(['experimental_sync', '-y', '-a', 'claude-code'], testDir);
      expect(result.stdout).toContain('helper-skill');
      expect(result.stdout).toContain('my-lib');
    });

    it('should find skills in dist/skills/ subdirectory', () => {
      writeSkillMd(
        join(testDir, 'node_modules', 'my-lib', 'dist', 'skills', 'built-skill'),
        'built-skill',
        'A skill built to dist/'
      );

      const result = runCli(['experimental_sync', '-y', '-a', 'claude-code'], testDir);
      expect(result.stdout).toContain('built-skill');
      expect(result.stdout).toContain('my-lib');
    });

    it('should find skills in scoped packages', () => {
      writeSkillMd(
        join(testDir, 'node_modules', '@acme', 'tools'),
        'acme-tool',
        'A skill from a scoped package'
      );

      const result = runCli(['experimental_sync', '-y', '-a', 'claude-code'], testDir);
      expect(result.stdout).toContain('acme-tool');
      expect(result.stdout).toContain('@acme/tools');
    });

    it('should show no skills found when node_modules is empty', () => {
      mkdirSync(join(testDir, 'node_modules'), { recursive: true });

      const result = runCli(['experimental_sync', '-y'], testDir);
      expect(result.stdout).toContain('No skills found');
    });

    it('should show no skills found when no node_modules exists', () => {
      const result = runCli(['experimental_sync', '-y'], testDir);
      expect(result.stdout).toContain('No skills found');
    });
  });

  describe('skills-lock.json', () => {
    it('should write skills-lock.json after sync using targetName as key', () => {
      writeSkillMd(
        join(testDir, 'node_modules', 'my-pkg'),
        'lock-test-skill',
        'Test lock file writing'
      );

      runCli(['experimental_sync', '-y', '-a', 'claude-code'], testDir);

      const lockPath = join(testDir, 'skills-lock.json');
      expect(existsSync(lockPath)).toBe(true);

      const lock = JSON.parse(readFileSync(lockPath, 'utf-8'));
      expect(lock.version).toBe(1);
      // Key should be targetName (npm-my-pkg), not skill name
      expect(lock.skills['npm-my-pkg']).toBeDefined();
      expect(lock.skills['npm-my-pkg'].source).toBe('my-pkg');
      expect(lock.skills['npm-my-pkg'].sourceType).toBe('node_modules');
      expect(lock.skills['npm-my-pkg'].computedHash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should use targetName with skill dir name for subdir skills', () => {
      writeSkillMd(
        join(testDir, 'node_modules', 'my-lib', 'skills', 'my-skill'),
        'my-skill',
        'Test subdir lock'
      );

      runCli(['experimental_sync', '-y', '-a', 'claude-code'], testDir);

      const lock = JSON.parse(readFileSync(join(testDir, 'skills-lock.json'), 'utf-8'));
      expect(lock.skills['npm-my-lib-my-skill']).toBeDefined();
      expect(lock.skills['npm-my-lib-my-skill'].source).toBe('my-lib');
    });

    it('should not have timestamps in lock entries', () => {
      writeSkillMd(join(testDir, 'node_modules', 'my-pkg'), 'no-timestamp-skill', 'No timestamps');

      runCli(['experimental_sync', '-y', '-a', 'claude-code'], testDir);

      const lock = JSON.parse(readFileSync(join(testDir, 'skills-lock.json'), 'utf-8'));
      const entry = lock.skills['npm-my-pkg'];
      expect(entry.installedAt).toBeUndefined();
      expect(entry.updatedAt).toBeUndefined();
    });

    it('should sort skills alphabetically in lock file', () => {
      for (const name of ['zebra-skill', 'alpha-skill', 'mid-skill']) {
        writeSkillMd(join(testDir, 'node_modules', name), name, `${name} description`);
      }

      runCli(['experimental_sync', '-y', '-a', 'claude-code'], testDir);

      const raw = readFileSync(join(testDir, 'skills-lock.json'), 'utf-8');
      const keys = Object.keys(JSON.parse(raw).skills);
      expect(keys).toEqual(['npm-alpha-skill', 'npm-mid-skill', 'npm-zebra-skill']);
    });

    it('should skip unchanged skills on second sync', () => {
      writeSkillMd(join(testDir, 'node_modules', 'my-pkg'), 'cached-skill', 'Test caching');

      runCli(['experimental_sync', '-y', '-a', 'claude-code'], testDir);

      const result = runCli(['experimental_sync', '-y', '-a', 'claude-code'], testDir);
      expect(result.stdout).toContain('up to date');
    });

    it('should reinstall when --force is used', () => {
      writeSkillMd(join(testDir, 'node_modules', 'my-pkg'), 'force-skill', 'Test force');

      runCli(['experimental_sync', '-y', '-a', 'claude-code'], testDir);

      const result = runCli(['experimental_sync', '-y', '-a', 'claude-code', '--force'], testDir);
      expect(result.stdout).toContain('force-skill');
      expect(result.stdout).not.toContain('All skills are up to date');
    });
  });

  describe('npm-* symlink naming', () => {
    it('should create symlinks with npm- prefix for root SKILL.md', () => {
      writeSkillMd(join(testDir, 'node_modules', 'my-pkg'), 'my-skill', 'Test symlink naming');

      runCli(['experimental_sync', '-y', '-a', 'claude-code'], testDir);

      expect(existsSync(join(testDir, '.claude', 'skills', 'npm-my-pkg'))).toBe(true);
    });

    it('should create symlinks with npm-<pkg>-<skill> for subdir skills', () => {
      writeSkillMd(
        join(testDir, 'node_modules', 'my-lib', 'skills', 'coding'),
        'coding',
        'Test subdir symlink naming'
      );

      runCli(['experimental_sync', '-y', '-a', 'claude-code'], testDir);

      expect(existsSync(join(testDir, '.claude', 'skills', 'npm-my-lib-coding'))).toBe(true);
    });

    it('should handle scoped packages in symlink names', () => {
      writeSkillMd(
        join(testDir, 'node_modules', '@vercel', 'ai-sdk', 'skills', 'coding'),
        'coding',
        'Test scoped symlink'
      );

      runCli(['experimental_sync', '-y', '-a', 'claude-code'], testDir);

      expect(existsSync(join(testDir, '.claude', 'skills', 'npm-vercel-ai-sdk-coding'))).toBe(true);
    });
  });

  describe('--source option', () => {
    it('should filter to package.json deps by default', () => {
      writeFileSync(
        join(testDir, 'package.json'),
        JSON.stringify({
          dependencies: { 'dep-pkg': '^1.0.0' },
        })
      );
      writeSkillMd(join(testDir, 'node_modules', 'dep-pkg'), 'dep-skill', 'From dependency');
      writeSkillMd(
        join(testDir, 'node_modules', 'not-dep-pkg'),
        'not-dep-skill',
        'Not a dependency'
      );

      const result = runCli(['experimental_sync', '-y', '-a', 'claude-code'], testDir);
      expect(result.stdout).toContain('dep-skill');
      expect(result.stdout).not.toContain('not-dep-skill');
    });

    it('should scan all packages with --source node_modules', () => {
      writeFileSync(
        join(testDir, 'package.json'),
        JSON.stringify({
          dependencies: { 'dep-pkg': '^1.0.0' },
        })
      );
      writeSkillMd(join(testDir, 'node_modules', 'dep-pkg'), 'dep-skill', 'From dependency');
      writeSkillMd(
        join(testDir, 'node_modules', 'not-dep-pkg'),
        'not-dep-skill',
        'Not a dependency'
      );

      const result = runCli(
        ['experimental_sync', '-y', '-a', 'claude-code', '-s', 'node_modules'],
        testDir
      );
      expect(result.stdout).toContain('dep-skill');
      expect(result.stdout).toContain('not-dep-skill');
    });
  });

  describe('--include / --exclude', () => {
    it('should include only matching packages', () => {
      writeSkillMd(join(testDir, 'node_modules', 'pkg-a'), 'skill-a', 'Skill A');
      writeSkillMd(join(testDir, 'node_modules', 'pkg-b'), 'skill-b', 'Skill B');

      const result = runCli(
        [
          'experimental_sync',
          '-y',
          '-a',
          'claude-code',
          '-s',
          'node_modules',
          '--include',
          'pkg-a',
        ],
        testDir
      );
      expect(result.stdout).toContain('skill-a');
      expect(result.stdout).not.toContain('skill-b');
    });

    it('should exclude matching packages', () => {
      writeSkillMd(join(testDir, 'node_modules', 'pkg-a'), 'skill-a', 'Skill A');
      writeSkillMd(join(testDir, 'node_modules', 'pkg-b'), 'skill-b', 'Skill B');

      const result = runCli(
        [
          'experimental_sync',
          '-y',
          '-a',
          'claude-code',
          '-s',
          'node_modules',
          '--exclude',
          'pkg-a',
        ],
        testDir
      );
      expect(result.stdout).not.toContain('skill-a');
      expect(result.stdout).toContain('skill-b');
    });
  });

  describe('--dry-run', () => {
    it('should not create symlinks in dry-run mode', () => {
      writeSkillMd(join(testDir, 'node_modules', 'my-pkg'), 'dry-skill', 'Test dry run');

      const result = runCli(
        ['experimental_sync', '-y', '-a', 'claude-code', '--dry-run', '-s', 'node_modules'],
        testDir
      );
      expect(result.stdout).toContain('dry-skill');
      expect(result.stdout).toContain('Dry run');
      expect(existsSync(join(testDir, '.claude', 'skills', 'npm-my-pkg'))).toBe(false);
    });

    it('should not write skills-lock.json in dry-run mode', () => {
      writeSkillMd(join(testDir, 'node_modules', 'my-pkg'), 'dry-lock-skill', 'Test dry run lock');

      runCli(
        ['experimental_sync', '-y', '-a', 'claude-code', '--dry-run', '-s', 'node_modules'],
        testDir
      );
      expect(existsSync(join(testDir, 'skills-lock.json'))).toBe(false);
    });
  });

  describe('stale cleanup', () => {
    it('should remove stale npm-* symlinks', () => {
      // Create a stale symlink manually
      const skillsDir = join(testDir, '.claude', 'skills');
      mkdirSync(skillsDir, { recursive: true });
      mkdirSync(join(testDir, 'node_modules', 'stale-target'), { recursive: true });
      symlinkSync(join(testDir, 'node_modules', 'stale-target'), join(skillsDir, 'npm-stale-old'));

      // Create a real skill
      writeSkillMd(join(testDir, 'node_modules', 'my-pkg'), 'real-skill', 'Real skill');

      runCli(['experimental_sync', '-y', '-a', 'claude-code', '-s', 'node_modules'], testDir);

      // Stale symlink should be removed
      expect(existsSync(join(skillsDir, 'npm-stale-old'))).toBe(false);
      // Real skill should exist
      expect(existsSync(join(skillsDir, 'npm-my-pkg'))).toBe(true);
    });

    it('should not remove stale skills with --no-cleanup', () => {
      const skillsDir = join(testDir, '.claude', 'skills');
      mkdirSync(skillsDir, { recursive: true });
      mkdirSync(join(testDir, 'node_modules', 'stale-target'), { recursive: true });
      symlinkSync(join(testDir, 'node_modules', 'stale-target'), join(skillsDir, 'npm-stale-old'));

      writeSkillMd(join(testDir, 'node_modules', 'my-pkg'), 'real-skill', 'Real skill');

      runCli(
        ['experimental_sync', '-y', '-a', 'claude-code', '-s', 'node_modules', '--no-cleanup'],
        testDir
      );

      // Stale symlink should still exist
      expect(existsSync(join(skillsDir, 'npm-stale-old'))).toBe(true);
    });
  });

  describe('gitignore', () => {
    it('should add npm-* pattern to .gitignore', () => {
      writeFileSync(join(testDir, '.gitignore'), 'node_modules\n');
      writeSkillMd(join(testDir, 'node_modules', 'my-pkg'), 'gitignore-skill', 'Test gitignore');

      runCli(['experimental_sync', '-y', '-a', 'claude-code', '-s', 'node_modules'], testDir);

      const gitignore = readFileSync(join(testDir, '.gitignore'), 'utf-8');
      expect(gitignore).toContain('**/skills/npm-*');
    });

    it('should not modify .gitignore with --no-gitignore', () => {
      writeFileSync(join(testDir, '.gitignore'), 'node_modules\n');
      writeSkillMd(join(testDir, 'node_modules', 'my-pkg'), 'gitignore-skill', 'Test no gitignore');

      runCli(
        ['experimental_sync', '-y', '-a', 'claude-code', '-s', 'node_modules', '--no-gitignore'],
        testDir
      );

      const gitignore = readFileSync(join(testDir, '.gitignore'), 'utf-8');
      expect(gitignore).not.toContain('**/skills/npm-*');
    });
  });

  describe('CLI routing', () => {
    it('should show experimental_sync in help output', () => {
      const result = runCli(['--help']);
      expect(result.stdout).toContain('experimental_sync');
    });

    it('should show experimental_sync in banner', () => {
      const result = runCli([]);
      expect(result.stdout).toContain('experimental_sync');
    });
  });

  describe('multiple skills from one package', () => {
    it('should discover multiple skills in skills/ subdirectory', () => {
      const pkg = join(testDir, 'node_modules', 'multi-skill-pkg');
      for (const name of ['skill-one', 'skill-two']) {
        writeSkillMd(join(pkg, 'skills', name), name, `${name} from multi package`);
      }

      const result = runCli(
        ['experimental_sync', '-y', '-a', 'claude-code', '-s', 'node_modules'],
        testDir
      );
      expect(result.stdout).toContain('skill-one');
      expect(result.stdout).toContain('skill-two');
      expect(result.stdout).toContain('multi-skill-pkg');
    });
  });
});
