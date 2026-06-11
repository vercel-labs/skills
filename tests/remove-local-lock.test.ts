import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdir, rm, writeFile, lstat, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { removeCommand } from '../src/remove.ts';
import * as agentsModule from '../src/agents.ts';
import { addSkillToLocalLock, readLocalLock } from '../src/local-lock.ts';

// Mock detectInstalledAgents
vi.mock('../src/agents.ts', async () => {
  const actual = await vi.importActual('../src/agents.ts');
  return {
    ...actual,
    detectInstalledAgents: vi.fn(),
  };
});

describe('removeCommand local lock cleanup', () => {
  let tempDir: string;
  let oldCwd: string;

  beforeEach(async () => {
    tempDir = await resolve(join(tmpdir(), 'skills-remove-lock-test-' + Date.now()));
    await mkdir(tempDir, { recursive: true });
    oldCwd = process.cwd();
    process.chdir(tempDir);

    // Setup canonical skills dir
    await mkdir(join(tempDir, '.agents/skills'), { recursive: true });

    // Mock: only claude-code detected
    vi.mocked(agentsModule.detectInstalledAgents).mockResolvedValue(['claude-code']);
  });

  afterEach(async () => {
    process.chdir(oldCwd);
    await rm(tempDir, { recursive: true, force: true });
  });

  it('should remove skill from local lock file on project-scoped removal', async () => {
    const skillName = 'test-skill';

    // 1. Create a skill in canonical dir
    const canonicalPath = join(tempDir, '.agents/skills', skillName);
    await mkdir(canonicalPath, { recursive: true });
    await writeFile(
      join(canonicalPath, 'SKILL.md'),
      '---\nname: test-skill\ndescription: test\n---\n',
      'utf-8'
    );

    // 2. Add entry to local lock file (simulating what add.ts does)
    await addSkillToLocalLock(
      skillName,
      { source: 'org/repo', sourceType: 'github', computedHash: 'abc123' },
      tempDir
    );

    // Verify lock file has the entry
    const lockBefore = await readLocalLock(tempDir);
    expect(lockBefore.skills[skillName]).toBeDefined();
    expect(lockBefore.skills[skillName]!.source).toBe('org/repo');

    // 3. Remove the skill (project-scoped, no --global)
    await removeCommand([skillName], { yes: true });

    // 4. Verify skill directory is removed
    await expect(lstat(canonicalPath)).rejects.toThrow();

    // 5. Verify local lock file entry is removed
    const lockAfter = await readLocalLock(tempDir);
    expect(lockAfter.skills[skillName]).toBeUndefined();
  });

  it('should remove multiple skills from local lock file', async () => {
    const skills = ['skill-a', 'skill-b'];

    // Create skills and lock entries
    for (const name of skills) {
      const canonicalPath = join(tempDir, '.agents/skills', name);
      await mkdir(canonicalPath, { recursive: true });
      await writeFile(
        join(canonicalPath, 'SKILL.md'),
        `---\nname: ${name}\ndescription: test\n---\n`,
        'utf-8'
      );
      await addSkillToLocalLock(
        name,
        { source: 'org/repo', sourceType: 'github', computedHash: `hash-${name}` },
        tempDir
      );
    }

    // Also add a third skill we will NOT remove, to verify it's preserved
    const keepName = 'skill-c';
    const keepPath = join(tempDir, '.agents/skills', keepName);
    await mkdir(keepPath, { recursive: true });
    await writeFile(
      join(keepPath, 'SKILL.md'),
      `---\nname: ${keepName}\ndescription: test\n---\n`,
      'utf-8'
    );
    await addSkillToLocalLock(
      keepName,
      { source: 'org/other', sourceType: 'github', computedHash: 'hash-c' },
      tempDir
    );

    // Remove skill-a and skill-b
    await removeCommand(skills, { yes: true });

    // Verify lock file
    const lock = await readLocalLock(tempDir);
    expect(lock.skills['skill-a']).toBeUndefined();
    expect(lock.skills['skill-b']).toBeUndefined();
    expect(lock.skills[keepName]).toBeDefined();
    expect(lock.skills[keepName]!.source).toBe('org/other');
  });

  it('should not fail if skill is not in local lock file', async () => {
    const skillName = 'orphan-skill';

    // Create skill on disk but NO lock entry
    const canonicalPath = join(tempDir, '.agents/skills', skillName);
    await mkdir(canonicalPath, { recursive: true });
    await writeFile(
      join(canonicalPath, 'SKILL.md'),
      '---\nname: orphan-skill\ndescription: test\n---\n',
      'utf-8'
    );

    // Remove should not throw
    await removeCommand([skillName], { yes: true });

    // Skill should be removed from disk
    await expect(lstat(canonicalPath)).rejects.toThrow();
  });
});
