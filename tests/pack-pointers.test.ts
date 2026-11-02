import { describe, expect, it } from 'vitest';
import { getPackSkillPointer } from '../src/add.ts';
import type { WellKnownSkill } from '../src/providers/index.ts';

function packSkill(source?: unknown): WellKnownSkill {
  return {
    name: 'stageshow',
    description: 'Faux product UI',
    content: '',
    installName: 'stageshow',
    sourceUrl: 'https://skills.sh/p/abc/.well-known/skills/stageshow/SKILL.md',
    providerId: 'well-known',
    sourceIdentifier: 'skills.sh',
    files: new Map([['SKILL.md', '---\nname: stageshow\n---\n']]),
    indexEntry: {
      name: 'stageshow',
      description: 'Faux product UI',
      files: ['SKILL.md'],
      ...(source === undefined ? {} : { source }),
    } as WellKnownSkill['indexEntry'],
  };
}

describe('getPackSkillPointer', () => {
  it('reads the original repo for public pack skills', () => {
    expect(
      getPackSkillPointer(packSkill({ repo: 'benjitaylor/skills', skill: 'stageshow' }))
    ).toEqual({ repo: 'benjitaylor/skills', skill: 'stageshow' });
  });

  it('treats entries without a pointer as copies', () => {
    expect(getPackSkillPointer(packSkill())).toBeNull();
    expect(getPackSkillPointer(packSkill('benjitaylor/skills'))).toBeNull();
    expect(getPackSkillPointer(packSkill({ repo: 'benjitaylor/skills' }))).toBeNull();
  });

  it('rejects pointers that are not plain owner/repo and skill ids', () => {
    for (const source of [
      { repo: 'https://evil.example/repo', skill: 'x' },
      { repo: '../etc/passwd', skill: 'x' },
      { repo: 'owner/repo/extra', skill: 'x' },
      { repo: 'owner/..', skill: 'x' },
      { repo: 'owner/repo', skill: '../x' },
      { repo: 'owner/repo', skill: 'a/b' },
      { repo: '-flag/repo', skill: 'x' },
    ]) {
      expect(getPackSkillPointer(packSkill(source))).toBeNull();
    }
  });
});
