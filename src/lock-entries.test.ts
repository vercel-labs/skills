import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  addSkillToLock,
  getSkillLockPath,
  mergeLockEntriesFiles,
  readSkillLock,
  writeSkillLock,
  LOCK_ENTRIES_FILE_ENV,
} from './skill-lock.ts';
import {
  addSkillToLocalLock,
  mergeLocalLockEntriesFiles,
  readLocalLock,
  LOCAL_LOCK_ENTRIES_FILE_ENV,
} from './local-lock.ts';

const entry = (source: string) => ({
  source,
  sourceType: 'github',
  sourceUrl: `https://github.com/${source}.git`,
  skillFolderHash: 'abc',
});

describe('lock entries files (concurrent multi-source add)', () => {
  let dir: string;
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'skills-lock-entries-'));
    for (const key of ['XDG_STATE_HOME', LOCK_ENTRIES_FILE_ENV, LOCAL_LOCK_ENTRIES_FILE_ENV]) {
      saved[key] = process.env[key];
    }
    // Keep the global lock inside the temp dir.
    process.env.XDG_STATE_HOME = join(dir, 'state');
    delete process.env[LOCK_ENTRIES_FILE_ENV];
    delete process.env[LOCAL_LOCK_ENTRIES_FILE_ENV];
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(dir, { recursive: true, force: true });
  });

  it('addSkillToLock appends to the entries file instead of touching the lock when the env is set', async () => {
    const entriesFile = join(dir, 'global-0.jsonl');
    process.env[LOCK_ENTRIES_FILE_ENV] = entriesFile;

    await addSkillToLock('one', entry('o/r'));
    await addSkillToLock('two', entry('o/r'));

    expect(existsSync(getSkillLockPath())).toBe(false);
    const lines = readFileSync(entriesFile, 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!)).toEqual({ name: 'one', entry: entry('o/r') });
  });

  it('mergeLockEntriesFiles folds every file into one lock write and keeps installedAt', async () => {
    await writeSkillLock({
      version: 3,
      skills: {
        one: {
          ...entry('o/r'),
          installedAt: '2020-01-01T00:00:00.000Z',
          updatedAt: '2020-01-01T00:00:00.000Z',
        },
      },
      dismissed: {},
    });
    const a = join(dir, 'a.jsonl');
    const b = join(dir, 'b.jsonl');
    writeFileSync(a, JSON.stringify({ name: 'one', entry: entry('o/r') }) + '\n');
    writeFileSync(
      b,
      JSON.stringify({ name: 'two', entry: entry('x/y') }) +
        '\n' +
        JSON.stringify({ name: 'three', entry: entry('x/y') }) +
        '\n'
    );

    const applied = await mergeLockEntriesFiles([a, b, join(dir, 'missing.jsonl')]);
    expect(applied).toBe(3);

    const lock = await readSkillLock();
    expect(Object.keys(lock.skills).sort()).toEqual(['one', 'three', 'two']);
    expect(lock.skills.one!.installedAt).toBe('2020-01-01T00:00:00.000Z');
    expect(lock.skills.one!.updatedAt).not.toBe('2020-01-01T00:00:00.000Z');
    expect(lock.skills.two!.source).toBe('x/y');
  });

  it('mergeLockEntriesFiles is a no-op when no entries exist', async () => {
    expect(await mergeLockEntriesFiles([join(dir, 'missing.jsonl')])).toBe(0);
    expect(existsSync(getSkillLockPath())).toBe(false);
  });

  it('project lock: entries file redirect and merge', async () => {
    const project = join(dir, 'project');
    const entriesFile = join(dir, 'project-0.jsonl');
    const localEntry = {
      source: 'o/r',
      sourceType: 'github',
      skillPath: 'skills/one/SKILL.md',
      skillFolderHash: 'h',
    };

    process.env[LOCAL_LOCK_ENTRIES_FILE_ENV] = entriesFile;
    await addSkillToLocalLock('one', localEntry as any, project);
    expect(existsSync(join(project, 'skills-lock.json'))).toBe(false);
    delete process.env[LOCAL_LOCK_ENTRIES_FILE_ENV];

    const { mkdirSync } = await import('fs');
    mkdirSync(project, { recursive: true });
    expect(await mergeLocalLockEntriesFiles([entriesFile], project)).toBe(1);
    const lock = await readLocalLock(project);
    expect(Object.keys(lock.skills)).toEqual(['one']);
  });
});
