import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile, symlink, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { computeSkillFolderHash, hashSkillFiles } from '../src/skill-hash.ts';
import { copyDirectory } from '../src/installer.ts';
import {
  computeLegacySkillFolderHash,
  getLockedSkillState,
  readLocalLock,
} from '../src/local-lock.ts';

describe('hashSkillFiles', () => {
  // The vectors documented in README.md ("Lock file content hash")
  it('matches the documented test vectors', () => {
    expect(hashSkillFiles([])).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    );
    expect(hashSkillFiles([{ path: 'SKILL.md', content: '# hi\n' }])).toBe(
      '93c36952d8843b33e68ae970ebabcc03e1687c9bb0dd1ecaf357060318952f55'
    );
    expect(
      hashSkillFiles([
        { path: 'docs/b.md', content: 'b\n' },
        { path: 'SKILL.md', content: 'a\n' },
      ])
    ).toBe('b22c4d22aa319d2924312fa18fcbfedc88fa89c74dbd8f298c683e1caf7b7f24');
  });

  it('sorts paths by UTF-8 bytes, not locale', () => {
    const files = [
      { path: 'b.md', content: '1' },
      { path: 'B.md', content: '2' },
      { path: 'ä.md', content: '3' },
    ];
    expect(hashSkillFiles(files)).toBe(hashSkillFiles([files[1]!, files[0]!, files[2]!]));
    expect(hashSkillFiles(files)).toBe(hashSkillFiles([files[2]!, files[1]!, files[0]!]));
  });

  it('frames each file so content cannot move between path and body', () => {
    expect(hashSkillFiles([{ path: 'ab', content: 'c' }])).not.toBe(
      hashSkillFiles([{ path: 'a', content: 'bc' }])
    );
    expect(
      hashSkillFiles([
        { path: 'a', content: 'x' },
        { path: 'b', content: '' },
      ])
    ).not.toBe(hashSkillFiles([{ path: 'a', content: 'xb' }]));
  });

  it('treats CRLF and LF text files the same', () => {
    expect(hashSkillFiles([{ path: 'SKILL.md', content: '# hi\r\nthere\r\n' }])).toBe(
      hashSkillFiles([{ path: 'SKILL.md', content: '# hi\nthere\n' }])
    );
  });

  it('keeps CRLF in binary files', () => {
    const crlf = Buffer.from([0, 13, 10]);
    const lf = Buffer.from([0, 10]);
    expect(hashSkillFiles([{ path: 'a.bin', content: crlf }])).not.toBe(
      hashSkillFiles([{ path: 'a.bin', content: lf }])
    );
  });

  it('accepts Windows separators', () => {
    expect(hashSkillFiles([{ path: 'docs\\b.md', content: 'b' }])).toBe(
      hashSkillFiles([{ path: 'docs/b.md', content: 'b' }])
    );
  });
});

describe('computeSkillFolderHash', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'skill-hash-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function writeSkill(skillDir: string): Promise<void> {
    await mkdir(join(skillDir, 'docs'), { recursive: true });
    await writeFile(join(skillDir, 'SKILL.md'), 'a\n');
    await writeFile(join(skillDir, 'docs', 'b.md'), 'b\n');
  }

  it('hashes a folder like the same files in memory', async () => {
    const skillDir = join(dir, 'skill');
    await writeSkill(skillDir);
    expect(await computeSkillFolderHash(skillDir)).toBe(
      'b22c4d22aa319d2924312fa18fcbfedc88fa89c74dbd8f298c683e1caf7b7f24'
    );
  });

  it('equals the hash of the installed copy', async () => {
    const skillDir = join(dir, 'skill');
    await writeSkill(skillDir);
    await writeFile(join(skillDir, 'metadata.json'), '{}');
    await mkdir(join(skillDir, '.git'));
    await writeFile(join(skillDir, '.git', 'HEAD'), 'ref');
    await mkdir(join(skillDir, 'node_modules', 'x'), { recursive: true });
    await writeFile(join(skillDir, 'node_modules', 'x', 'index.js'), 'x');
    await symlink('SKILL.md', join(skillDir, 'linked.md'));
    await symlink(join(dir, 'outside.md'), join(skillDir, 'escape.md'));
    await writeFile(join(dir, 'outside.md'), 'secret');

    const installed = join(dir, 'installed');
    await copyDirectory(skillDir, installed);

    expect(await computeSkillFolderHash(installed)).toBe(await computeSkillFolderHash(skillDir));
  });

  it('hashes symlinked files by their content', async () => {
    const linked = join(dir, 'linked');
    await writeSkill(linked);
    await rm(join(linked, 'docs', 'b.md'));
    await writeFile(join(linked, 'b-source.md'), 'b\n');
    await symlink('../b-source.md', join(linked, 'docs', 'b.md'));

    const plain = join(dir, 'plain');
    await writeSkill(plain);
    await writeFile(join(plain, 'b-source.md'), 'b\n');

    expect(await computeSkillFolderHash(linked)).toBe(await computeSkillFolderHash(plain));
  });

  it('leaves out links that escape the skill folder', async () => {
    const skillDir = join(dir, 'skill');
    await writeSkill(skillDir);
    const before = await computeSkillFolderHash(skillDir);
    await writeFile(join(dir, 'secret.txt'), 'secret');
    await symlink(join(dir, 'secret.txt'), join(skillDir, 'secret.txt'));
    await symlink(dir, join(skillDir, 'parent'));
    await symlink(join(dir, 'nowhere'), join(skillDir, 'broken'));

    expect(await computeSkillFolderHash(skillDir)).toBe(before);
  });

  it('does not loop on a directory link cycle', async () => {
    const skillDir = join(dir, 'skill');
    await writeSkill(skillDir);
    const before = await computeSkillFolderHash(skillDir);
    await symlink('..', join(skillDir, 'docs', 'loop'));

    expect(await computeSkillFolderHash(skillDir)).toBe(before);
  });
});

describe('lock v2', () => {
  let dir: string;
  const skillDir = (name: string) => join(dir, '.agents', 'skills', name);

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'lock-v2-'));
    await mkdir(skillDir('alpha'), { recursive: true });
    await writeFile(join(skillDir('alpha'), 'SKILL.md'), 'a\n');
    await mkdir(skillDir('gamma'), { recursive: true });
    await writeFile(join(skillDir('gamma'), 'SKILL.md'), 'g\n');
    const entry = { source: 'owner/repo', sourceType: 'github' };
    await writeFile(
      join(dir, 'skills-lock.json'),
      JSON.stringify({
        version: 1,
        skills: {
          alpha: { ...entry, computedHash: await computeLegacySkillFolderHash(skillDir('alpha')) },
          beta: { ...entry, computedHash: 'v1-hash' },
          // Installed, but edited since the v1 lock was written
          gamma: { ...entry, computedHash: 'v1-hash' },
        },
      })
    );
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('migrates a v1 lock from the installed skills that match it, without writing it', async () => {
    const lock = await readLocalLock(dir);

    expect(lock.version).toBe(2);
    expect(lock.skills.alpha!.computedHash).toBe(await computeSkillFolderHash(skillDir('alpha')));
    expect(lock.skills.beta!.computedHash).toBe('');
    expect(lock.skills.gamma!.computedHash).toBe('');
    expect(JSON.parse(await readFile(join(dir, 'skills-lock.json'), 'utf-8')).version).toBe(1);
  });

  it('writes the migrated lock when asked', async () => {
    await readLocalLock(dir, { persistMigration: true });

    const written = JSON.parse(await readFile(join(dir, 'skills-lock.json'), 'utf-8'));
    expect(written.version).toBe(2);
    expect(written.skills.alpha.source).toBe('owner/repo');
    expect(written.skills.alpha.computedHash).toBe(await computeSkillFolderHash(skillDir('alpha')));
  });

  it('reports installed skills as tracked, modified or missing', async () => {
    const lock = await readLocalLock(dir);
    expect(await getLockedSkillState('alpha', lock.skills.alpha!, dir)).toBe('tracked');
    expect(await getLockedSkillState('beta', lock.skills.beta!, dir)).toBe('missing');
    expect(await getLockedSkillState('gamma', lock.skills.gamma!, dir)).toBe('modified');

    await writeFile(join(skillDir('alpha'), 'SKILL.md'), 'a\r\n');
    expect(await getLockedSkillState('alpha', lock.skills.alpha!, dir)).toBe('tracked');

    await writeFile(join(skillDir('alpha'), 'SKILL.md'), 'edited\n');
    expect(await getLockedSkillState('alpha', lock.skills.alpha!, dir)).toBe('modified');
  });
});
