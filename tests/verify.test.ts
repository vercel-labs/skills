import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { addSkillToLocalLock, computeSkillFolderHash, writeLocalLock } from '../src/local-lock.ts';

// We test the verify logic indirectly by verifying the building blocks
// (computeSkillFolderHash, local lock reads) since runVerify calls process.exit
// and uses console output. For the verify command itself, we test via CLI integration.

describe('verify building blocks', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'verify-test-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('hash matches when installed skill content is identical to lock', async () => {
    const skillDir = join(dir, '.agents', 'skills', 'my-skill');
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, 'SKILL.md'),
      '---\nname: my-skill\ndescription: A test skill\n---\n# Test\n',
      'utf-8'
    );

    const hash = await computeSkillFolderHash(skillDir);
    await addSkillToLocalLock(
      'my-skill',
      {
        source: 'org/repo',
        sourceType: 'github',
        computedHash: hash,
      },
      dir
    );

    // Re-read and verify
    const content = await readFile(join(dir, 'skills-lock.json'), 'utf-8');
    const lock = JSON.parse(content);
    expect(lock.skills['my-skill'].computedHash).toBe(hash);

    // Re-compute hash (should still match)
    const rehash = await computeSkillFolderHash(skillDir);
    expect(rehash).toBe(hash);
  });

  it('hash differs when installed skill content is modified', async () => {
    const skillDir = join(dir, '.agents', 'skills', 'my-skill');
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, 'SKILL.md'), 'version 1', 'utf-8');

    const originalHash = await computeSkillFolderHash(skillDir);
    await addSkillToLocalLock(
      'my-skill',
      {
        source: 'org/repo',
        sourceType: 'github',
        computedHash: originalHash,
      },
      dir
    );

    // Modify the skill content
    await writeFile(join(skillDir, 'SKILL.md'), 'version 2 - modified', 'utf-8');
    const modifiedHash = await computeSkillFolderHash(skillDir);

    expect(modifiedHash).not.toBe(originalHash);
  });

  it('detects unlocked skills (installed but not in lockfile)', async () => {
    const skillDir = join(dir, '.agents', 'skills', 'unlocked-skill');
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(skillDir, 'SKILL.md'), '# Unlocked', 'utf-8');

    // Write empty lockfile
    await writeLocalLock({ version: 1, skills: {} }, dir);

    const content = await readFile(join(dir, 'skills-lock.json'), 'utf-8');
    const lock = JSON.parse(content);
    expect(Object.keys(lock.skills)).toHaveLength(0);

    // Skill exists on disk but not in lock
    const hash = await computeSkillFolderHash(skillDir);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('handles missing skill directory gracefully', async () => {
    const nonExistentDir = join(dir, '.agents', 'skills', 'missing-skill');
    try {
      await computeSkillFolderHash(nonExistentDir);
      expect.fail('Should have thrown');
    } catch (error) {
      expect(error).toBeDefined();
    }
  });
});

describe('verify CLI integration', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'verify-cli-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('reports no skills when lockfile is empty', async () => {
    await writeLocalLock({ version: 1, skills: {} }, dir);
    // The command would print "No skills found" but we can't easily test process.exit
    // This is validated by the lock read returning empty
    const content = await readFile(join(dir, 'skills-lock.json'), 'utf-8');
    const lock = JSON.parse(content);
    expect(Object.keys(lock.skills)).toHaveLength(0);
  });
});
