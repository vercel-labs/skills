import { describe, expect, it } from 'vitest';
import {
  getCanonicalSkillPathFromTree,
  getSkillFolderHashFromTree,
  type RepoTree,
} from './blob.ts';

describe('repo tree skill paths', () => {
  const tree: RepoTree = {
    sha: 'root-tree',
    branch: 'HEAD',
    tree: [
      { path: 'Skills', type: 'tree', sha: 'skills-tree' },
      { path: 'Skills/ghostty-config', type: 'tree', sha: 'ghostty-tree' },
      { path: 'Skills/ghostty-config/SKILL.md', type: 'blob', sha: 'ghostty-skill-md' },
    ],
  };

  it('returns folder hashes for paths with mismatched casing', () => {
    expect(getSkillFolderHashFromTree(tree, 'skills/ghostty-config/SKILL.md')).toBe('ghostty-tree');
  });

  it('returns canonical repo casing for lockfile skill paths', () => {
    expect(getCanonicalSkillPathFromTree(tree, 'skills/ghostty-config/SKILL.md')).toBe(
      'Skills/ghostty-config/SKILL.md'
    );
  });

  it('does not guess when path casing is ambiguous', () => {
    const ambiguousTree: RepoTree = {
      sha: 'root-tree',
      branch: 'HEAD',
      tree: [
        { path: 'Skills', type: 'tree', sha: 'uppercase-skills-tree' },
        { path: 'Skills/ghostty-config', type: 'tree', sha: 'uppercase-ghostty-tree' },
        { path: 'Skills/ghostty-config/SKILL.md', type: 'blob', sha: 'uppercase-ghostty-md' },
        { path: 'skills', type: 'tree', sha: 'lowercase-skills-tree' },
        { path: 'skills/ghostty-config', type: 'tree', sha: 'lowercase-ghostty-tree' },
        { path: 'skills/ghostty-config/SKILL.md', type: 'blob', sha: 'lowercase-ghostty-md' },
      ],
    };

    expect(getSkillFolderHashFromTree(ambiguousTree, 'SKILLS/ghostty-config/SKILL.md')).toBeNull();
    expect(
      getCanonicalSkillPathFromTree(ambiguousTree, 'SKILLS/ghostty-config/SKILL.md')
    ).toBeNull();
  });

  it('still prefers exact matches when path casing is otherwise ambiguous', () => {
    const ambiguousTree: RepoTree = {
      sha: 'root-tree',
      branch: 'HEAD',
      tree: [
        { path: 'Skills', type: 'tree', sha: 'uppercase-skills-tree' },
        { path: 'Skills/ghostty-config', type: 'tree', sha: 'uppercase-ghostty-tree' },
        { path: 'Skills/ghostty-config/SKILL.md', type: 'blob', sha: 'uppercase-ghostty-md' },
        { path: 'skills', type: 'tree', sha: 'lowercase-skills-tree' },
        { path: 'skills/ghostty-config', type: 'tree', sha: 'lowercase-ghostty-tree' },
        { path: 'skills/ghostty-config/SKILL.md', type: 'blob', sha: 'lowercase-ghostty-md' },
      ],
    };

    expect(getSkillFolderHashFromTree(ambiguousTree, 'Skills/ghostty-config/SKILL.md')).toBe(
      'uppercase-ghostty-tree'
    );
    expect(getCanonicalSkillPathFromTree(ambiguousTree, 'Skills/ghostty-config/SKILL.md')).toBe(
      'Skills/ghostty-config/SKILL.md'
    );
  });

  it('keeps root-level skill paths stable', () => {
    expect(getCanonicalSkillPathFromTree(tree, 'SKILL.md')).toBe('SKILL.md');
    expect(getSkillFolderHashFromTree(tree, 'SKILL.md')).toBe('root-tree');
  });
});
