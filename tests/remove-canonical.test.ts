import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdir, rm, writeFile, lstat, symlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { removeCommand } from '../src/remove.ts';
import * as agentsModule from '../src/agents.ts';

// Mock detectInstalledTargets
vi.mock('../src/agents.ts', async () => {
  const actual = await vi.importActual('../src/agents.ts');
  return {
    ...actual,
    detectInstalledTargets: vi.fn(),
  };
});

describe('removeCommand canonical protection', () => {
  let tempDir: string;
  let oldCwd: string;

  beforeEach(async () => {
    tempDir = await resolve(join(tmpdir(), 'agents-remove-test-' + Date.now()));
    await mkdir(tempDir, { recursive: true });
    oldCwd = process.cwd();
    process.chdir(tempDir);

    // Mock/Setup agent directories
    // We need to simulate the structure that getInstallPath and getCanonicalPath expect
    // Default agents dir is .agents/agents
    await mkdir(join(tempDir, '.agents/agents'), { recursive: true });

    // Setup two agents that use different dirs
    // Claude uses .claude/agents
    await mkdir(join(tempDir, '.claude/agents'), { recursive: true });
    // Continue uses .continue/agents
    await mkdir(join(tempDir, '.continue/agents'), { recursive: true });
  });

  afterEach(async () => {
    process.chdir(oldCwd);
    await rm(tempDir, { recursive: true, force: true });
  });

  it('should NOT remove canonical storage if other agents still have the agent installed', async () => {
    const agentName = 'test-agent';
    const canonicalPath = join(tempDir, '.agents/agents', agentName);
    const claudePath = join(tempDir, '.claude/agents', agentName);
    const continuePath = join(tempDir, '.continue/agents', agentName);

    // 1. Create canonical storage
    await mkdir(canonicalPath, { recursive: true });
    await writeFile(join(canonicalPath, 'AGENT.md'), '# Test');

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
    vi.mocked(agentsModule.detectInstalledTargets).mockResolvedValue(['claude-code', 'continue']);

    // 3. Remove from Claude only
    // -a claude-code
    await removeCommand([agentName], { agent: ['claude-code'], yes: true });

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
    const agentName = 'test-agent-2';
    const canonicalPath = join(tempDir, '.agents/agents', agentName);
    const claudePath = join(tempDir, '.claude/agents', agentName);

    await mkdir(canonicalPath, { recursive: true });
    await writeFile(join(canonicalPath, 'AGENT.md'), '# Test');
    await symlink(canonicalPath, claudePath, 'junction');

    // Mock agents: Only Claude is installed
    vi.mocked(agentsModule.detectInstalledTargets).mockResolvedValue(['claude-code']);

    // Remove from Claude
    await removeCommand([agentName], { agent: ['claude-code'], yes: true });

    // Both should be gone
    await expect(lstat(claudePath)).rejects.toThrow();
    await expect(lstat(canonicalPath)).rejects.toThrow();
  });
});
