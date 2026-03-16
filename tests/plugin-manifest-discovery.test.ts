/**
 * Tests for discovering agents declared in plugin manifests.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { discoverAgents } from '../src/agents.ts';

describe('discoverAgents with plugin manifests', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `agents-manifest-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('should discover agents from marketplace.json', async () => {
    // Create marketplace.json
    mkdirSync(join(testDir, '.claude-plugin'), { recursive: true });
    writeFileSync(
      join(testDir, '.claude-plugin/marketplace.json'),
      JSON.stringify({
        name: 'test-marketplace',
        owner: { name: 'Test' },
        plugins: [
          {
            name: 'test-plugin',
            source: './plugins/test-plugin',
            agents: ['./agents/test-agent'],
          },
        ],
      })
    );

    // Create the agent
    mkdirSync(join(testDir, 'plugins/test-plugin/agents/test-agent'), { recursive: true });
    writeFileSync(
      join(testDir, 'plugins/test-plugin/agents/test-agent/AGENT.md'),
      `---
name: manifest-agent
description: Agent discovered via manifest
---
# Test
`
    );

    const agents = await discoverAgents(testDir);
    expect(agents).toHaveLength(1);
    expect(agents[0].name).toBe('manifest-agent');
  });

  it('should respect metadata.pluginRoot', async () => {
    mkdirSync(join(testDir, '.claude-plugin'), { recursive: true });
    writeFileSync(
      join(testDir, '.claude-plugin/marketplace.json'),
      JSON.stringify({
        metadata: { pluginRoot: './plugins' },
        plugins: [
          {
            name: 'my-plugin',
            source: 'my-plugin', // Relative to pluginRoot
            agents: ['./agents/my-agent'],
          },
        ],
      })
    );

    mkdirSync(join(testDir, 'plugins/my-plugin/agents/my-agent'), { recursive: true });
    writeFileSync(
      join(testDir, 'plugins/my-plugin/agents/my-agent/AGENT.md'),
      `---
name: pluginroot-agent
description: Test
---
`
    );

    const agents = await discoverAgents(testDir);
    expect(agents).toHaveLength(1);
    expect(agents[0].name).toBe('pluginroot-agent');
  });

  it('should discover agents from plugin.json', async () => {
    mkdirSync(join(testDir, '.claude-plugin'), { recursive: true });
    writeFileSync(
      join(testDir, '.claude-plugin/plugin.json'),
      JSON.stringify({
        name: 'single-plugin',
        agents: ['./agents/single-agent'],
      })
    );

    mkdirSync(join(testDir, 'agents/single-agent'), { recursive: true });
    writeFileSync(
      join(testDir, 'agents/single-agent/AGENT.md'),
      `---
name: single-plugin-agent
description: Test
---
`
    );

    const agents = await discoverAgents(testDir);
    expect(agents).toHaveLength(1);
    expect(agents[0].name).toBe('single-plugin-agent');
  });

  it('should skip remote source objects', async () => {
    mkdirSync(join(testDir, '.claude-plugin'), { recursive: true });
    writeFileSync(
      join(testDir, '.claude-plugin/marketplace.json'),
      JSON.stringify({
        plugins: [
          {
            name: 'remote-plugin',
            source: { source: 'github', repo: 'owner/repo' },
            agents: ['./agents/remote-agent'],
          },
        ],
      })
    );

    const agents = await discoverAgents(testDir);
    expect(agents).toHaveLength(0);
  });

  it('should handle missing manifest gracefully', async () => {
    // No .claude-plugin directory
    const agents = await discoverAgents(testDir);
    expect(agents).toHaveLength(0);
  });

  it('should handle invalid JSON gracefully', async () => {
    mkdirSync(join(testDir, '.claude-plugin'), { recursive: true });
    writeFileSync(join(testDir, '.claude-plugin/marketplace.json'), 'not valid json');

    const agents = await discoverAgents(testDir);
    expect(agents).toHaveLength(0);
  });

  it('should deduplicate agents found via manifest and priority dirs', async () => {
    // Agent in both manifest path AND standard agents/ directory
    mkdirSync(join(testDir, '.claude-plugin'), { recursive: true });
    writeFileSync(
      join(testDir, '.claude-plugin/plugin.json'),
      JSON.stringify({ agents: ['./agents/dupe-agent'] })
    );

    mkdirSync(join(testDir, 'agents/dupe-agent'), { recursive: true });
    writeFileSync(
      join(testDir, 'agents/dupe-agent/AGENT.md'),
      `---
name: dupe-agent
description: Test
---
`
    );

    const agents = await discoverAgents(testDir);
    expect(agents).toHaveLength(1);
  });

  it('should discover multiple agents from multiple plugins', async () => {
    mkdirSync(join(testDir, '.claude-plugin'), { recursive: true });
    writeFileSync(
      join(testDir, '.claude-plugin/marketplace.json'),
      JSON.stringify({
        plugins: [
          {
            name: 'plugin-a',
            source: './plugin-a',
            agents: ['./agents/agent-1', './agents/agent-2'],
          },
          {
            name: 'plugin-b',
            source: './plugin-b',
            agents: ['./agents/agent-3'],
          },
        ],
      })
    );

    // Create agents for plugin-a
    mkdirSync(join(testDir, 'plugin-a/agents/agent-1'), { recursive: true });
    writeFileSync(
      join(testDir, 'plugin-a/agents/agent-1/AGENT.md'),
      `---
name: agent-1
description: Test
---
`
    );
    mkdirSync(join(testDir, 'plugin-a/agents/agent-2'), { recursive: true });
    writeFileSync(
      join(testDir, 'plugin-a/agents/agent-2/AGENT.md'),
      `---
name: agent-2
description: Test
---
`
    );

    // Create agent for plugin-b
    mkdirSync(join(testDir, 'plugin-b/agents/agent-3'), { recursive: true });
    writeFileSync(
      join(testDir, 'plugin-b/agents/agent-3/AGENT.md'),
      `---
name: agent-3
description: Test
---
`
    );

    const agents = await discoverAgents(testDir);
    expect(agents).toHaveLength(3);
    const names = agents.map((s) => s.name).sort();
    expect(names).toEqual(['agent-1', 'agent-2', 'agent-3']);
  });

  it('should handle plugin without source (root-level plugin)', async () => {
    mkdirSync(join(testDir, '.claude-plugin'), { recursive: true });
    writeFileSync(
      join(testDir, '.claude-plugin/marketplace.json'),
      JSON.stringify({
        plugins: [
          {
            name: 'root-plugin',
            // No source - plugin is at root
            agents: ['./agents/root-agent'],
          },
        ],
      })
    );

    mkdirSync(join(testDir, 'agents/root-agent'), { recursive: true });
    writeFileSync(
      join(testDir, 'agents/root-agent/AGENT.md'),
      `---
name: root-agent
description: Test
---
`
    );

    const agents = await discoverAgents(testDir);
    expect(agents).toHaveLength(1);
    expect(agents[0].name).toBe('root-agent');
  });

  it('should discover agents from adjacent agents/ when plugin.json has no agents array', async () => {
    // plugin.json exists but doesn't declare agents
    mkdirSync(join(testDir, '.claude-plugin'), { recursive: true });
    writeFileSync(
      join(testDir, '.claude-plugin/plugin.json'),
      JSON.stringify({
        name: 'plugin-without-agents-field',
        description: 'A plugin that does not declare agents explicitly',
      })
    );

    // Agents exist in conventional location
    mkdirSync(join(testDir, 'agents/undeclared-agent'), { recursive: true });
    writeFileSync(
      join(testDir, 'agents/undeclared-agent/AGENT.md'),
      `---
name: undeclared-agent
description: Discovered from conventional agents/ directory
---
`
    );

    const agents = await discoverAgents(testDir);
    expect(agents).toHaveLength(1);
    expect(agents[0].name).toBe('undeclared-agent');
  });

  it('should discover agents from adjacent agents/ when plugin.json has empty agents array', async () => {
    mkdirSync(join(testDir, '.claude-plugin'), { recursive: true });
    writeFileSync(
      join(testDir, '.claude-plugin/plugin.json'),
      JSON.stringify({
        name: 'plugin-with-empty-agents',
        agents: [], // Empty array
      })
    );

    mkdirSync(join(testDir, 'agents/empty-array-agent'), { recursive: true });
    writeFileSync(
      join(testDir, 'agents/empty-array-agent/AGENT.md'),
      `---
name: empty-array-agent
description: Test
---
`
    );

    const agents = await discoverAgents(testDir);
    expect(agents).toHaveLength(1);
    expect(agents[0].name).toBe('empty-array-agent');
  });

  it('should discover agents from marketplace plugin without agents array', async () => {
    mkdirSync(join(testDir, '.claude-plugin'), { recursive: true });
    writeFileSync(
      join(testDir, '.claude-plugin/marketplace.json'),
      JSON.stringify({
        plugins: [
          {
            name: 'plugin-no-agents-field',
            source: './my-plugin',
            // No agents field - should discover from my-plugin/agents/
          },
        ],
      })
    );

    mkdirSync(join(testDir, 'my-plugin/agents/auto-discovered'), { recursive: true });
    writeFileSync(
      join(testDir, 'my-plugin/agents/auto-discovered/AGENT.md'),
      `---
name: auto-discovered
description: Found via conventional agents/ in plugin
---
`
    );

    const agents = await discoverAgents(testDir);
    expect(agents).toHaveLength(1);
    expect(agents[0].name).toBe('auto-discovered');
  });

  it('should discover both explicit and conventional agents from same plugin', async () => {
    mkdirSync(join(testDir, '.claude-plugin'), { recursive: true });
    writeFileSync(
      join(testDir, '.claude-plugin/marketplace.json'),
      JSON.stringify({
        plugins: [
          {
            name: 'mixed-plugin',
            source: './mixed',
            agents: ['./custom-agents/explicit-agent'], // Explicit path
          },
        ],
      })
    );

    // Explicit agent in custom location
    mkdirSync(join(testDir, 'mixed/custom-agents/explicit-agent'), { recursive: true });
    writeFileSync(
      join(testDir, 'mixed/custom-agents/explicit-agent/AGENT.md'),
      `---
name: explicit-agent
description: Explicitly declared
---
`
    );

    // Conventional agent in agents/
    mkdirSync(join(testDir, 'mixed/agents/conventional-agent'), { recursive: true });
    writeFileSync(
      join(testDir, 'mixed/agents/conventional-agent/AGENT.md'),
      `---
name: conventional-agent
description: Found via convention
---
`
    );

    const agents = await discoverAgents(testDir);
    expect(agents).toHaveLength(2);
    const names = agents.map((s) => s.name).sort();
    expect(names).toEqual(['conventional-agent', 'explicit-agent']);
  });

  it('should reject paths that traverse outside basePath', async () => {
    // Create marketplace.json with malicious traversal paths
    mkdirSync(join(testDir, '.claude-plugin'), { recursive: true });
    writeFileSync(
      join(testDir, '.claude-plugin/marketplace.json'),
      JSON.stringify({
        plugins: [
          { source: '../../../etc', agents: ['./passwd'] }, // Traversal via source
          { source: 'legit', agents: ['../../../outside/agent'] }, // Traversal via agent path
        ],
      })
    );

    // Create a legit plugin with a valid agent to ensure discovery still works
    mkdirSync(join(testDir, 'legit/agents/valid-agent'), { recursive: true });
    writeFileSync(
      join(testDir, 'legit/agents/valid-agent/AGENT.md'),
      `---
name: valid-agent
description: A valid agent inside basePath
---
`
    );

    // Create a agent outside testDir that should NOT be discovered
    const outsideDir = join(testDir, '..', `outside-${Date.now()}`);
    mkdirSync(join(outsideDir, 'agent'), { recursive: true });
    writeFileSync(
      join(outsideDir, 'agent/AGENT.md'),
      `---
name: outside-agent
description: Should not be discovered
---
`
    );

    try {
      const agents = await discoverAgents(testDir);
      // Should only find the valid agent, not the traversal attempts
      expect(agents).toHaveLength(1);
      expect(agents[0].name).toBe('valid-agent');
    } finally {
      // Clean up outside directory
      rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  it('should reject absolute paths in manifests', async () => {
    mkdirSync(join(testDir, '.claude-plugin'), { recursive: true });
    writeFileSync(
      join(testDir, '.claude-plugin/plugin.json'),
      JSON.stringify({
        agents: ['/etc/passwd', '/tmp/malicious-agent'],
      })
    );

    // Create a valid agent via convention
    mkdirSync(join(testDir, 'agents/safe-agent'), { recursive: true });
    writeFileSync(
      join(testDir, 'agents/safe-agent/AGENT.md'),
      `---
name: safe-agent
description: Safe agent in conventional location
---
`
    );

    const agents = await discoverAgents(testDir);
    // Should only find the conventional agent
    expect(agents).toHaveLength(1);
    expect(agents[0].name).toBe('safe-agent');
  });

  it('should reject paths without ./ prefix (per Claude Code convention)', async () => {
    mkdirSync(join(testDir, '.claude-plugin'), { recursive: true });

    // Paths without './' prefix should be rejected
    // Use a non-standard directory that WON'T be found by fallback search
    writeFileSync(
      join(testDir, '.claude-plugin/marketplace.json'),
      JSON.stringify({
        metadata: { pluginRoot: 'custom-plugins' }, // Missing './' prefix - INVALID
        plugins: [{ source: './my-plugin', agents: ['./custom-agents/my-agent'] }],
      })
    );

    // Create the plugin in a non-standard location only reachable via manifest
    mkdirSync(join(testDir, 'custom-plugins/my-plugin/custom-agents/my-agent'), {
      recursive: true,
    });
    writeFileSync(
      join(testDir, 'custom-plugins/my-plugin/custom-agents/my-agent/AGENT.md'),
      `---
name: unreachable-agent
description: Should not be found - pluginRoot lacks ./
---
`
    );

    // Also create a agent in standard location to prevent fallback deep search
    mkdirSync(join(testDir, 'agents/standard-agent'), { recursive: true });
    writeFileSync(
      join(testDir, 'agents/standard-agent/AGENT.md'),
      `---
name: standard-agent
description: Found via standard location
---
`
    );

    const agents = await discoverAgents(testDir);
    // Only the standard agent should be found, not the one behind invalid pluginRoot
    expect(agents).toHaveLength(1);
    expect(agents[0].name).toBe('standard-agent');
  });

  it('should reject plugin sources without ./ prefix', async () => {
    mkdirSync(join(testDir, '.claude-plugin'), { recursive: true });

    writeFileSync(
      join(testDir, '.claude-plugin/marketplace.json'),
      JSON.stringify({
        plugins: [
          { source: 'bare-plugin', agents: ['./agents/skill1'] }, // Invalid - no './'
          { source: './valid-plugin', agents: ['./agents/skill2'] }, // Valid
        ],
      })
    );

    // Create both plugins
    mkdirSync(join(testDir, 'bare-plugin/agents/skill1'), { recursive: true });
    writeFileSync(
      join(testDir, 'bare-plugin/agents/skill1/AGENT.md'),
      `---
name: bare-agent
description: Should not be found
---
`
    );

    mkdirSync(join(testDir, 'valid-plugin/agents/skill2'), { recursive: true });
    writeFileSync(
      join(testDir, 'valid-plugin/agents/skill2/AGENT.md'),
      `---
name: valid-agent
description: Should be found
---
`
    );

    const agents = await discoverAgents(testDir);
    expect(agents).toHaveLength(1);
    expect(agents[0].name).toBe('valid-agent');
  });

  it('should reject agent paths without ./ prefix', async () => {
    mkdirSync(join(testDir, '.claude-plugin'), { recursive: true });

    // Use SEPARATE non-standard directories to isolate the test
    // (parent dir scanning would find siblings if in same parent)
    writeFileSync(
      join(testDir, '.claude-plugin/plugin.json'),
      JSON.stringify({
        agents: ['invalid-loc/bare-agent', './valid-loc/valid-agent'], // First lacks ./
      })
    );

    // Agent with invalid path (no ./) - in its own directory tree
    mkdirSync(join(testDir, 'invalid-loc/bare-agent'), { recursive: true });
    writeFileSync(
      join(testDir, 'invalid-loc/bare-agent/AGENT.md'),
      `---
name: bare-agent
description: Should not be found - path lacks ./
---
`
    );

    // Agent with valid path - in separate directory tree
    mkdirSync(join(testDir, 'valid-loc/valid-agent'), { recursive: true });
    writeFileSync(
      join(testDir, 'valid-loc/valid-agent/AGENT.md'),
      `---
name: valid-agent
description: Should be found - path has ./
---
`
    );

    // Add a agent in standard location to prevent fallback search
    mkdirSync(join(testDir, 'agents/standard'), { recursive: true });
    writeFileSync(
      join(testDir, 'agents/standard/AGENT.md'),
      `---
name: standard-agent
description: Standard location
---
`
    );

    const agents = await discoverAgents(testDir);
    const names = agents.map((s) => s.name).sort();
    // Should find: valid-agent (via valid manifest path) and standard-agent (via convention)
    // Should NOT find: bare-agent (manifest path lacks ./)
    expect(names).toEqual(['standard-agent', 'valid-agent']);
  });
});
