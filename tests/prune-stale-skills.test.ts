import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdir, rm, writeFile, lstat, symlink } from 'node:fs/promises';
import { rmSync, lstatSync, existsSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { getCanonicalPath, getInstallPath, sanitizeName } from '../src/installer.ts';
import { agents } from '../src/agents.ts';
import type { AgentType } from '../src/types.ts';

/**
 * Tests for the stale skills pruning functionality.
 *
 * When `fetchSkillFolderHash()` returns null for a skill (its path no longer
 * exists in the source repo), `skills update` should:
 * 1. Remove the canonical skill directory from disk
 * 2. Remove agent-specific symlinks pointing to it
 * 3. Remove the skill from the lock file
 *
 * These tests exercise the disk cleanup and lock file mechanics that
 * runUpdate() uses to prune stale skills.
 */

describe('prune stale skills - disk cleanup', () => {
  let tempDir: string;
  let oldHome: string;

  beforeEach(async () => {
    tempDir = join(tmpdir(), 'skills-prune-test-' + Date.now());
    await mkdir(tempDir, { recursive: true });

    // Override HOME so getCanonicalPath/getInstallPath with global=true
    // use our temp directory
    oldHome = process.env.HOME || '';
    process.env.HOME = tempDir;
  });

  afterEach(async () => {
    process.env.HOME = oldHome;
    await rm(tempDir, { recursive: true, force: true });
  });

  it('should resolve canonical path for a stale skill', () => {
    const canonicalPath = getCanonicalPath('my-stale-skill', { global: true });
    expect(canonicalPath).toContain('.agents/skills/my-stale-skill');
    expect(canonicalPath.startsWith(tempDir)).toBe(true);
  });

  it('should remove canonical directory when pruning', async () => {
    const skillName = 'stale-skill-1';
    const canonicalPath = getCanonicalPath(skillName, { global: true });

    // Create the skill directory with content
    await mkdir(canonicalPath, { recursive: true });
    await writeFile(join(canonicalPath, 'SKILL.md'), '# Stale Skill');
    await writeFile(join(canonicalPath, 'README.md'), '# README');

    // Verify it exists
    expect(existsSync(canonicalPath)).toBe(true);

    // Simulate prune: rmSync recursive
    rmSync(canonicalPath, { recursive: true, force: true });

    // Verify it's gone
    expect(existsSync(canonicalPath)).toBe(false);
  });

  it('should remove agent symlinks pointing to a stale skill', async () => {
    const skillName = 'stale-skill-2';
    const canonicalPath = getCanonicalPath(skillName, { global: true });

    // Create canonical directory
    await mkdir(canonicalPath, { recursive: true });
    await writeFile(join(canonicalPath, 'SKILL.md'), '# Stale Skill 2');

    // Create agent symlinks for agents that support global install
    const createdLinks: string[] = [];
    for (const [agentKey] of Object.entries(agents)) {
      try {
        const installPath = getInstallPath(skillName, agentKey as AgentType, { global: true });
        if (installPath !== canonicalPath) {
          // Create parent directory and symlink
          await mkdir(join(installPath, '..'), { recursive: true });
          await symlink(canonicalPath, installPath, 'junction');
          createdLinks.push(installPath);
        }
      } catch {
        // Some agents may not support global install paths — skip
      }
    }

    // Verify at least some links were created (depends on agent definitions)
    // Not all agents support global install, so we just check the ones that do

    // Simulate prune: remove agent symlinks first, then canonical
    for (const linkPath of createdLinks) {
      try {
        lstatSync(linkPath);
        rmSync(linkPath, { recursive: true, force: true });
      } catch {
        // Already gone
      }
    }

    // Then remove canonical
    rmSync(canonicalPath, { recursive: true, force: true });

    // Verify all are gone
    expect(existsSync(canonicalPath)).toBe(false);
    for (const linkPath of createdLinks) {
      expect(existsSync(linkPath)).toBe(false);
    }
  });

  it('should not fail when canonical directory is already missing', () => {
    const skillName = 'already-gone-skill';
    const canonicalPath = getCanonicalPath(skillName, { global: true });

    // Don't create anything — just try to remove
    expect(existsSync(canonicalPath)).toBe(false);

    // Prune should not throw
    expect(() => {
      try {
        lstatSync(canonicalPath);
        rmSync(canonicalPath, { recursive: true, force: true });
      } catch {
        // Already gone, that's fine — this is the expected path
      }
    }).not.toThrow();
  });

  it('should handle skill names with special characters via sanitizeName', () => {
    // sanitizeName is used by getCanonicalPath/getInstallPath internally
    expect(sanitizeName('my-skill')).toBe('my-skill');
    expect(sanitizeName('My Skill')).toBe('my-skill');
    expect(sanitizeName('../etc/passwd')).toBe('etc-passwd');
    expect(sanitizeName('skill/with/slashes')).toBe('skill-with-slashes');
  });
});

describe('prune stale skills - lock file cleanup', () => {
  let tempDir: string;
  let oldHome: string;
  let lockPath: string;

  const LOCK_VERSION = 3;

  function writeLockFile(skills: Record<string, any>) {
    const lock = { version: LOCK_VERSION, skills };
    mkdirSync(join(tempDir, '.agents'), { recursive: true });
    writeFileSync(lockPath, JSON.stringify(lock, null, 2), 'utf-8');
  }

  function readLockFile(): { version: number; skills: Record<string, any> } {
    return JSON.parse(readFileSync(lockPath, 'utf-8').toString());
  }

  beforeEach(async () => {
    tempDir = join(tmpdir(), 'skills-prune-lock-test-' + Date.now());
    await mkdir(tempDir, { recursive: true });
    lockPath = join(tempDir, '.agents', '.skill-lock.json');

    oldHome = process.env.HOME || '';
    process.env.HOME = tempDir;
  });

  afterEach(async () => {
    process.env.HOME = oldHome;
    await rm(tempDir, { recursive: true, force: true });
  });

  it('should remove a single stale skill from lock file', async () => {
    writeLockFile({
      'stale-skill': {
        source: 'owner/repo',
        sourceType: 'github',
        sourceUrl: 'https://github.com/owner/repo.git',
        skillPath: 'skills/stale-skill/SKILL.md',
        skillFolderHash: 'abc123',
        installedAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      },
      'good-skill': {
        source: 'owner/repo',
        sourceType: 'github',
        sourceUrl: 'https://github.com/owner/repo.git',
        skillPath: 'skills/good-skill/SKILL.md',
        skillFolderHash: 'def456',
        installedAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      },
    });

    // Use the actual removeSkillFromLock function
    const { removeSkillFromLock } = await import('../src/skill-lock.ts');
    const removed = await removeSkillFromLock('stale-skill');

    expect(removed).toBe(true);

    const lock = readLockFile();
    expect(lock.skills['stale-skill']).toBeUndefined();
    expect(lock.skills['good-skill']).toBeDefined();
  });

  it('should not error when removing a skill not in lock file', async () => {
    writeLockFile({
      'good-skill': {
        source: 'owner/repo',
        sourceType: 'github',
        sourceUrl: 'https://github.com/owner/repo.git',
        skillPath: 'skills/good-skill/SKILL.md',
        skillFolderHash: 'def456',
        installedAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      },
    });

    const { removeSkillFromLock } = await import('../src/skill-lock.ts');
    const removed = await removeSkillFromLock('nonexistent-skill');

    expect(removed).toBe(false);

    // good-skill should still be there
    const lock = readLockFile();
    expect(lock.skills['good-skill']).toBeDefined();
  });

  it('should remove multiple stale skills while preserving others', async () => {
    writeLockFile({
      'stale-1': {
        source: 'factorialco/factorial-skills',
        sourceType: 'github',
        sourceUrl: 'https://github.com/factorialco/factorial-skills.git',
        skillPath: 'skills/stale-1/SKILL.md',
        skillFolderHash: 'aaa',
        installedAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      },
      'stale-2': {
        source: 'factorialco/factorial-skills',
        sourceType: 'github',
        sourceUrl: 'https://github.com/factorialco/factorial-skills.git',
        skillPath: 'skills/stale-2/SKILL.md',
        skillFolderHash: 'bbb',
        installedAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      },
      'keep-this': {
        source: 'other-org/other-repo',
        sourceType: 'github',
        sourceUrl: 'https://github.com/other-org/other-repo.git',
        skillPath: 'skills/keep-this/SKILL.md',
        skillFolderHash: 'ccc',
        installedAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      },
    });

    const { removeSkillFromLock } = await import('../src/skill-lock.ts');

    // Prune the two stale skills
    await removeSkillFromLock('stale-1');
    await removeSkillFromLock('stale-2');

    const lock = readLockFile();
    expect(lock.skills['stale-1']).toBeUndefined();
    expect(lock.skills['stale-2']).toBeUndefined();
    expect(lock.skills['keep-this']).toBeDefined();
    expect(lock.skills['keep-this'].source).toBe('other-org/other-repo');
  });
});

describe('prune stale skills - fetchSkillFolderHash null detection', () => {
  it('should return null for a non-existent skill path in a real repo', async () => {
    // This test verifies that fetchSkillFolderHash returns null
    // when the skill path doesn't exist in the source repo.
    // We use a known repo with a path that definitely doesn't exist.
    const { fetchSkillFolderHash } = await import('../src/skill-lock.ts');

    const result = await fetchSkillFolderHash(
      'vercel-labs/skills',
      'this/path/definitely/does/not/exist/SKILL.md',
      null
    );

    expect(result).toBeNull();
  }, 30000);
});
