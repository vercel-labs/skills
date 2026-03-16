/**
 * Unit tests for filterAgents function in agents.ts
 *
 * These tests verify the agent matching logic. Multi-word agent names
 * must be quoted on the command line (e.g., --agent "Convex Best Practices").
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { filterAgents, parseAgentMd } from '../src/agents.ts';
import type { Agent } from '../src/types.ts';

// Mock agent factory
function makeSkill(name: string, path: string = '/tmp/agent'): Agent {
  return { name, description: 'desc', path };
}

const agents: Agent[] = [
  makeSkill('convex-best-practices'),
  makeSkill('Convex Best Practices'),
  makeSkill('simple-agent'),
  makeSkill('foo'),
  makeSkill('bar'),
];

describe('filterAgents', () => {
  describe('direct matching', () => {
    it('matches exact name', () => {
      const result = filterAgents(agents, ['foo']);
      expect(result.length).toBe(1);
      expect(result[0].name).toBe('foo');
    });

    it('matches case insensitive', () => {
      const result = filterAgents(agents, ['FOO']);
      expect(result.length).toBe(1);
      expect(result[0].name).toBe('foo');
    });

    it('matches kebab-case agent name', () => {
      const result = filterAgents(agents, ['convex-best-practices']);
      expect(result.length).toBe(1);
      expect(result[0].name).toBe('convex-best-practices');
    });

    it('matches multiple agents', () => {
      const result = filterAgents(agents, ['foo', 'bar']);
      expect(result.length).toBe(2);
      const names = result.map((s) => s.name).sort();
      expect(names).toEqual(['bar', 'foo']);
    });
  });

  describe('quoted multi-word names', () => {
    it('matches quoted multi-word name', () => {
      // Simulates: --agent "Convex Best Practices"
      const result = filterAgents(agents, ['Convex Best Practices']);
      expect(result.length).toBe(1);
      expect(result[0].name).toBe('Convex Best Practices');
    });

    it('matches quoted multi-word name case insensitive', () => {
      const result = filterAgents(agents, ['convex best practices']);
      expect(result.length).toBe(1);
      expect(result[0].name).toBe('Convex Best Practices');
    });
  });

  describe('unquoted multi-word names (should not match)', () => {
    it('does not match unquoted multi-word args', () => {
      // Simulates: --agent Convex Best Practices (unquoted - shell splits into 3 args)
      // This should NOT match - users must quote multi-word names
      const result = filterAgents(agents, ['Convex', 'Best', 'Practices']);
      expect(result.length).toBe(0);
    });

    it('does not match partial words', () => {
      const result = filterAgents(agents, ['Convex', 'Best']);
      expect(result.length).toBe(0);
    });
  });

  describe('no matches', () => {
    it('returns empty array when no matches', () => {
      const result = filterAgents(agents, ['nonexistent']);
      expect(result.length).toBe(0);
    });

    it('returns empty array for empty input', () => {
      const result = filterAgents(agents, []);
      expect(result.length).toBe(0);
    });
  });
});

describe('parseAgentMd with non-string frontmatter values', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `agents-nonstring-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('rejects agent with numeric name', async () => {
    const agentPath = join(testDir, 'AGENT.md');
    writeFileSync(
      agentPath,
      `---
name: 123
description: A agent with numeric name
---

# Numeric Name Agent
`
    );
    const result = await parseAgentMd(agentPath);
    expect(result).toBeNull();
  });

  it('rejects agent with boolean name', async () => {
    const agentPath = join(testDir, 'AGENT.md');
    writeFileSync(
      agentPath,
      `---
name: true
description: A agent with boolean name
---

# Boolean Name Agent
`
    );
    const result = await parseAgentMd(agentPath);
    expect(result).toBeNull();
  });

  it('rejects agent with array name', async () => {
    const agentPath = join(testDir, 'AGENT.md');
    writeFileSync(
      agentPath,
      `---
name:
  - foo
  - bar
description: A agent with array name
---

# Array Name Agent
`
    );
    const result = await parseAgentMd(agentPath);
    expect(result).toBeNull();
  });

  it('rejects agent with numeric description', async () => {
    const agentPath = join(testDir, 'AGENT.md');
    writeFileSync(
      agentPath,
      `---
name: valid-name
description: 456
---

# Numeric Description Agent
`
    );
    const result = await parseAgentMd(agentPath);
    expect(result).toBeNull();
  });

  it('accepts agent with valid string name and description', async () => {
    const agentPath = join(testDir, 'AGENT.md');
    writeFileSync(
      agentPath,
      `---
name: valid-agent
description: A valid agent
---

# Valid Agent
`
    );
    const result = await parseAgentMd(agentPath);
    expect(result).not.toBeNull();
    expect(result!.name).toBe('valid-agent');
  });
});
