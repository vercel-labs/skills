/**
 * Unit tests for skill folder hash computation.
 *
 * These tests verify that computeLocalSkillFolderHash correctly computes
 * the git tree SHA for skill folders, which is needed for update detection.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { execSync } from 'child_process';
import { computeLocalSkillFolderHash } from '../src/skill-lock.ts';

describe('computeLocalSkillFolderHash', () => {
  let tempDir: string;

  beforeAll(async () => {
    // Create a temporary git repository for testing
    tempDir = await mkdtemp(join(tmpdir(), 'skill-hash-test-'));

    // Initialize git repo
    execSync('git init', { cwd: tempDir, stdio: 'pipe' });
    execSync('git config user.email "test@test.com"', { cwd: tempDir, stdio: 'pipe' });
    execSync('git config user.name "Test User"', { cwd: tempDir, stdio: 'pipe' });

    // Create skill structure:
    // skills/
    //   my-skill/
    //     SKILL.md
    //   another-skill/
    //     SKILL.md
    // root-skill/
    //   SKILL.md
    await mkdir(join(tempDir, 'skills', 'my-skill'), { recursive: true });
    await mkdir(join(tempDir, 'skills', 'another-skill'), { recursive: true });
    await mkdir(join(tempDir, 'root-skill'), { recursive: true });

    await writeFile(join(tempDir, 'skills', 'my-skill', 'SKILL.md'), '# My Skill\n', 'utf-8');
    await writeFile(
      join(tempDir, 'skills', 'another-skill', 'SKILL.md'),
      '# Another Skill\n',
      'utf-8'
    );
    await writeFile(join(tempDir, 'root-skill', 'SKILL.md'), '# Root Skill\n', 'utf-8');
    await writeFile(join(tempDir, 'README.md'), '# Test Repo\n', 'utf-8');

    // Commit everything
    execSync('git add .', { cwd: tempDir, stdio: 'pipe' });
    execSync('git commit -m "Initial commit"', { cwd: tempDir, stdio: 'pipe' });
  });

  afterAll(async () => {
    // Clean up temp directory
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('should compute hash for skill in subdirectory (skills/my-skill/SKILL.md)', async () => {
    const hash = await computeLocalSkillFolderHash(tempDir, 'skills/my-skill/SKILL.md');
    expect(hash).toBeTruthy();
    expect(hash).toMatch(/^[a-f0-9]{40}$/);
  });

  it('should compute hash for skill in subdirectory without SKILL.md suffix', async () => {
    const hash1 = await computeLocalSkillFolderHash(tempDir, 'skills/my-skill/SKILL.md');
    const hash2 = await computeLocalSkillFolderHash(tempDir, 'skills/my-skill');
    expect(hash1).toBe(hash2);
  });

  it('should compute different hashes for different skills', async () => {
    const hash1 = await computeLocalSkillFolderHash(tempDir, 'skills/my-skill/SKILL.md');
    const hash2 = await computeLocalSkillFolderHash(tempDir, 'skills/another-skill/SKILL.md');
    expect(hash1).toBeTruthy();
    expect(hash2).toBeTruthy();
    expect(hash1).not.toBe(hash2);
  });

  it('should compute hash for skill at top level (root-skill/SKILL.md)', async () => {
    const hash = await computeLocalSkillFolderHash(tempDir, 'root-skill/SKILL.md');
    expect(hash).toBeTruthy();
    expect(hash).toMatch(/^[a-f0-9]{40}$/);
  });

  it('should return null for non-existent skill path', async () => {
    const hash = await computeLocalSkillFolderHash(tempDir, 'skills/non-existent/SKILL.md');
    expect(hash).toBeNull();
  });

  it('should handle paths with backslashes (Windows-style)', async () => {
    const hash1 = await computeLocalSkillFolderHash(tempDir, 'skills/my-skill/SKILL.md');
    const hash2 = await computeLocalSkillFolderHash(tempDir, 'skills\\my-skill\\SKILL.md');
    expect(hash1).toBe(hash2);
  });

  it('should handle paths with trailing slashes', async () => {
    const hash1 = await computeLocalSkillFolderHash(tempDir, 'skills/my-skill/SKILL.md');
    const hash2 = await computeLocalSkillFolderHash(tempDir, 'skills/my-skill/');
    expect(hash1).toBe(hash2);
  });

  it('should return null for invalid git repository', async () => {
    const nonGitDir = await mkdtemp(join(tmpdir(), 'non-git-'));
    try {
      const hash = await computeLocalSkillFolderHash(nonGitDir, 'skills/my-skill/SKILL.md');
      expect(hash).toBeNull();
    } finally {
      await rm(nonGitDir, { recursive: true, force: true });
    }
  });

  it('should compute hash for root-level skill (empty path)', async () => {
    // Create a root-level SKILL.md
    await writeFile(join(tempDir, 'SKILL.md'), '# Root Level Skill\n', 'utf-8');
    execSync('git add SKILL.md', { cwd: tempDir, stdio: 'pipe' });
    execSync('git commit -m "Add root SKILL.md"', { cwd: tempDir, stdio: 'pipe' });

    const hash = await computeLocalSkillFolderHash(tempDir, 'SKILL.md');
    expect(hash).toBeTruthy();
    expect(hash).toMatch(/^[a-f0-9]{40}$/);
  });
});
