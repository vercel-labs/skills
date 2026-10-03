import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  writeFile,
  readFile,
  lstat,
  symlink,
} from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { removeCommand } from '../src/remove.ts';
import { addSkillToLocalLock, readLocalLock } from '../src/local-lock.ts';
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
    tempDir = await realpath(await mkdtemp(join(tmpdir(), 'skills-remove-test-')));
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

  it('preserves canonical storage through a symlinked agent directory while another agent uses it', async () => {
    const skillName = 'shared-skill';
    const canonicalDir = join(tempDir, '.agents/skills');
    const canonicalPath = join(canonicalDir, skillName);
    const claudeDir = join(tempDir, '.claude/skills');
    await mkdir(canonicalPath);
    await writeFile(join(canonicalPath, 'SKILL.md'), '# Shared skill');
    await rm(claudeDir, { recursive: true });
    await symlink(canonicalDir, claudeDir, 'junction');

    // Only the parent is a symlink; removing the child would delete canonical storage.
    expect((await lstat(join(claudeDir, skillName))).isSymbolicLink()).toBe(false);
    vi.mocked(agentsModule.detectInstalledAgents).mockResolvedValue(['claude-code', 'codex']);

    await removeCommand([skillName], { agent: ['claude-code'], yes: true });

    expect(await readFile(join(canonicalPath, 'SKILL.md'), 'utf-8')).toBe('# Shared skill');
    expect(await readFile(join(claudeDir, skillName, 'SKILL.md'), 'utf-8')).toBe('# Shared skill');
    expect((await lstat(claudeDir)).isSymbolicLink()).toBe(true);
  });

  it('removes a skill through a symlinked agent directory when the other agent has its own copy', async () => {
    const skillName = 'own-copy-skill';
    const canonicalDir = join(tempDir, '.agents/skills');
    const canonicalPath = join(canonicalDir, skillName);
    const claudeDir = join(tempDir, '.claude/skills');
    const continuePath = join(tempDir, '.continue/skills', skillName);
    await mkdir(canonicalPath);
    await writeFile(join(canonicalPath, 'SKILL.md'), '# Own copy skill');
    await mkdir(continuePath);
    await writeFile(join(continuePath, 'SKILL.md'), '# Own copy skill');
    await rm(claudeDir, { recursive: true });
    await symlink(canonicalDir, claudeDir, 'junction');
    await addSkillToLocalLock(skillName, {
      source: 'owner/repo',
      sourceType: 'github',
      computedHash: 'hash',
    });
    vi.mocked(agentsModule.detectInstalledAgents).mockResolvedValue(['claude-code', 'continue']);

    await removeCommand([skillName], { agent: ['claude-code'], yes: true });

    // Claude Code's view is the canonical copy, and continue does not read it.
    await expect(lstat(canonicalPath)).rejects.toThrow();
    expect(await readFile(join(continuePath, 'SKILL.md'), 'utf-8')).toBe('# Own copy skill');
    expect((await readLocalLock()).skills[skillName]).toBeDefined();
  });

  it('removes a canonical symlink through a symlinked agent directory when the other agent links past it', async () => {
    const skillName = 'linked-past-skill';
    const canonicalDir = join(tempDir, '.agents/skills');
    const canonicalPath = join(canonicalDir, skillName);
    const claudeDir = join(tempDir, '.claude/skills');
    const continuePath = join(tempDir, '.continue/skills', skillName);
    const sourcePath = join(tempDir, 'src', skillName);
    await mkdir(sourcePath, { recursive: true });
    await writeFile(join(sourcePath, 'SKILL.md'), '# Source skill');
    await addSkillToLocalLock(skillName, {
      source: sourcePath,
      sourceType: 'local',
      computedHash: 'test-hash',
    });
    await symlink(sourcePath, canonicalPath, 'junction');
    await symlink(sourcePath, continuePath, 'junction');
    await rm(claudeDir, { recursive: true });
    await symlink(canonicalDir, claudeDir, 'junction');
    vi.mocked(agentsModule.detectInstalledAgents).mockResolvedValue(['claude-code', 'continue']);

    await removeCommand([skillName], { agent: ['claude-code'], yes: true });

    // continue reaches the source directly, not through the canonical link.
    await expect(lstat(canonicalPath)).rejects.toThrow();
    expect(await readFile(join(continuePath, 'SKILL.md'), 'utf-8')).toBe('# Source skill');
  });

  it('removes canonical storage through a symlinked agent directory when no other agent uses it', async () => {
    const skillName = 'last-agent-skill';
    const canonicalDir = join(tempDir, '.agents/skills');
    const canonicalPath = join(canonicalDir, skillName);
    const claudeDir = join(tempDir, '.claude/skills');
    await mkdir(canonicalPath);
    await writeFile(join(canonicalPath, 'SKILL.md'), '# Last agent skill');
    await rm(claudeDir, { recursive: true });
    await symlink(canonicalDir, claudeDir, 'junction');
    vi.mocked(agentsModule.detectInstalledAgents).mockResolvedValue(['claude-code']);

    await removeCommand([skillName], { agent: ['claude-code'], yes: true });

    await expect(lstat(canonicalPath)).rejects.toThrow();
    expect((await lstat(claudeDir)).isSymbolicLink()).toBe(true);
    expect((await lstat(canonicalDir)).isDirectory()).toBe(true);
  });

  it('preserves a canonical symlink through a symlinked agent directory while another agent uses it', async () => {
    const skillName = 'foo';
    const canonicalDir = join(tempDir, '.agents/skills');
    const canonicalPath = join(canonicalDir, skillName);
    const claudeDir = join(tempDir, '.claude/skills');
    const sourcePath = join(tempDir, 'src', skillName);
    await mkdir(sourcePath, { recursive: true });
    await writeFile(join(sourcePath, 'SKILL.md'), '# Source skill');
    await addSkillToLocalLock(skillName, {
      source: sourcePath,
      sourceType: 'local',
      computedHash: 'test-hash',
    });
    await symlink(sourcePath, canonicalPath, 'junction');
    await rm(claudeDir, { recursive: true });
    await symlink(canonicalDir, claudeDir, 'junction');
    vi.mocked(agentsModule.detectInstalledAgents).mockResolvedValue(['claude-code', 'codex']);

    await removeCommand([skillName], { agent: ['claude-code'], yes: true });

    expect((await lstat(canonicalPath)).isSymbolicLink()).toBe(true);
    expect(await realpath(canonicalPath)).toBe(sourcePath);
    expect(await readFile(join(claudeDir, skillName, 'SKILL.md'), 'utf-8')).toBe('# Source skill');
    expect((await lstat(sourcePath)).isDirectory()).toBe(true);
    expect(await readFile(join(sourcePath, 'SKILL.md'), 'utf-8')).toBe('# Source skill');
    expect((await readLocalLock()).skills[skillName]).toBeDefined();
  });

  it('removes a canonical symlink through a symlinked agent directory when no other agent uses it', async () => {
    const skillName = 'foo';
    const canonicalDir = join(tempDir, '.agents/skills');
    const canonicalPath = join(canonicalDir, skillName);
    const claudeDir = join(tempDir, '.claude/skills');
    const sourcePath = join(tempDir, 'src', skillName);
    await mkdir(sourcePath, { recursive: true });
    await writeFile(join(sourcePath, 'SKILL.md'), '# Source skill');
    await addSkillToLocalLock(skillName, {
      source: sourcePath,
      sourceType: 'local',
      computedHash: 'test-hash',
    });
    await symlink(sourcePath, canonicalPath, 'junction');
    await rm(claudeDir, { recursive: true });
    await symlink(canonicalDir, claudeDir, 'junction');
    vi.mocked(agentsModule.detectInstalledAgents).mockResolvedValue(['claude-code']);

    await removeCommand([skillName], { agent: ['claude-code'], yes: true });

    await expect(lstat(canonicalPath)).rejects.toThrow();
    await expect(lstat(join(claudeDir, skillName))).rejects.toThrow();
    expect((await lstat(claudeDir)).isSymbolicLink()).toBe(true);
    expect((await lstat(sourcePath)).isDirectory()).toBe(true);
    expect(await readFile(join(sourcePath, 'SKILL.md'), 'utf-8')).toBe('# Source skill');
    expect((await readLocalLock()).skills[skillName]).toBeUndefined();
  });

  it('removes an agent directory linked from canonical storage when no other agent uses it', async () => {
    const skillName = 'last-agent-skill';
    const canonicalPath = join(tempDir, '.agents/skills', skillName);
    const claudePath = join(tempDir, '.claude/skills', skillName);
    await mkdir(claudePath);
    await writeFile(join(claudePath, 'SKILL.md'), '# Last agent skill');
    await symlink(claudePath, canonicalPath, 'junction');
    vi.mocked(agentsModule.detectInstalledAgents).mockResolvedValue(['claude-code']);

    await removeCommand([skillName], { agent: ['claude-code'], yes: true });

    await expect(lstat(canonicalPath)).rejects.toThrow();
    await expect(lstat(claudePath)).rejects.toThrow();
  });

  it.each([
    ['canonical storage', '.agents/skills'],
    ["Claude Code's directory", '.claude/skills'],
  ])(
    'preserves an agent directory linked from canonical storage while another agent links to %s',
    async (_, linkedDir) => {
      const skillName = 'shared-skill';
      const canonicalPath = join(tempDir, '.agents/skills', skillName);
      const claudePath = join(tempDir, '.claude/skills', skillName);
      const continuePath = join(tempDir, '.continue/skills', skillName);
      await mkdir(claudePath);
      await writeFile(join(claudePath, 'SKILL.md'), '# Shared skill');
      await symlink(claudePath, canonicalPath, 'junction');
      await symlink(join(tempDir, linkedDir, skillName), continuePath, 'junction');
      vi.mocked(agentsModule.detectInstalledAgents).mockResolvedValue(['claude-code', 'continue']);

      await removeCommand([skillName], { agent: ['claude-code'], yes: true });

      expect((await lstat(canonicalPath)).isSymbolicLink()).toBe(true);
      expect((await lstat(claudePath)).isDirectory()).toBe(true);
      expect((await lstat(continuePath)).isSymbolicLink()).toBe(true);
      expect(await readFile(join(canonicalPath, 'SKILL.md'), 'utf-8')).toBe('# Shared skill');
      expect(await readFile(join(claudePath, 'SKILL.md'), 'utf-8')).toBe('# Shared skill');
      expect(await readFile(join(continuePath, 'SKILL.md'), 'utf-8')).toBe('# Shared skill');
    }
  );
});
