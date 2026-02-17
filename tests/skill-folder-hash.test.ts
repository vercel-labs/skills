/**
 * Tests for computeLocalSkillFolderHash and fetchSkillFolderHash token usage.
 *
 * Validates that skill folder hashes can be computed locally from cloned repos,
 * providing a fallback when the GitHub API is unavailable (e.g., private repos).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execSync } from 'child_process';

import { computeLocalSkillFolderHash } from '../src/skill-lock.ts';

/**
 * Creates a temporary git repo with a skill folder structure for testing.
 * Returns the repo path and expected tree SHA for the skill folder.
 */
function createTestRepo(): { repoDir: string; skillTreeSha: string } {
  const repoDir = mkdtempSync(join(tmpdir(), 'skills-test-'));

  // Initialize git repo
  execSync('git init', { cwd: repoDir, stdio: 'pipe' });
  execSync('git config user.email "test@test.com"', { cwd: repoDir, stdio: 'pipe' });
  execSync('git config user.name "Test"', { cwd: repoDir, stdio: 'pipe' });

  // Create skill folder structure: skills/my-skill/SKILL.md
  const skillDir = join(repoDir, 'skills', 'my-skill');
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(
    join(skillDir, 'SKILL.md'),
    '---\nname: my-skill\ndescription: A test skill\n---\n# My Skill\n'
  );
  writeFileSync(join(skillDir, 'helper.md'), '# Helper\nSome helper content.\n');

  // Create a root-level SKILL.md too
  writeFileSync(join(repoDir, 'SKILL.md'), '---\nname: root-skill\ndescription: Root skill\n---\n');

  // Commit everything
  execSync('git add -A', { cwd: repoDir, stdio: 'pipe' });
  execSync('git commit -m "init"', { cwd: repoDir, stdio: 'pipe' });

  // Get the tree SHA for skills/my-skill using git rev-parse
  const skillTreeSha = execSync('git rev-parse HEAD:skills/my-skill', {
    cwd: repoDir,
    encoding: 'utf-8',
  }).trim();

  return { repoDir, skillTreeSha };
}

describe('computeLocalSkillFolderHash', () => {
  let repoDir: string;
  let expectedSha: string;

  beforeAll(() => {
    const { repoDir: dir, skillTreeSha } = createTestRepo();
    repoDir = dir;
    expectedSha = skillTreeSha;
  });

  afterAll(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  it('returns tree SHA for a skill in a subdirectory', () => {
    const hash = computeLocalSkillFolderHash(repoDir, 'skills/my-skill/SKILL.md');
    expect(hash).toBe(expectedSha);
  });

  it('returns tree SHA when skillPath has no SKILL.md suffix', () => {
    const hash = computeLocalSkillFolderHash(repoDir, 'skills/my-skill');
    expect(hash).toBe(expectedSha);
  });

  it('returns tree SHA with trailing slash', () => {
    const hash = computeLocalSkillFolderHash(repoDir, 'skills/my-skill/');
    expect(hash).toBe(expectedSha);
  });

  it('returns root tree SHA for root-level skill', () => {
    const hash = computeLocalSkillFolderHash(repoDir, 'SKILL.md');
    expect(hash).toBeTruthy();
    expect(typeof hash).toBe('string');
    expect(hash!.length).toBe(40); // SHA-1 hex
  });

  it('returns root tree SHA for empty skill path', () => {
    const hash = computeLocalSkillFolderHash(repoDir, '');
    expect(hash).toBeTruthy();
    expect(hash!.length).toBe(40);
  });

  it('returns null for non-existent skill path', () => {
    const hash = computeLocalSkillFolderHash(repoDir, 'skills/nonexistent/SKILL.md');
    expect(hash).toBeNull();
  });

  it('returns null for non-git directory', () => {
    const nonGitDir = mkdtempSync(join(tmpdir(), 'skills-nongit-'));
    try {
      const hash = computeLocalSkillFolderHash(nonGitDir, 'skills/my-skill');
      expect(hash).toBeNull();
    } finally {
      rmSync(nonGitDir, { recursive: true, force: true });
    }
  });

  it('handles backslash paths (Windows-style)', () => {
    const hash = computeLocalSkillFolderHash(repoDir, 'skills\\my-skill\\SKILL.md');
    expect(hash).toBe(expectedSha);
  });
});
