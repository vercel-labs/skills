import { describe, expect, it } from 'vitest';
import {
  createSkillFileSelector,
  parseSkillFileIncludes,
  selectSkillFileMap,
  selectSkillSnapshotFiles,
} from '../src/skill-files.ts';

describe('skill file includes', () => {
  it('treats missing files frontmatter as non-explicit', () => {
    expect(parseSkillFileIncludes({ name: 'x' })).toBeUndefined();
    expect(parseSkillFileIncludes({ files: 'scripts/' })).toBeUndefined();
    expect(createSkillFileSelector(undefined).explicit).toBe(false);
  });

  it('normalizes safe files entries and drops unsafe entries', () => {
    expect(
      parseSkillFileIncludes({
        files: [
          './SKILL.md',
          'scripts/',
          '!scripts/dev-only.sh',
          '../outside',
          '/absolute',
          'C:\\absolute',
          123,
        ],
      })
    ).toEqual(['SKILL.md', 'scripts/', '!scripts/dev-only.sh']);
  });

  it('always includes root SKILL.md even when explicit includes omit or exclude it', () => {
    const selector = createSkillFileSelector(['scripts/', '!SKILL.md']);

    expect(selector.explicit).toBe(true);
    expect(selector.shouldInclude('SKILL.md')).toBe(true);
    expect(selector.shouldInclude('scripts/build.js')).toBe(true);
    expect(selector.shouldInclude('README.md')).toBe(false);
  });

  it('supports exact files, directories, negation, and basic globs', () => {
    const selector = createSkillFileSelector([
      'scripts/',
      'templates/*.md',
      'references/**/*.md',
      '!scripts/dev-only.js',
    ]);

    expect(selector.shouldInclude('scripts/run.js')).toBe(true);
    expect(selector.shouldInclude('scripts/dev-only.js')).toBe(false);
    expect(selector.shouldInclude('templates/card.md')).toBe(true);
    expect(selector.shouldInclude('templates/card.txt')).toBe(false);
    expect(selector.shouldInclude('references/topic.md')).toBe(true);
    expect(selector.shouldInclude('references/deep/topic.md')).toBe(true);
    expect(selector.shouldInclude('references/deep/topic.txt')).toBe(false);
  });

  it('filters snapshot arrays and file maps with the same selector semantics', () => {
    const includes = ['scripts/', 'config.example.json', '!scripts/dev-only.js'];
    const snapshot = selectSkillSnapshotFiles(
      [
        { path: 'SKILL.md', contents: '# Skill' },
        { path: 'scripts/run.js', contents: 'run' },
        { path: 'scripts/dev-only.js', contents: 'dev' },
        { path: 'config.example.json', contents: '{}' },
        { path: 'README.md', contents: 'readme' },
      ],
      includes
    );

    expect(snapshot.map((file) => file.path)).toEqual([
      'SKILL.md',
      'scripts/run.js',
      'config.example.json',
    ]);

    const map = selectSkillFileMap(
      new Map([
        ['SKILL.md', '# Skill'],
        ['scripts/run.js', 'run'],
        ['README.md', 'readme'],
      ]),
      includes
    );

    expect([...map.keys()]).toEqual(['SKILL.md', 'scripts/run.js']);
  });
});
