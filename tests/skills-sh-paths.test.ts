/**
 * Tests for the `paths` field of skills.sh.json, which lets a repo declare
 * extra skill container directories outside the hardcoded priority dirs.
 *
 * See: https://github.com/vercel-labs/skills/issues/2582
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { discoverSkills } from '../src/skills.ts';
import {
  findSkillMdPaths,
  resetRepoTreeAuthState,
  tryBlobInstall,
  type RepoTree,
} from '../src/blob.ts';
import { parseSkillsShPaths } from '../src/skills-sh-config.ts';

function skillMd(name: string): string {
  return `---\nname: ${name}\ndescription: ${name} description\n---\n\n# ${name}\n`;
}

function writeSkill(dir: string, name: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), skillMd(name));
}

function writeConfig(dir: string, config: unknown): void {
  writeFileSync(
    join(dir, 'skills.sh.json'),
    typeof config === 'string' ? config : JSON.stringify(config)
  );
}

function makeTree(paths: string[]): RepoTree {
  return {
    sha: 'root-sha',
    branch: 'main',
    tree: paths.map((path) => ({
      path,
      type: path.includes('.') ? 'blob' : 'tree',
      sha: 'sha-' + path,
    })),
  };
}

describe('parseSkillsShPaths', () => {
  it('normalizes valid entries', () => {
    expect(
      parseSkillsShPaths(
        JSON.stringify({ paths: ['./tools/skills', './a/./b/', './tools/skills/'] })
      )
    ).toEqual(['tools/skills', 'a/b']);
  });

  it('rejects entries that do not start with ./, escape the repo, or point at the root', () => {
    expect(
      parseSkillsShPaths(
        JSON.stringify({
          paths: [
            'tools/skills',
            '/etc',
            '../outside',
            './a/../../outside',
            './',
            '.',
            './a\\..\\..',
            42,
          ],
        })
      )
    ).toEqual([]);
  });

  it('returns [] for invalid JSON or a missing/invalid paths field', () => {
    expect(parseSkillsShPaths('{not json')).toEqual([]);
    expect(parseSkillsShPaths(JSON.stringify({ groupings: [] }))).toEqual([]);
    expect(parseSkillsShPaths(JSON.stringify({ paths: './tools/skills' }))).toEqual([]);
    expect(parseSkillsShPaths(JSON.stringify(['./tools/skills']))).toEqual([]);
  });
});

describe('discoverSkills — skills.sh.json paths', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `skills-sh-paths-${Date.now()}-${Math.random()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('discovers skills in declared paths alongside standard locations', async () => {
    writeSkill(join(testDir, 'skills', 'standard'), 'standard');
    writeSkill(join(testDir, 'tools', 'skills', 'opt-in'), 'opt-in');
    writeConfig(testDir, { paths: ['./tools/skills'], groupings: [] });

    const skills = await discoverSkills(testDir);

    expect(skills.map((s) => s.name).sort()).toEqual(['opt-in', 'standard']);
  });

  it('skips skills outside standard locations without the config', async () => {
    writeSkill(join(testDir, 'skills', 'standard'), 'standard');
    writeSkill(join(testDir, 'tools', 'skills', 'opt-in'), 'opt-in');

    const skills = await discoverSkills(testDir);

    expect(skills.map((s) => s.name)).toEqual(['standard']);
  });

  it('walks declared paths with container depth', async () => {
    writeSkill(join(testDir, 'tools', 'skills', 'category', 'nested'), 'nested');
    writeSkill(join(testDir, 'skills', 'standard'), 'standard');
    writeConfig(testDir, { paths: ['./tools/skills'] });

    const skills = await discoverSkills(testDir);

    expect(skills.map((s) => s.name).sort()).toEqual(['nested', 'standard']);
  });

  it('deduplicates skills by name across standard and declared paths', async () => {
    writeSkill(join(testDir, 'skills', 'shared'), 'shared');
    writeSkill(join(testDir, 'tools', 'skills', 'shared'), 'shared');
    writeConfig(testDir, { paths: ['./tools/skills'] });

    const skills = await discoverSkills(testDir);

    expect(skills).toHaveLength(1);
    expect(skills[0]!.path).toBe(join(testDir, 'skills', 'shared'));
  });

  it('does not treat a SKILL.md directly inside a declared container as a skill', async () => {
    writeSkill(join(testDir, 'skills', 'standard'), 'standard');
    writeSkill(join(testDir, 'tools', 'skills'), 'container-root');
    writeConfig(testDir, { paths: ['./tools/skills'] });

    const skills = await discoverSkills(testDir);

    expect(skills.map((s) => s.name)).toEqual(['standard']);
  });

  it('ignores declared paths that escape the repo', async () => {
    const repoDir = join(testDir, 'repo');
    writeSkill(join(repoDir, 'skills', 'standard'), 'standard');
    writeSkill(join(testDir, 'outside', 'escaped'), 'escaped');
    writeConfig(repoDir, { paths: ['./../outside', '../outside'] });

    const skills = await discoverSkills(repoDir);

    expect(skills.map((s) => s.name)).toEqual(['standard']);
  });

  it('keeps default behavior when the config is invalid', async () => {
    writeSkill(join(testDir, 'skills', 'standard'), 'standard');
    writeSkill(join(testDir, 'tools', 'skills', 'opt-in'), 'opt-in');
    writeConfig(testDir, '{ "paths": [');

    const skills = await discoverSkills(testDir);

    expect(skills.map((s) => s.name)).toEqual(['standard']);
  });
});

describe('findSkillMdPaths — extra containers', () => {
  const tree = makeTree([
    'skills/standard/SKILL.md',
    'tools/skills/opt-in/SKILL.md',
    'tools/skills/category/nested/SKILL.md',
  ]);

  it('ignores skills outside priority dirs by default', () => {
    expect(findSkillMdPaths(tree)).toEqual(['skills/standard/SKILL.md']);
  });

  it('only searches children of extra containers, matching discoverSkills', () => {
    const rootSkillTree = makeTree(['skills/standard/SKILL.md', 'tools/skills/SKILL.md']);
    expect(findSkillMdPaths(rootSkillTree, undefined, ['tools/skills'])).toEqual([
      'skills/standard/SKILL.md',
    ]);
  });

  it('keeps built-in prefix behavior when an extra container duplicates it', () => {
    const builtinTree = makeTree(['skills/SKILL.md']);
    expect(findSkillMdPaths(builtinTree, undefined, ['skills'])).toEqual(['skills/SKILL.md']);
  });

  it('includes skills in extra containers with container depth', () => {
    expect(findSkillMdPaths(tree, undefined, ['tools/skills']).sort()).toEqual([
      'skills/standard/SKILL.md',
      'tools/skills/category/nested/SKILL.md',
      'tools/skills/opt-in/SKILL.md',
    ]);
  });
});

describe('tryBlobInstall — skills.sh.json paths', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    resetRepoTreeAuthState();
    originalFetch = globalThis.fetch;
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('reads skills.sh.json from the tree and discovers declared paths', async () => {
    const tree = makeTree([
      'skills.sh.json',
      'skills/standard/SKILL.md',
      'tools/skills/opt-in/SKILL.md',
    ]);

    fetchMock.mockImplementation(async (input: string | URL) => {
      const url = String(input);
      if (url.includes('/git/trees/')) {
        return Response.json({ sha: tree.sha, tree: tree.tree });
      }
      if (url.endsWith('/skills.sh.json')) {
        return new Response(JSON.stringify({ paths: ['./tools/skills'] }));
      }
      if (url.endsWith('/skills/standard/SKILL.md')) return new Response(skillMd('standard'));
      if (url.endsWith('/tools/skills/opt-in/SKILL.md')) return new Response(skillMd('opt-in'));
      const slug = url.split('/').at(-1)!;
      return Response.json({
        hash: `hash-${slug}`,
        files: [{ path: 'SKILL.md', contents: skillMd(slug) }],
      });
    });

    const result = await tryBlobInstall('sveltejs/ai-tools');

    expect(result).not.toBeNull();
    expect(result!.skills.map((s) => s.repoPath).sort()).toEqual([
      'skills/standard/SKILL.md',
      'tools/skills/opt-in/SKILL.md',
    ]);
  });

  it('does not fetch skills.sh.json when the tree does not contain it', async () => {
    const tree = makeTree(['skills/standard/SKILL.md']);

    fetchMock.mockImplementation(async (input: string | URL) => {
      const url = String(input);
      if (url.includes('/git/trees/')) {
        return Response.json({ sha: tree.sha, tree: tree.tree });
      }
      if (url.endsWith('/SKILL.md')) return new Response(skillMd('standard'));
      return Response.json({
        hash: 'hash',
        files: [{ path: 'SKILL.md', contents: skillMd('standard') }],
      });
    });

    await tryBlobInstall('vercel-labs/agent-skills');

    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('skills.sh.json'))).toBe(
      false
    );
  });
});
