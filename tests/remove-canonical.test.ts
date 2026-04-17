import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdir, rm, writeFile, readFile, lstat, symlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { removeCommand } from '../src/remove.ts';
import * as agentsModule from '../src/agents.ts';

// Mock detectInstalledAgents
vi.mock('../src/agents.ts', async () => {
  const actual = await vi.importActual('../src/agents.ts');
  return {
    ...actual,
    detectInstalledAgents: vi.fn(),
  };
});

describe('removeCommand canonical protection', () => {
  let tempDir: string;
  let oldCwd: string;

  beforeEach(async () => {
    tempDir = await resolve(join(tmpdir(), 'skills-remove-test-' + Date.now()));
    await mkdir(tempDir, { recursive: true });
    oldCwd = process.cwd();
    process.chdir(tempDir);

    // Mock/Setup agent directories
    // We need to simulate the structure that getInstallPath and getCanonicalPath expect
    // Default skills dir is .agents/skills
    await mkdir(join(tempDir, '.agents/skills'), { recursive: true });

    // Setup two agents that use different dirs
    // Claude uses .claude/skills
    await mkdir(join(tempDir, '.claude/skills'), { recursive: true });
    // Continue uses .continue/skills
    await mkdir(join(tempDir, '.continue/skills'), { recursive: true });
  });

  afterEach(async () => {
    process.chdir(oldCwd);
    await rm(tempDir, { recursive: true, force: true });
  });

  it('should NOT remove canonical storage if other agents still have the skill installed', async () => {
    const skillName = 'test-skill';
    const canonicalPath = join(tempDir, '.agents/skills', skillName);
    const claudePath = join(tempDir, '.claude/skills', skillName);
    const continuePath = join(tempDir, '.continue/skills', skillName);

    // 1. Create canonical storage
    await mkdir(canonicalPath, { recursive: true });
    await writeFile(join(canonicalPath, 'SKILL.md'), '# Test');

    // 2. Install (symlink) to Claude and Continue
    await symlink(canonicalPath, claudePath, 'junction');
    await symlink(canonicalPath, continuePath, 'junction');

    // Verify setup
    expect(
      (await lstat(claudePath)).isSymbolicLink() || (await lstat(claudePath)).isDirectory()
    ).toBe(true);
    expect(
      (await lstat(continuePath)).isSymbolicLink() || (await lstat(continuePath)).isDirectory()
    ).toBe(true);

    // Mock agents: Claude and Continue are installed
    vi.mocked(agentsModule.detectInstalledAgents).mockResolvedValue(['claude-code', 'continue']);

    // 3. Remove from Claude only
    // -a claude-code
    await removeCommand([skillName], { agent: ['claude-code'], yes: true });

    // 4. Verify results
    // Claude path should be gone
    await expect(lstat(claudePath)).rejects.toThrow();

    // Canonical path SHOULD STILL EXIST because Continue uses it
    expect((await lstat(canonicalPath)).isDirectory()).toBe(true);

    // Continue path should still be valid
    expect(
      (await lstat(continuePath)).isSymbolicLink() || (await lstat(continuePath)).isDirectory()
    ).toBe(true);
  });

  it('should remove canonical storage if NO other agents are using it', async () => {
    const skillName = 'test-skill-2';
    const canonicalPath = join(tempDir, '.agents/skills', skillName);
    const claudePath = join(tempDir, '.claude/skills', skillName);

    await mkdir(canonicalPath, { recursive: true });
    await writeFile(join(canonicalPath, 'SKILL.md'), '# Test');
    await symlink(canonicalPath, claudePath, 'junction');

    // Mock agents: Only Claude is installed
    vi.mocked(agentsModule.detectInstalledAgents).mockResolvedValue(['claude-code']);

    // Remove from Claude
    await removeCommand([skillName], { agent: ['claude-code'], yes: true });

    // Both should be gone
    await expect(lstat(claudePath)).rejects.toThrow();
    await expect(lstat(canonicalPath)).rejects.toThrow();
  });

  it('should preserve local lock entry when skill is still used by another agent', async () => {
    const skillName = 'test-skill';
    const canonicalPath = join(tempDir, '.agents/skills', skillName);
    const claudePath = join(tempDir, '.claude/skills', skillName);
    const continuePath = join(tempDir, '.continue/skills', skillName);

    // Create canonical storage and symlinks
    await mkdir(canonicalPath, { recursive: true });
    await writeFile(join(canonicalPath, 'SKILL.md'), '# Test');
    await symlink(canonicalPath, claudePath, 'junction');
    await symlink(canonicalPath, continuePath, 'junction');

    // Write a lock file with the skill entry
    const lockPath = join(tempDir, 'skills-lock.json');
    await writeFile(
      lockPath,
      JSON.stringify({
        version: 2,
        skills: {
          'test-skill': {
            source: 'org/repo',
            sourceType: 'github',
            computedHash: 'abc123',
          },
        },
        management: {
          groups: { ai: ['test-skill'] },
          managerSkill: 'test-skill',
        },
      })
    );

    // Mock: both agents installed
    vi.mocked(agentsModule.detectInstalledAgents).mockResolvedValue(['claude-code', 'continue']);

    // Remove from Claude only
    await removeCommand([skillName], { agent: ['claude-code'], yes: true });

    // Lock entry should be preserved because Continue still uses it
    const lock = JSON.parse(await readFile(lockPath, 'utf-8'));
    expect(lock.skills['test-skill']).toBeDefined();
    expect(lock.skills['test-skill'].computedHash).toBe('abc123');
    expect(lock.management.groups.ai).toContain('test-skill');
    expect(lock.management.managerSkill).toBe('test-skill');
  });

  it('should remove local lock entry when no agents still use the skill', async () => {
    const skillName = 'test-skill-3';
    const canonicalPath = join(tempDir, '.agents/skills', skillName);
    const claudePath = join(tempDir, '.claude/skills', skillName);

    // Create canonical storage and symlink
    await mkdir(canonicalPath, { recursive: true });
    await writeFile(join(canonicalPath, 'SKILL.md'), '# Test');
    await symlink(canonicalPath, claudePath, 'junction');

    // Write a lock file with the skill entry
    const lockPath = join(tempDir, 'skills-lock.json');
    await writeFile(
      lockPath,
      JSON.stringify({
        version: 2,
        skills: {
          'test-skill-3': {
            source: 'org/repo',
            sourceType: 'github',
            computedHash: 'def456',
          },
          'other-skill': {
            source: 'org/other',
            sourceType: 'github',
            computedHash: 'ghi789',
          },
        },
        management: {
          groups: { ai: ['test-skill-3', 'other-skill'] },
          managerSkill: 'test-skill-3',
        },
      })
    );

    // Mock: only Claude installed
    vi.mocked(agentsModule.detectInstalledAgents).mockResolvedValue(['claude-code']);

    // Remove from Claude (only agent)
    await removeCommand([skillName], { agent: ['claude-code'], yes: true });

    // Lock entry should be removed since no agents use it anymore
    const lock = JSON.parse(await readFile(lockPath, 'utf-8'));
    expect(lock.skills['test-skill-3']).toBeUndefined();
    // Other skill should be untouched
    expect(lock.skills['other-skill']).toBeDefined();
    // Management should be scrubbed for test-skill-3 but not other-skill
    expect(lock.management.groups.ai).not.toContain('test-skill-3');
    expect(lock.management.groups.ai).toContain('other-skill');
    expect(lock.management.managerSkill).toBeUndefined();
  });
});
