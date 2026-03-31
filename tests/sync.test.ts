import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { runCli } from '../src/test-utils.ts';

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
      // Create a package with SKILL.md at root
      const pkgDir = join(testDir, 'node_modules', 'my-skill-pkg');
      mkdirSync(pkgDir, { recursive: true });
      writeFileSync(
        join(pkgDir, 'SKILL.md'),
        `---
name: root-skill
description: A skill at package root
---

# Root Skill
Instructions.
`
      );

      const result = runCli(['experimental_sync', '-y', '-a', 'claude-code'], testDir);
      expect(result.stdout).toContain('root-skill');
      expect(result.stdout).toContain('my-skill-pkg');
    });

    it('should find skills in skills/ subdirectory', () => {
      const skillDir = join(testDir, 'node_modules', 'my-lib', 'skills', 'helper-skill');
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(
        join(skillDir, 'SKILL.md'),
        `---
name: helper-skill
description: A helper skill in skills/ dir
---

# Helper
Instructions.
`
      );

      const result = runCli(['experimental_sync', '-y', '-a', 'claude-code'], testDir);
      expect(result.stdout).toContain('helper-skill');
      expect(result.stdout).toContain('my-lib');
    });

    it('should find skills in scoped packages', () => {
      const pkgDir = join(testDir, 'node_modules', '@acme', 'tools');
      mkdirSync(pkgDir, { recursive: true });
      writeFileSync(
        join(pkgDir, 'SKILL.md'),
        `---
name: acme-tool
description: A skill from a scoped package
---

# Acme Tool
Instructions.
`
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
    it('should write skills-lock.json after sync', () => {
      const pkgDir = join(testDir, 'node_modules', 'my-pkg');
      mkdirSync(pkgDir, { recursive: true });
      writeFileSync(
        join(pkgDir, 'SKILL.md'),
        `---
name: lock-test-skill
description: Test lock file writing
---

# Lock Test
Instructions.
`
      );

      runCli(['experimental_sync', '-y', '-a', 'claude-code'], testDir);

      const lockPath = join(testDir, 'skills-lock.json');
      expect(existsSync(lockPath)).toBe(true);

      const lock = JSON.parse(readFileSync(lockPath, 'utf-8'));
      expect(lock.version).toBe(1);
      expect(lock.skills['lock-test-skill']).toBeDefined();
      expect(lock.skills['lock-test-skill'].source).toBe('my-pkg');
      expect(lock.skills['lock-test-skill'].sourceType).toBe('node_modules');
      expect(lock.skills['lock-test-skill'].computedHash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should not have timestamps in lock entries', () => {
      const pkgDir = join(testDir, 'node_modules', 'my-pkg');
      mkdirSync(pkgDir, { recursive: true });
      writeFileSync(
        join(pkgDir, 'SKILL.md'),
        `---
name: no-timestamp-skill
description: No timestamps
---

# Test
`
      );

      runCli(['experimental_sync', '-y', '-a', 'claude-code'], testDir);

      const lock = JSON.parse(readFileSync(join(testDir, 'skills-lock.json'), 'utf-8'));
      const entry = lock.skills['no-timestamp-skill'];
      expect(entry.installedAt).toBeUndefined();
      expect(entry.updatedAt).toBeUndefined();
    });

    it('should sort skills alphabetically in lock file', () => {
      // Create three packages in reverse order
      for (const name of ['zebra-skill', 'alpha-skill', 'mid-skill']) {
        const pkgDir = join(testDir, 'node_modules', name);
        mkdirSync(pkgDir, { recursive: true });
        writeFileSync(
          join(pkgDir, 'SKILL.md'),
          `---
name: ${name}
description: ${name} description
---

# ${name}
`
        );
      }

      runCli(['experimental_sync', '-y', '-a', 'claude-code'], testDir);

      const raw = readFileSync(join(testDir, 'skills-lock.json'), 'utf-8');
      const keys = Object.keys(JSON.parse(raw).skills);
      expect(keys).toEqual(['alpha-skill', 'mid-skill', 'zebra-skill']);
    });

    it('should skip unchanged skills on second sync', () => {
      const pkgDir = join(testDir, 'node_modules', 'my-pkg');
      mkdirSync(pkgDir, { recursive: true });
      writeFileSync(
        join(pkgDir, 'SKILL.md'),
        `---
name: cached-skill
description: Test caching
---

# Cached
`
      );

      // First sync
      runCli(['experimental_sync', '-y', '-a', 'claude-code'], testDir);

      // Second sync - should say up to date
      const result = runCli(['experimental_sync', '-y', '-a', 'claude-code'], testDir);
      expect(result.stdout).toContain('up to date');
    });

    it('should reinstall when --force is used', () => {
      const pkgDir = join(testDir, 'node_modules', 'my-pkg');
      mkdirSync(pkgDir, { recursive: true });
      writeFileSync(
        join(pkgDir, 'SKILL.md'),
        `---
name: force-skill
description: Test force
---

# Force
`
      );

      // First sync
      runCli(['experimental_sync', '-y', '-a', 'claude-code'], testDir);

      // Second sync with --force should reinstall
      const result = runCli(['experimental_sync', '-y', '-a', 'claude-code', '--force'], testDir);
      expect(result.stdout).toContain('force-skill');
      expect(result.stdout).not.toContain('All skills are up to date');
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
        const dir = join(pkg, 'skills', name);
        mkdirSync(dir, { recursive: true });
        writeFileSync(
          join(dir, 'SKILL.md'),
          `---
name: ${name}
description: ${name} from multi package
---

# ${name}
`
        );
      }

      const result = runCli(['experimental_sync', '-y', '-a', 'claude-code'], testDir);
      expect(result.stdout).toContain('skill-one');
      expect(result.stdout).toContain('skill-two');
      expect(result.stdout).toContain('multi-skill-pkg');
    });
  });
});
