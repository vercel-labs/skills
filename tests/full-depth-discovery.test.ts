/**
 * Tests for the --full-depth option in agent discovery.
 *
 * When a repository has both a root AGENT.md and nested agents in subdirectories,
 * the --full-depth flag allows discovering all agents instead of just the root one.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { discoverAgents } from '../src/agents.ts';

describe('discoverAgents with fullDepth option', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `agents-full-depth-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('should only return root agent when fullDepth is false', async () => {
    // Create root AGENT.md
    writeFileSync(
      join(testDir, 'AGENT.md'),
      `---
name: root-agent
description: Root level agent
---

# Root Agent
`
    );

    // Create nested agent in agents/ directory
    mkdirSync(join(testDir, 'agents', 'nested-agent'), { recursive: true });
    writeFileSync(
      join(testDir, 'agents', 'nested-agent', 'AGENT.md'),
      `---
name: nested-agent
description: Nested agent
---

# Nested Agent
`
    );

    const agents = await discoverAgents(testDir, undefined, { fullDepth: false });

    expect(agents).toHaveLength(1);
    expect(agents[0].name).toBe('root-agent');
  });

  it('should return all agents when fullDepth is true', async () => {
    // Create root AGENT.md
    writeFileSync(
      join(testDir, 'AGENT.md'),
      `---
name: root-agent
description: Root level agent
---

# Root Agent
`
    );

    // Create nested agents in agents/ directory
    mkdirSync(join(testDir, 'agents', 'nested-agent-1'), { recursive: true });
    writeFileSync(
      join(testDir, 'agents', 'nested-agent-1', 'AGENT.md'),
      `---
name: nested-agent-1
description: Nested agent 1
---

# Nested Agent 1
`
    );

    mkdirSync(join(testDir, 'agents', 'nested-agent-2'), { recursive: true });
    writeFileSync(
      join(testDir, 'agents', 'nested-agent-2', 'AGENT.md'),
      `---
name: nested-agent-2
description: Nested agent 2
---

# Nested Agent 2
`
    );

    const agents = await discoverAgents(testDir, undefined, { fullDepth: true });

    expect(agents).toHaveLength(3);
    const names = agents.map((s) => s.name).sort();
    expect(names).toEqual(['nested-agent-1', 'nested-agent-2', 'root-agent']);
  });

  it('should default to early return (fullDepth: false behavior) when no option is provided', async () => {
    // Create root AGENT.md
    writeFileSync(
      join(testDir, 'AGENT.md'),
      `---
name: root-agent
description: Root level agent
---

# Root Agent
`
    );

    // Create nested agent
    mkdirSync(join(testDir, 'agents', 'nested-agent'), { recursive: true });
    writeFileSync(
      join(testDir, 'agents', 'nested-agent', 'AGENT.md'),
      `---
name: nested-agent
description: Nested agent
---

# Nested Agent
`
    );

    // No options passed - should default to early return
    const agents = await discoverAgents(testDir);

    expect(agents).toHaveLength(1);
    expect(agents[0].name).toBe('root-agent');
  });

  it('should still find all agents when no root AGENT.md exists (regardless of fullDepth)', async () => {
    // No root AGENT.md, just nested agents

    mkdirSync(join(testDir, 'agents', 'agent-1'), { recursive: true });
    writeFileSync(
      join(testDir, 'agents', 'agent-1', 'AGENT.md'),
      `---
name: agent-1
description: Agent 1
---

# Agent 1
`
    );

    mkdirSync(join(testDir, 'agents', 'agent-2'), { recursive: true });
    writeFileSync(
      join(testDir, 'agents', 'agent-2', 'AGENT.md'),
      `---
name: agent-2
description: Agent 2
---

# Agent 2
`
    );

    // Without fullDepth
    const skillsDefault = await discoverAgents(testDir);
    expect(skillsDefault).toHaveLength(2);

    // With fullDepth
    const skillsFullDepth = await discoverAgents(testDir, undefined, { fullDepth: true });
    expect(skillsFullDepth).toHaveLength(2);
  });

  it('should not duplicate agents when root and nested have the same name', async () => {
    // Edge case: root AGENT.md and a nested agent with the same name
    writeFileSync(
      join(testDir, 'AGENT.md'),
      `---
name: my-agent
description: Root level agent
---

# Root Agent
`
    );

    // Create nested agent with same name
    mkdirSync(join(testDir, 'agents', 'my-agent'), { recursive: true });
    writeFileSync(
      join(testDir, 'agents', 'my-agent', 'AGENT.md'),
      `---
name: my-agent
description: Nested agent with same name
---

# Nested Agent
`
    );

    const agents = await discoverAgents(testDir, undefined, { fullDepth: true });

    // Should only have one agent (deduplication by name)
    expect(agents).toHaveLength(1);
    expect(agents[0].name).toBe('my-agent');
  });
});
