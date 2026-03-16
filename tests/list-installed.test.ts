import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdir, writeFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { listInstalledAgents } from '../src/installer.ts';
import * as agentsModule from '../src/agents.ts';

describe('listInstalledAgents', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `add-agent-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  // Helper to create a agent directory with AGENT.md
  async function createSkillDir(
    basePath: string,
    agentName: string,
    skillData: { name: string; description: string }
  ): Promise<string> {
    const agentDir = join(basePath, '.agents', 'agents', agentName);
    await mkdir(agentDir, { recursive: true });
    const skillMdContent = `---
name: ${skillData.name}
description: ${skillData.description}
---

# ${skillData.name}

${skillData.description}
`;
    await writeFile(join(agentDir, 'AGENT.md'), skillMdContent);
    return agentDir;
  }

  it('should return empty array for empty directory', async () => {
    const agents = await listInstalledAgents({ global: false, cwd: testDir });
    expect(agents).toEqual([]);
  });

  it('should find single agent in project directory', async () => {
    await createSkillDir(testDir, 'test-agent', {
      name: 'test-agent',
      description: 'A test agent',
    });

    const agents = await listInstalledAgents({ global: false, cwd: testDir });
    expect(agents).toHaveLength(1);
    expect(agents[0]!.name).toBe('test-agent');
    expect(agents[0]!.description).toBe('A test agent');
    expect(agents[0]!.scope).toBe('project');
  });

  it('should find multiple agents', async () => {
    await createSkillDir(testDir, 'agent-1', {
      name: 'agent-1',
      description: 'First agent',
    });
    await createSkillDir(testDir, 'agent-2', {
      name: 'agent-2',
      description: 'Second agent',
    });

    const agents = await listInstalledAgents({ global: false, cwd: testDir });
    expect(agents).toHaveLength(2);
    const agentNames = agents.map((s) => s.name).sort();
    expect(agentNames).toEqual(['agent-1', 'agent-2']);
  });

  it('should ignore directories without AGENT.md', async () => {
    await createSkillDir(testDir, 'valid-agent', {
      name: 'valid-agent',
      description: 'Valid agent',
    });

    // Create a directory without AGENT.md
    const invalidDir = join(testDir, '.agents', 'agents', 'invalid-agent');
    await mkdir(invalidDir, { recursive: true });
    await writeFile(join(invalidDir, 'other-file.txt'), 'content');

    const agents = await listInstalledAgents({ global: false, cwd: testDir });
    expect(agents).toHaveLength(1);
    expect(agents[0]!.name).toBe('valid-agent');
  });

  it('should handle invalid AGENT.md gracefully', async () => {
    await createSkillDir(testDir, 'valid-agent', {
      name: 'valid-agent',
      description: 'Valid agent',
    });

    // Create a directory with invalid AGENT.md (missing name/description)
    const invalidDir = join(testDir, '.agents', 'agents', 'invalid-agent');
    await mkdir(invalidDir, { recursive: true });
    await writeFile(join(invalidDir, 'AGENT.md'), '# Invalid\nNo frontmatter');

    const agents = await listInstalledAgents({ global: false, cwd: testDir });
    expect(agents).toHaveLength(1);
    expect(agents[0]!.name).toBe('valid-agent');
  });

  it('should filter by scope - project only', async () => {
    await createSkillDir(testDir, 'project-agent', {
      name: 'project-agent',
      description: 'Project agent',
    });

    const agents = await listInstalledAgents({ global: false, cwd: testDir });
    expect(agents).toHaveLength(1);
    expect(agents[0]!.scope).toBe('project');
  });

  it('should handle global scope option', async () => {
    // Test with global: true - verifies the function doesn't crash
    // Note: This checks ~/.agents/agents, results depend on system state
    const agents = await listInstalledAgents({
      global: true,
      cwd: testDir,
    });
    expect(Array.isArray(agents)).toBe(true);
  });

  it('should apply agent filter', async () => {
    await createSkillDir(testDir, 'test-agent', {
      name: 'test-agent',
      description: 'Test agent',
    });

    // Filter by a specific agent (agent should still be returned)
    const agents = await listInstalledAgents({
      global: false,
      cwd: testDir,
      targetFilter: ['cursor'] as any,
    });
    expect(agents).toHaveLength(1);
    expect(agents[0]!.name).toBe('test-agent');
  });

  // Issue #225 part 1: Only installed agents should be attributed
  it('should only attribute agents to installed agents (issue #225)', async () => {
    // Mock: only Amp is installed (not Kimi, even though they share .agents/agents)
    vi.spyOn(agentsModule, 'detectInstalledTargets').mockResolvedValue(['amp']);

    await createSkillDir(testDir, 'test-agent', {
      name: 'test-agent',
      description: 'Test agent',
    });

    const agents = await listInstalledAgents({ global: false, cwd: testDir });

    expect(agents).toHaveLength(1);
    // Should only show amp, not kimi-cli
    expect(agents[0]!.agents).toContain('amp');
    expect(agents[0]!.agents).not.toContain('kimi-cli');

    vi.restoreAllMocks();
  });

  // Issue #225 part 2: Agents in agent-specific directories should be found
  it('should find agents in agent-specific directories (issue #225)', async () => {
    vi.spyOn(agentsModule, 'detectInstalledTargets').mockResolvedValue(['cursor']);

    // Cursor now uses .agents/agents (universal directory)
    const cursorSkillDir = join(testDir, '.agents', 'agents', 'cursor-agent');
    await mkdir(cursorSkillDir, { recursive: true });
    await writeFile(
      join(cursorSkillDir, 'AGENT.md'),
      `---
name: cursor-agent
description: A agent in cursor directory
---

# cursor-agent
`
    );

    const agents = await listInstalledAgents({ global: false, cwd: testDir });

    expect(agents).toHaveLength(1);
    expect(agents[0]!.name).toBe('cursor-agent');
    expect(agents[0]!.agents).toContain('cursor');

    vi.restoreAllMocks();
  });
});
