import { mkdir, mkdtemp, symlink, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { collectSkillsShFiles, computeSkillsShTreeHash } from '../src/skills-sh-hash.ts';
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
      getPackSkillPointer(
        packSkill({ repo: 'benjitaylor/skills', skill: 'stageshow', treeHash: HASH })
      )
    ).toEqual({ repo: 'benjitaylor/skills', skill: 'stageshow', treeHash: HASH });
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
        packSkill({ repo: 'benjitaylor/skills', skill: 'stageshow', treeHash: 'abc' })
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
      expect(getPackSkillPointer(packSkill({ ...source, treeHash: HASH }))).toBeNull();
    }
  });
});

describe('skills.sh tree hash', () => {
  it('reads text files only, skipping symlinks and excluded dirs', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'skills-sh-hash-'));
    await writeFile(join(dir, 'SKILL.md'), '---\nname: demo\n---\n');
    await mkdir(join(dir, 'kit'));
    await writeFile(join(dir, 'kit', 'a.tsx'), 'export const a = 1;');
    await writeFile(join(dir, 'logo.png'), Buffer.from([0x89, 0x50]));
    await mkdir(join(dir, 'node_modules'));
    await writeFile(join(dir, 'node_modules', 'x.js'), 'ignored');
    await symlink(join(dir, 'kit', 'a.tsx'), join(dir, 'link.tsx'));
    const files = await collectSkillsShFiles(dir);
    expect(files.map((f) => f.path).sort()).toEqual(['SKILL.md', 'kit/a.tsx']);
  });

  it('matches the leaderboard implementation (lib/pack-tree-hash.ts)', () => {
    // Vector produced by the leaderboard's computeTreeHash for the same files.
    expect(
      computeSkillsShTreeHash([
        { path: 'SKILL.md', contents: '---\nname: demo\n---\n' },
        { path: 'kit/a.tsx', contents: 'export const a = 1;' },
        { path: 'é.md', contents: 'ünï\0code' },
      ])
    ).toBe('bdba12bbdf840b14d7670ebaa0585309bf922a4b0a070f220038cffbd90569cc');
  });

  it('distinguishes trees that a NUL-joined hash cannot', () => {
    expect(computeSkillsShTreeHash([{ path: 'a.md', contents: 'x\0b.md\0y' }])).not.toBe(
      computeSkillsShTreeHash([
        { path: 'a.md', contents: 'x' },
        { path: 'b.md', contents: 'y' },
      ])
    );
  });
});
