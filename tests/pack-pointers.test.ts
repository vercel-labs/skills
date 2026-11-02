import { createHash } from 'crypto';
import { mkdir, mkdtemp, symlink, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { computeSkillsShContentHash } from '../src/skills-sh-hash.ts';
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

const HASH = 'a'.repeat(64);

describe('getPackSkillPointer', () => {
  it('reads the original repo for public pack skills', () => {
    expect(
      getPackSkillPointer(packSkill({ repo: 'benjitaylor/skills', skill: 'stageshow', hash: HASH }))
    ).toEqual({ repo: 'benjitaylor/skills', skill: 'stageshow', hash: HASH });
  });

  it('treats entries without a pointer as copies', () => {
    expect(getPackSkillPointer(packSkill())).toBeNull();
    expect(getPackSkillPointer(packSkill('benjitaylor/skills'))).toBeNull();
    expect(getPackSkillPointer(packSkill({ repo: 'benjitaylor/skills' }))).toBeNull();
    // Unpinned pointers (older packs) are installed from the pack's copy.
    expect(
      getPackSkillPointer(packSkill({ repo: 'benjitaylor/skills', skill: 'stageshow' }))
    ).toBeNull();
    expect(
      getPackSkillPointer(
        packSkill({ repo: 'benjitaylor/skills', skill: 'stageshow', hash: 'abc' })
      )
    ).toBeNull();
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
      expect(getPackSkillPointer(packSkill({ ...source, hash: HASH }))).toBeNull();
    }
  });
});

describe('computeSkillsShContentHash', () => {
  it('matches the skills.sh snapshot hash: text files only, no symlinks or excluded dirs', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'skills-sh-hash-'));
    await writeFile(join(dir, 'SKILL.md'), '---\nname: demo\n---\n');
    await mkdir(join(dir, 'kit'));
    await writeFile(join(dir, 'kit', 'a.tsx'), 'export const a = 1;');
    await writeFile(join(dir, 'logo.png'), Buffer.from([0x89, 0x50]));
    await mkdir(join(dir, 'node_modules'));
    await writeFile(join(dir, 'node_modules', 'x.js'), 'ignored');
    await symlink(join(dir, 'kit', 'a.tsx'), join(dir, 'link.tsx'));

    // skills.sh: sort by path with localeCompare ("kit/…" before "SKILL.md"),
    // hash "path\0contents\0" for each file.
    const expected = createHash('sha256')
      .update('kit/a.tsx\0export const a = 1;\0SKILL.md\0---\nname: demo\n---\n\0')
      .digest('hex');
    expect(await computeSkillsShContentHash(dir)).toBe(expected);
  });
});
