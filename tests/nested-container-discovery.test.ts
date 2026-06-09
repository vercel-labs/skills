/**
 * Tests for bounded depth-2 discovery inside skill container directories.
 *
 * Layouts like `skills/<category>/<skill>/SKILL.md` are common when a repo
 * groups skills by product or category. They should be discovered by
 * `discoverSkills()` and `findSkillMdPaths()` without users having to pass
 * `--full-depth`, while keeping the flat-layout, manifest, and
 * `examples/` / `tests/` behaviors intact.
 *
 * See: https://github.com/vercel-labs/skills/issues/747
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { discoverSkills } from '../src/skills.ts';
import { findSkillMdPaths, type RepoTree, type TreeEntry } from '../src/blob.ts';

function writeSkill(dir: string, name: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${name} description\n---\n\n# ${name}\n`
  );
}

function makeTree(paths: string[]): RepoTree {
  const entries: TreeEntry[] = paths.map((path) => ({
    path,
    type: path.toLowerCase().endsWith('skill.md') ? 'blob' : 'tree',
    sha: 'sha-' + path.replace(/[^a-z0-9]/gi, '_'),
  }));
  return { sha: 'root-sha', branch: 'main', tree: entries };
}

describe('discoverSkills — bounded depth-2 inside skill container dirs', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `skills-nested-disk-${Date.now()}-${Math.random()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('discovers nested skills under skills/<category>/<skill>/SKILL.md', async () => {
    writeSkill(join(testDir, 'skills', 'product-a', 'skill-one'), 'skill-one');
    writeSkill(join(testDir, 'skills', 'product-a', 'skill-two'), 'skill-two');
    writeSkill(join(testDir, 'skills', 'product-b', 'skill-three'), 'skill-three');

    const skills = await discoverSkills(testDir);

    expect(skills.map((s) => s.name).sort()).toEqual(['skill-one', 'skill-three', 'skill-two']);
  });

  it('discovers mixed flat and nested skills in the same container', async () => {
    writeSkill(join(testDir, 'skills', 'flat-skill'), 'flat-skill');
    writeSkill(join(testDir, 'skills', 'category', 'nested-skill'), 'nested-skill');

    const skills = await discoverSkills(testDir);

    expect(skills.map((s) => s.name).sort()).toEqual(['flat-skill', 'nested-skill']);
  });

  it('does not descend past a SKILL.md found at depth 1', async () => {
    writeSkill(join(testDir, 'skills', 'foo'), 'outer-skill');
    writeSkill(join(testDir, 'skills', 'foo', 'inner'), 'inner-skill');

    const skills = await discoverSkills(testDir);

    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe('outer-skill');
  });

  it('skips ignored directory names during depth-2 descent', async () => {
    writeSkill(join(testDir, 'skills', 'node_modules', 'inner', 'pkg-skill'), 'pkg-skill');
    writeSkill(join(testDir, 'skills', 'real-category', 'real-skill'), 'real-skill');

    const skills = await discoverSkills(testDir);

    expect(skills.map((s) => s.name).sort()).toEqual(['real-skill']);
  });

  it('discovers nested skills under agent-specific container dirs', async () => {
    writeSkill(join(testDir, '.agents', 'skills', 'category', 'agent-skill'), 'agent-skill');

    const skills = await discoverSkills(testDir);

    expect(skills.map((s) => s.name)).toEqual(['agent-skill']);
  });

  it('ignores project-installed agent skills tracked by skills-lock.json', async () => {
    writeSkill(join(testDir, '.agents', 'skills', 'installed-skill'), 'installed-skill');
    writeSkill(join(testDir, 'skills', 'source-skill'), 'source-skill');
    writeFileSync(
      join(testDir, 'skills-lock.json'),
      JSON.stringify({
        version: 1,
        skills: {
          'installed-skill': {
            source: 'owner/repo',
            sourceType: 'github',
            skillPath: 'skills/installed-skill/SKILL.md',
            computedHash: 'hash',
          },
        },
      })
    );

    const skills = await discoverSkills(testDir);

    expect(skills.map((s) => s.name)).toEqual(['source-skill']);
  });

  it('does not ignore agent-dir skills without a skills-lock.json entry', async () => {
    writeSkill(join(testDir, '.agents', 'skills', 'agent-skill'), 'agent-skill');

    const skills = await discoverSkills(testDir);

    expect(skills.map((s) => s.name)).toEqual(['agent-skill']);
  });

  it('does not perform depth-2 descent from the repo root', async () => {
    // `examples/<x>/<skill>/SKILL.md` must stay invisible without --full-depth.
    writeSkill(join(testDir, 'examples', 'category', 'example-skill'), 'example-skill');
    writeSkill(join(testDir, 'skills', 'real-skill'), 'real-skill');

    const skills = await discoverSkills(testDir);

    expect(skills.map((s) => s.name)).toEqual(['real-skill']);
  });

  it('still requires --full-depth for skills deeper than two levels in a container', async () => {
    writeSkill(join(testDir, 'skills', 'level-1', 'level-2', 'deep-skill'), 'deep-skill');
    writeSkill(join(testDir, 'skills', 'shallow'), 'shallow-skill');

    const defaultSkills = await discoverSkills(testDir);
    expect(defaultSkills.map((s) => s.name).sort()).toEqual(['shallow-skill']);

    const fullSkills = await discoverSkills(testDir, undefined, { fullDepth: true });
    expect(fullSkills.map((s) => s.name).sort()).toEqual(['deep-skill', 'shallow-skill']);
  });

  it('still short-circuits when a root SKILL.md exists (no fullDepth)', async () => {
    writeSkill(testDir, 'root-skill');
    writeSkill(join(testDir, 'skills', 'category', 'nested'), 'nested-skill');

    const skills = await discoverSkills(testDir);

    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe('root-skill');
  });
});

describe('findSkillMdPaths — bounded depth-2 inside skill container prefixes', () => {
  it('returns nested SKILL.md paths under skills/<category>/<skill>/', () => {
    const tree = makeTree([
      'skills/product-a/skill-one/SKILL.md',
      'skills/product-a/skill-two/SKILL.md',
      'skills/product-b/skill-three/SKILL.md',
    ]);

    expect(findSkillMdPaths(tree).sort()).toEqual([
      'skills/product-a/skill-one/SKILL.md',
      'skills/product-a/skill-two/SKILL.md',
      'skills/product-b/skill-three/SKILL.md',
    ]);
  });

  it('returns mixed flat and nested paths from the same container', () => {
    const tree = makeTree(['skills/flat-skill/SKILL.md', 'skills/category/nested-skill/SKILL.md']);

    expect(findSkillMdPaths(tree).sort()).toEqual([
      'skills/category/nested-skill/SKILL.md',
      'skills/flat-skill/SKILL.md',
    ]);
  });

  it('does not descend past a SKILL.md found at depth 1', () => {
    const tree = makeTree(['skills/foo/SKILL.md', 'skills/foo/inner/SKILL.md']);

    expect(findSkillMdPaths(tree)).toEqual(['skills/foo/SKILL.md']);
  });

  it('is case-insensitive about the parent SKILL.md when checking for shadowing', () => {
    const tree = makeTree(['skills/foo/skill.md', 'skills/foo/inner/SKILL.md']);

    expect(findSkillMdPaths(tree)).toEqual(['skills/foo/skill.md']);
  });

  it('skips depth-2 entries whose intermediate dir is an ignored directory', () => {
    const tree = makeTree([
      'skills/node_modules/pkg-skill/SKILL.md',
      'skills/real-category/real-skill/SKILL.md',
    ]);

    expect(findSkillMdPaths(tree)).toEqual(['skills/real-category/real-skill/SKILL.md']);
  });

  it('does not surface depth-2 entries under the root prefix', () => {
    const tree = makeTree([
      'examples/category/example-skill/SKILL.md',
      'skills/real-skill/SKILL.md',
    ]);

    expect(findSkillMdPaths(tree)).toEqual(['skills/real-skill/SKILL.md']);
  });

  it('respects the subpath filter while applying depth-2 discovery', () => {
    const tree = makeTree([
      'skills/category/in-scope/SKILL.md',
      'other/category/out-of-scope/SKILL.md',
    ]);

    expect(findSkillMdPaths(tree, 'skills')).toEqual(['skills/category/in-scope/SKILL.md']);
  });
});
