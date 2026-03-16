import { join, resolve } from 'path';
import { getPluginGroupings } from '../src/plugin-manifest.ts';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdir, writeFile, rm } from 'fs/promises';

const TEST_DIR = join(process.cwd(), 'test-plugin-grouping');

describe('getPluginGroupings', () => {
  beforeAll(async () => {
    await mkdir(TEST_DIR, { recursive: true });
    await mkdir(join(TEST_DIR, '.claude-plugin'), { recursive: true });

    const manifest = {
      plugins: [
        {
          name: 'document-agents',
          source: './',
          agents: ['./agents/xlsx', './agents/docx'],
        },
        {
          name: 'example-agents',
          source: './',
          agents: ['./agents/art'],
        },
      ],
    };

    await writeFile(join(TEST_DIR, '.claude-plugin/marketplace.json'), JSON.stringify(manifest));
  });

  afterAll(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  it('should map agent paths to plugin names', async () => {
    const groupings = await getPluginGroupings(TEST_DIR);

    const xlsxPath = resolve(TEST_DIR, 'agents/xlsx');
    const docxPath = resolve(TEST_DIR, 'agents/docx');
    const artPath = resolve(TEST_DIR, 'agents/art');

    expect(groupings.get(xlsxPath)).toBe('document-agents');
    expect(groupings.get(docxPath)).toBe('document-agents');
    expect(groupings.get(artPath)).toBe('example-agents');
  });

  it('should handle nested plugin sources', async () => {
    // Create nested structure
    const nestedDir = join(TEST_DIR, 'nested');
    await mkdir(nestedDir, { recursive: true });
    await mkdir(join(nestedDir, '.claude-plugin'), { recursive: true });

    const manifest = {
      plugins: [
        {
          name: 'nested-plugin',
          source: './plugins/my-plugin',
          agents: ['./agents/deep'],
        },
      ],
    };

    await writeFile(join(nestedDir, '.claude-plugin/marketplace.json'), JSON.stringify(manifest));

    const groupings = await getPluginGroupings(nestedDir);
    // source: ./plugins/my-plugin, agent: ./agents/deep
    // path = nestedDir/plugins/my-plugin/agents/deep
    const expectedPath = resolve(nestedDir, 'plugins/my-plugin/agents/deep');

    expect(groupings.get(expectedPath)).toBe('nested-plugin');
  });
});
