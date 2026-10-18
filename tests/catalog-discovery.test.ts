/**
 * Tests for catalog layouts (`skills/<category>/[<category>/]<skill>/SKILL.md`).
 *
 * Every skill in a catalog should be discovered regardless of what its
 * categories are called or what else sits in the container, including when
 * the `skills` directory itself is the path passed to `skills add`.
 *
 * See: https://github.com/vercel-labs/skills/issues/2528
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
    type: 'blob',
    sha: 'sha-' + path.replace(/[^a-z0-9]/gi, '_'),
  }));
  return { sha: 'root-sha', branch: 'main', tree: entries };
}

describe('discoverSkills — catalog layouts', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `skills-catalog-${Date.now()}-${Math.random()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('discovers skills under categories named build or dist', async () => {
    writeSkill(join(testDir, 'skills', 'build', 'check'), 'check');
    writeSkill(join(testDir, 'skills', 'dist', 'release'), 'release');
    writeSkill(join(testDir, 'skills', 'design', 'review'), 'review');
    writeSkill(join(testDir, 'skills', 'node_modules', 'pkg', 'pkg-skill'), 'pkg-skill');

    const skills = await discoverSkills(testDir);

    expect(skills.map((s) => s.name).sort()).toEqual(['check', 'release', 'review']);
  });

  it('walks a skills directory passed as the search path like any other container', async () => {
    const container = join(testDir, 'skills');
    writeSkill(join(container, 'build', 'check'), 'check');
    writeSkill(join(container, 'frontend', 'react', 'hooks'), 'react-hooks');
    writeSkill(join(container, 'level-1', 'level-2', 'level-3', 'deep'), 'too-deep');

    const expected = ['check', 'react-hooks'];
    expect((await discoverSkills(container)).map((s) => s.name).sort()).toEqual(expected);
    expect((await discoverSkills(testDir, 'skills')).map((s) => s.name).sort()).toEqual(expected);
  });

  it('keeps repo-root behavior for a skills directory with its own skills/ subdir', async () => {
    // e.g. a local checkout of a repo named `skills`
    const checkout = join(testDir, 'skills');
    writeSkill(join(checkout, 'skills', 'real'), 'real');
    writeSkill(join(checkout, 'examples', 'demo'), 'demo');

    const skills = await discoverSkills(checkout);

    expect(skills.map((s) => s.name)).toEqual(['real']);
  });

  it('does not let a direct child skill hide nested ones in a skills directory', async () => {
    const container = join(testDir, 'skills');
    writeSkill(join(container, 'aaa-probe'), 'aaa-probe');
    writeSkill(join(container, 'foundation', 'scope'), 'scope');
    writeSkill(join(container, 'production', 'deploy', 'deploy-app'), 'deploy-app');

    const skills = await discoverSkills(container);

    expect(skills.map((s) => s.name).sort()).toEqual(['aaa-probe', 'deploy-app', 'scope']);
  });
});

describe('findSkillMdPaths — catalog layouts', () => {
  it('returns skills under categories named build or dist', () => {
    const tree = makeTree([
      'skills/build/check/SKILL.md',
      'skills/dist/release/SKILL.md',
      'skills/design/review/SKILL.md',
      'skills/node_modules/pkg/pkg-skill/SKILL.md',
    ]);

    expect(findSkillMdPaths(tree).sort()).toEqual([
      'skills/build/check/SKILL.md',
      'skills/design/review/SKILL.md',
      'skills/dist/release/SKILL.md',
    ]);
  });

  it('walks a skills subpath like any other container', () => {
    const tree = makeTree([
      'skills/aaa-probe/SKILL.md',
      'skills/build/check/SKILL.md',
      'skills/frontend/react/hooks/SKILL.md',
      'skills/level-1/level-2/level-3/deep/SKILL.md',
      'other/category/out-of-scope/SKILL.md',
    ]);

    expect(findSkillMdPaths(tree, 'skills').sort()).toEqual([
      'skills/aaa-probe/SKILL.md',
      'skills/build/check/SKILL.md',
      'skills/frontend/react/hooks/SKILL.md',
    ]);
  });

  it('keeps root-prefix behavior for a skills subpath with its own skills/ subdir', () => {
    const tree = makeTree(['skills/skills/real/SKILL.md', 'skills/examples/demo/SKILL.md']);

    expect(findSkillMdPaths(tree, 'skills')).toEqual(['skills/skills/real/SKILL.md']);
  });
});
