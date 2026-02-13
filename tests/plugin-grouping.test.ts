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
          name: 'document-skills',
          source: './',
          skills: ['./skills/xlsx', './skills/docx'],
        },
        {
          name: 'example-skills',
          source: './',
          skills: ['./skills/art'],
        },
      ],
    };

    await writeFile(join(TEST_DIR, '.claude-plugin/marketplace.json'), JSON.stringify(manifest));
  });

  afterAll(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  it('should map skill paths to plugin names', async () => {
    const groupings = await getPluginGroupings(TEST_DIR);

    const xlsxPath = resolve(TEST_DIR, 'skills/xlsx');
    const docxPath = resolve(TEST_DIR, 'skills/docx');
    const artPath = resolve(TEST_DIR, 'skills/art');

    expect(groupings.get(xlsxPath)).toBe('document-skills');
    expect(groupings.get(docxPath)).toBe('document-skills');
    expect(groupings.get(artPath)).toBe('example-skills');
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
          skills: ['./skills/deep'],
        },
      ],
    };

    await writeFile(join(nestedDir, '.claude-plugin/marketplace.json'), JSON.stringify(manifest));

    const groupings = await getPluginGroupings(nestedDir);
    // source: ./plugins/my-plugin, skill: ./skills/deep
    // path = nestedDir/plugins/my-plugin/skills/deep
    const expectedPath = resolve(nestedDir, 'plugins/my-plugin/skills/deep');

    expect(groupings.get(expectedPath)).toBe('nested-plugin');
  });
});
