import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { discoverSubagentDefinitions } from './subagents.ts';

describe('discoverSubagentDefinitions', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `skills-subagents-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('returns an empty array when there is no agents/ directory', async () => {
    const definitions = await discoverSubagentDefinitions(testDir);
    expect(definitions).toEqual([]);
  });

  it('discovers flat .md files with name/description frontmatter', async () => {
    const agentsDir = join(testDir, 'agents');
    mkdirSync(agentsDir, { recursive: true });
    writeFileSync(
      join(agentsDir, 'architect.md'),
      '---\nname: architect\ndescription: Plans the implementation\n---\n\nBody.\n'
    );
    writeFileSync(
      join(agentsDir, 'reviewer.md'),
      '---\nname: reviewer\ndescription: Reviews code changes\n---\n\nBody.\n'
    );

    const definitions = await discoverSubagentDefinitions(testDir);
    const names = definitions.map((d) => d.name).sort();
    expect(names).toEqual(['architect', 'reviewer']);
  });

  it('skips files missing required frontmatter fields', async () => {
    const agentsDir = join(testDir, 'agents');
    mkdirSync(agentsDir, { recursive: true });
    writeFileSync(join(agentsDir, 'broken.md'), '---\nname: broken\n---\n\nNo description.\n');

    const definitions = await discoverSubagentDefinitions(testDir);
    expect(definitions).toEqual([]);
  });

  it('ignores non-markdown files and nested directories', async () => {
    const agentsDir = join(testDir, 'agents');
    mkdirSync(join(agentsDir, 'nested'), { recursive: true });
    writeFileSync(join(agentsDir, 'notes.txt'), 'not a subagent');
    writeFileSync(
      join(agentsDir, 'nested', 'ignored.md'),
      '---\nname: ignored\ndescription: Should not be found\n---\n\nBody.\n'
    );

    const definitions = await discoverSubagentDefinitions(testDir);
    expect(definitions).toEqual([]);
  });

  it('respects a subpath argument', async () => {
    const agentsDir = join(testDir, 'sub', 'agents');
    mkdirSync(agentsDir, { recursive: true });
    writeFileSync(
      join(agentsDir, 'architect.md'),
      '---\nname: architect\ndescription: Plans the implementation\n---\n\nBody.\n'
    );

    const definitions = await discoverSubagentDefinitions(testDir, 'sub');
    expect(definitions.map((d) => d.name)).toEqual(['architect']);
  });
});
