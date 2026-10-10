import { describe, it, expect } from 'vitest';
import { parseSkillsField } from '../src/skills-field.ts';

describe('parseSkillsField', () => {
  it('parses npm: strings and objects', () => {
    expect(
      parseSkillsField(
        ['npm:@vueuse/skills', { source: 'npm:my-lib', skills: ['a', 'b'] }],
        'my-pack'
      )
    ).toEqual({
      npm: [
        { package: '@vueuse/skills', skills: [] },
        { package: 'my-lib', skills: ['a', 'b'] },
      ],
      remote: [],
      errors: [],
    });
  });

  it('parses git sources, folding @skill and ref into the request', () => {
    const { remote, errors } = parseSkillsField(
      [
        'owner/repo@one',
        { source: 'owner/repo', ref: 'v1', skills: ['two'] },
        'https://gitlab.com/group/repo/-/tree/main/skills',
      ],
      '.'
    );
    expect(errors).toEqual([]);
    expect(remote).toEqual([
      {
        parsed: expect.objectContaining({
          type: 'github',
          url: 'https://github.com/owner/repo.git',
        }),
        skills: ['one'],
      },
      { parsed: expect.objectContaining({ type: 'github', ref: 'v1' }), skills: ['two'] },
      {
        parsed: expect.objectContaining({ type: 'gitlab', ref: 'main', subpath: 'skills' }),
        skills: [],
      },
    ]);
  });

  it('rejects sources that are not git-hosted', () => {
    expect(parseSkillsField(['./local', 'https://example.com/skills'], 'my-pack').errors).toEqual([
      'my-pack: "./local" is not a git source',
      'my-pack: "https://example.com/skills" is not a git source',
    ]);
  });

  it('rejects a ref on a source that already has one', () => {
    expect(
      parseSkillsField(
        [
          { source: 'owner/repo#v1', ref: 'v2' },
          { source: 'https://github.com/o/r/tree/main/x', ref: 'v2' },
        ],
        '.'
      ).errors
    ).toEqual([
      '.: "owner/repo#v1" already has a ref; remove "ref"',
      '.: "https://github.com/o/r/tree/main/x" already has a ref; remove "ref"',
    ]);
  });

  it('rejects ref on an npm: entry', () => {
    expect(parseSkillsField([{ source: 'npm:x', ref: 'v1' }], 'my-pack').errors).toEqual([
      'my-pack: "ref" cannot be used with "npm:x"',
    ]);
  });

  it('rejects malformed entries and keeps the valid ones', () => {
    const parsed = parseSkillsField(
      [42, { skills: ['a'] }, { source: 'npm:x', skills: 'a' }, 'npm:ok'],
      '.'
    );
    expect(parsed.errors).toEqual([
      '.: invalid "skills" entry 42',
      '.: invalid "skills" entry {"skills":["a"]}',
      '.: invalid "skills" entry {"source":"npm:x","skills":"a"}',
    ]);
    expect(parsed.npm).toEqual([{ package: 'ok', skills: [] }]);
  });
});
