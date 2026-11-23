import { describe, it, expect } from 'vitest';
import { findSkillMdPaths, type RepoTree } from '../src/blob.ts';

function makeTree(paths: string[]): RepoTree {
  return {
    sha: 'root-sha',
    branch: 'main',
    tree: paths.map((path) => ({ path, type: 'blob', sha: `sha-${path}` })),
  };
}

describe('findSkillMdPaths — exact entrypoint filename', () => {
  it.each(['NOT-SKILL.md', 'docs/my-skill.md', 'skills/demo/old-SKILL.md'])(
    'does not discover %s as a skill through the recursive fallback',
    (path) => {
      expect(findSkillMdPaths(makeTree([path]))).toEqual([]);
    }
  );

  it('keeps genuine case-insensitive entrypoints without including lookalikes', () => {
    const tree = makeTree([
      'SKILL.md',
      'NOT-SKILL.md',
      'skills/demo/skill.md',
      'docs/example/SkIlL.mD',
      'docs/example/old-SKILL.md',
    ]);

    expect(findSkillMdPaths(tree)).toEqual(['SKILL.md', 'skills/demo/skill.md']);
  });

  it('filters lookalikes inside an explicitly requested subtree', () => {
    const tree = makeTree(['docs/demo/old-SKILL.md', 'docs/demo/nested/SKILL.md']);

    expect(findSkillMdPaths(tree, 'docs/demo')).toEqual(['docs/demo/nested/SKILL.md']);
  });
});
