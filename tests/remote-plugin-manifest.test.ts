/**
 * Tests for parsing remote plugin sources from .claude-plugin/marketplace.json.
 *
 * Remote sources (github / url / git-subdir) are parsed into RemotePluginEntry
 * objects for lazy resolution. npm sources are reported as unsupported.
 * Local string sources keep their existing disk-based discovery behavior.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { parsePluginManifests, getPluginSkillPaths } from '../src/plugin-manifest.ts';
import { discoverSkills } from '../src/skills.ts';

const VALID_SHA = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0';

function writeMarketplace(testDir: string, manifest: unknown): void {
  mkdirSync(join(testDir, '.claude-plugin'), { recursive: true });
  writeFileSync(join(testDir, '.claude-plugin/marketplace.json'), JSON.stringify(manifest));
}

describe('parsePluginManifests with remote sources', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `remote-plugin-manifest-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('should parse a github source entry', async () => {
    writeMarketplace(testDir, {
      plugins: [
        {
          name: 'github-plugin',
          description: 'A plugin from GitHub',
          source: { source: 'github', repo: 'owner/repo' },
        },
      ],
    });

    const result = await parsePluginManifests(testDir);
    expect(result.remotePlugins).toHaveLength(1);
    expect(result.remotePlugins[0]).toEqual({
      name: 'github-plugin',
      description: 'A plugin from GitHub',
      source: { source: 'github', repo: 'owner/repo', ref: undefined, sha: undefined },
      skills: undefined,
    });
  });

  it('should parse a url source entry with https and ssh urls', async () => {
    writeMarketplace(testDir, {
      plugins: [
        {
          name: 'https-plugin',
          source: { source: 'url', url: 'https://gitlab.com/team/plugin.git' },
        },
        {
          name: 'ssh-plugin',
          source: { source: 'url', url: 'git@gitlab.example.com:team/plugin.git' },
        },
      ],
    });

    const result = await parsePluginManifests(testDir);
    expect(result.remotePlugins).toHaveLength(2);
    expect(result.remotePlugins[0].source).toMatchObject({
      source: 'url',
      url: 'https://gitlab.com/team/plugin.git',
    });
    expect(result.remotePlugins[1].source).toMatchObject({
      source: 'url',
      url: 'git@gitlab.example.com:team/plugin.git',
    });
  });

  it('should parse a git-subdir source entry', async () => {
    writeMarketplace(testDir, {
      plugins: [
        {
          name: 'monorepo-plugin',
          source: {
            source: 'git-subdir',
            url: 'git@gitlab.example.com:org/monorepo.git',
            path: 'libs/shared/design-system/skills',
          },
        },
      ],
    });

    const result = await parsePluginManifests(testDir);
    expect(result.remotePlugins).toHaveLength(1);
    expect(result.remotePlugins[0].source).toMatchObject({
      source: 'git-subdir',
      url: 'git@gitlab.example.com:org/monorepo.git',
      path: 'libs/shared/design-system/skills',
    });
  });

  it('should preserve ref and sha pins', async () => {
    writeMarketplace(testDir, {
      plugins: [
        {
          name: 'pinned-plugin',
          source: { source: 'github', repo: 'owner/repo', ref: 'v2.0.0', sha: VALID_SHA },
        },
      ],
    });

    const result = await parsePluginManifests(testDir);
    expect(result.remotePlugins).toHaveLength(1);
    expect(result.remotePlugins[0].source).toMatchObject({ ref: 'v2.0.0', sha: VALID_SHA });
  });

  it('should parse skill paths on remote entries and filter invalid ones', async () => {
    writeMarketplace(testDir, {
      plugins: [
        {
          name: 'multi-skill-plugin',
          source: { source: 'github', repo: 'owner/repo' },
          skills: ['./skills/one', './skills/two', 'no-prefix', '/absolute'],
        },
      ],
    });

    const result = await parsePluginManifests(testDir);
    expect(result.remotePlugins).toHaveLength(1);
    expect(result.remotePlugins[0].skills).toEqual(['./skills/one', './skills/two']);
  });

  it('should report npm sources as unsupported', async () => {
    writeMarketplace(testDir, {
      plugins: [
        {
          name: 'npm-plugin',
          source: { source: 'npm', package: '@org/plugin' },
        },
      ],
    });

    const result = await parsePluginManifests(testDir);
    expect(result.remotePlugins).toHaveLength(0);
    expect(result.unsupportedPlugins).toEqual(['npm-plugin']);
  });

  it('should skip remote plugins without a name', async () => {
    writeMarketplace(testDir, {
      plugins: [{ source: { source: 'github', repo: 'owner/repo' } }],
    });

    const result = await parsePluginManifests(testDir);
    expect(result.remotePlugins).toHaveLength(0);
    expect(result.unsupportedPlugins).toHaveLength(0);
  });

  it('should skip github sources with invalid repo format', async () => {
    writeMarketplace(testDir, {
      plugins: [
        { name: 'bad-repo', source: { source: 'github', repo: 'not-owner-slash-repo' } },
        { name: 'missing-repo', source: { source: 'github' } },
      ],
    });

    const result = await parsePluginManifests(testDir);
    expect(result.remotePlugins).toHaveLength(0);
  });

  it('should skip git-subdir sources without path or url', async () => {
    writeMarketplace(testDir, {
      plugins: [
        { name: 'no-path', source: { source: 'git-subdir', url: 'https://example.com/repo.git' } },
        { name: 'no-url', source: { source: 'git-subdir', path: 'tools/plugin' } },
      ],
    });

    const result = await parsePluginManifests(testDir);
    expect(result.remotePlugins).toHaveLength(0);
  });

  it('should skip git-subdir sources with traversal or absolute paths', async () => {
    writeMarketplace(testDir, {
      plugins: [
        {
          name: 'traversal',
          source: {
            source: 'git-subdir',
            url: 'https://example.com/repo.git',
            path: '../outside',
          },
        },
        {
          name: 'absolute',
          source: { source: 'git-subdir', url: 'https://example.com/repo.git', path: '/etc' },
        },
      ],
    });

    const result = await parsePluginManifests(testDir);
    expect(result.remotePlugins).toHaveLength(0);
  });

  it('should skip url sources without a url', async () => {
    writeMarketplace(testDir, {
      plugins: [{ name: 'no-url', source: { source: 'url' } }],
    });

    const result = await parsePluginManifests(testDir);
    expect(result.remotePlugins).toHaveLength(0);
  });

  it('should skip entries with an invalid sha pin', async () => {
    writeMarketplace(testDir, {
      plugins: [
        {
          name: 'short-sha',
          source: { source: 'github', repo: 'owner/repo', sha: 'abc123' },
        },
        {
          name: 'non-hex-sha',
          source: { source: 'github', repo: 'owner/repo', sha: 'z'.repeat(40) },
        },
      ],
    });

    const result = await parsePluginManifests(testDir);
    expect(result.remotePlugins).toHaveLength(0);
  });

  it('should skip entries with unknown source types', async () => {
    writeMarketplace(testDir, {
      plugins: [{ name: 'unknown-type', source: { source: 'svn', url: 'svn://example.com/repo' } }],
    });

    const result = await parsePluginManifests(testDir);
    expect(result.remotePlugins).toHaveLength(0);
    expect(result.unsupportedPlugins).toHaveLength(0);
  });

  it('should collect local and remote plugins from a mixed manifest', async () => {
    writeMarketplace(testDir, {
      plugins: [
        {
          name: 'local-plugin',
          source: './local-plugin',
          skills: ['./skills/local-skill'],
        },
        {
          name: 'remote-plugin',
          source: { source: 'github', repo: 'owner/repo' },
        },
      ],
    });

    const result = await parsePluginManifests(testDir);

    // Remote plugin collected for lazy resolution
    expect(result.remotePlugins).toHaveLength(1);
    expect(result.remotePlugins[0].name).toBe('remote-plugin');

    // Local plugin keeps existing disk-based search dirs
    expect(result.localSearchDirs).toContain(join(testDir, 'local-plugin/skills'));
  });

  it('should return an empty result when no manifest exists', async () => {
    const result = await parsePluginManifests(testDir);
    expect(result.localSearchDirs).toHaveLength(0);
    expect(result.remotePlugins).toHaveLength(0);
    expect(result.unsupportedPlugins).toHaveLength(0);
  });

  it('should return an empty result for invalid JSON', async () => {
    mkdirSync(join(testDir, '.claude-plugin'), { recursive: true });
    writeFileSync(join(testDir, '.claude-plugin/marketplace.json'), 'not valid json');

    const result = await parsePluginManifests(testDir);
    expect(result.localSearchDirs).toHaveLength(0);
    expect(result.remotePlugins).toHaveLength(0);
  });
});

describe('backward compatibility with local-only behavior', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `remote-plugin-compat-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('getPluginSkillPaths should return only local search dirs', async () => {
    writeMarketplace(testDir, {
      plugins: [
        { name: 'local-plugin', source: './local-plugin', skills: ['./skills/my-skill'] },
        { name: 'remote-plugin', source: { source: 'github', repo: 'owner/repo' } },
      ],
    });

    const dirs = await getPluginSkillPaths(testDir);
    // Explicit skill paths add their parent dir (existing contract);
    // the conventional skills/ dir is always added
    expect(dirs).toContain(join(testDir, 'local-plugin/skills'));
    // Remote plugins never produce local search dirs
    expect(dirs.every((d) => d.startsWith(testDir))).toBe(true);
  });

  it('discoverSkills should not surface unresolved remote plugins as skills', async () => {
    writeMarketplace(testDir, {
      plugins: [
        {
          name: 'remote-plugin',
          source: { source: 'github', repo: 'owner/repo' },
          skills: ['./skills/remote-skill'],
        },
      ],
    });

    // Lazy resolution: discovery only finds skills present on disk
    const skills = await discoverSkills(testDir);
    expect(skills).toHaveLength(0);
  });

  it('local skills next to remote plugins are still discovered', async () => {
    writeMarketplace(testDir, {
      plugins: [
        { name: 'local-plugin', source: './local-plugin' },
        { name: 'remote-plugin', source: { source: 'github', repo: 'owner/repo' } },
      ],
    });

    mkdirSync(join(testDir, 'local-plugin/skills/local-skill'), { recursive: true });
    writeFileSync(
      join(testDir, 'local-plugin/skills/local-skill/SKILL.md'),
      `---
name: local-skill
description: A local skill in a mixed marketplace
---
`
    );

    const skills = await discoverSkills(testDir);
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe('local-skill');
  });

  it('keeps the first entry and reports duplicate remote plugin names', async () => {
    writeMarketplace(testDir, {
      plugins: [
        { name: 'dup', source: { source: 'github', repo: 'owner/first' } },
        { name: 'dup', source: { source: 'github', repo: 'owner/second' } },
      ],
    });

    const result = await parsePluginManifests(testDir);

    // Only the first entry survives
    expect(result.remotePlugins).toHaveLength(1);
    expect(result.remotePlugins[0].source).toMatchObject({ source: 'github', repo: 'owner/first' });
    // The collision is reported for the caller to warn about
    expect(result.duplicatePluginNames).toEqual(['dup']);
  });

  it('reports duplicate names across local and remote plugin entries', async () => {
    writeMarketplace(testDir, {
      plugins: [
        { name: 'shared', source: './local-shared' },
        { name: 'shared', source: { source: 'github', repo: 'owner/repo' } },
      ],
    });

    const result = await parsePluginManifests(testDir);

    // The local entry (first) wins; the remote duplicate is dropped and recorded
    expect(result.remotePlugins).toHaveLength(0);
    expect(result.duplicatePluginNames).toEqual(['shared']);
  });

  it('reports no duplicates for a well-formed marketplace', async () => {
    writeMarketplace(testDir, {
      plugins: [
        { name: 'a', source: { source: 'github', repo: 'owner/a' } },
        { name: 'b', source: { source: 'github', repo: 'owner/b' } },
      ],
    });

    const result = await parsePluginManifests(testDir);
    expect(result.duplicatePluginNames).toEqual([]);
  });
});
