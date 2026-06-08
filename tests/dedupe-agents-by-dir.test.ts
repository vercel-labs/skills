import { describe, expect, it } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { dedupeAgentsByDir } from '../src/installer.ts';
import { getUniversalAgents } from '../src/agents.ts';

describe('dedupeAgentsByDir', () => {
  it('collapses universal agents that share the canonical skills dir into one', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'dedupe-'));
    const universal = getUniversalAgents();
    // Sanity: the regression only matters when several agents share one directory
    expect(universal.length).toBeGreaterThan(1);

    const result = dedupeAgentsByDir(universal, { global: false, cwd });

    expect(result).toHaveLength(1);
    expect(result[0]).toBe(universal[0]);
  });

  it('keeps agents that resolve to distinct directories', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'dedupe-'));
    const universal = getUniversalAgents();

    const result = dedupeAgentsByDir([universal[0]!, universal[1]!, 'claude-code'], {
      global: false,
      cwd,
    });

    // The two universal agents collapse to one; claude-code has its own dir and stays.
    expect(result).toHaveLength(2);
    expect(result).toContain(universal[0]);
    expect(result).toContain('claude-code');
    expect(result).not.toContain(universal[1]);
  });

  it('preserves input order, keeping the first occurrence of each directory', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'dedupe-'));
    const universal = getUniversalAgents();

    const result = dedupeAgentsByDir(['claude-code', universal[0]!, universal[1]!], {
      global: false,
      cwd,
    });

    expect(result).toEqual(['claude-code', universal[0]]);
  });
});
