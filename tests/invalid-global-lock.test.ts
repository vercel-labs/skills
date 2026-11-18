import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  chmodSync,
  statSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  addSkillToLock,
  dismissPrompt,
  getSkillLockPath,
  readSkillLock,
  saveSelectedAgents,
  writeSkillLock,
} from '../src/skill-lock.ts';

const sampleEntry = {
  source: 'test/repo',
  sourceType: 'github',
  sourceUrl: 'https://github.com/test/repo',
  skillFolderHash: 'test-hash',
};

describe('global lock corruption protection', () => {
  let root: string;
  let lockPath: string;
  let oldXdgStateHome: string | undefined;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'skills-global-lock-'));
    oldXdgStateHome = process.env.XDG_STATE_HOME;
    process.env.XDG_STATE_HOME = root;
    lockPath = getSkillLockPath();
    mkdirSync(dirname(lockPath), { recursive: true });
  });

  afterEach(() => {
    if (oldXdgStateHome === undefined) delete process.env.XDG_STATE_HOME;
    else process.env.XDG_STATE_HOME = oldXdgStateHome;
    rmSync(root, { recursive: true, force: true });
  });

  it('starts with an empty lock only when the file is missing', async () => {
    await expect(readSkillLock()).resolves.toMatchObject({ version: 3, skills: {} });
  });

  it('propagates non-ENOENT read failures rather than resetting the lock', async () => {
    mkdirSync(lockPath);
    await expect(readSkillLock()).rejects.toThrow();
  });

  it('refuses malformed JSON without overwriting old installation metadata', async () => {
    const truncated = '{"version":3,"skills":{"alpha":{"source":"test/repo"}},"beta":';
    writeFileSync(lockPath, truncated, 'utf8');

    await expect(readSkillLock()).rejects.toThrow(/Invalid global skill lock.*malformed JSON/);
    await expect(addSkillToLock('gamma', sampleEntry)).rejects.toThrow(/Invalid global skill lock/);
    await expect(saveSelectedAgents(['claude-code'])).rejects.toThrow(/Invalid global skill lock/);
    await expect(dismissPrompt('findSkillsPrompt')).rejects.toThrow(/Invalid global skill lock/);

    expect(readFileSync(lockPath, 'utf8')).toBe(truncated);
    expect(readdirSync(dirname(lockPath))).toEqual(['.skill-lock.json']);
  });

  it('refuses non-object JSON rather than silently resetting the lock', async () => {
    writeFileSync(lockPath, 'null', 'utf8');
    await expect(readSkillLock()).rejects.toThrow(/Invalid global skill lock.*JSON object/);
    expect(readFileSync(lockPath, 'utf8')).toBe('null');
  });

  it.skipIf(process.platform === 'win32').each([0o600, 0o640])(
    'preserves existing POSIX permission bits (%i) when replacing the lock',
    async (mode) => {
      await addSkillToLock('alpha', sampleEntry);
      chmodSync(lockPath, mode);
      await saveSelectedAgents(['codex']);
      expect(statSync(lockPath).mode & 0o777).toBe(mode);
      expect((await readSkillLock()).lastSelectedAgents).toEqual(['codex']);
    }
  );

  it.skipIf(process.platform === 'win32')('creates a private global lock', async () => {
    await addSkillToLock('alpha', sampleEntry);
    expect(statSync(lockPath).mode & 0o077).toBe(0);
  });

  it('preserves valid entries and leaves no temporary files after an atomic update', async () => {
    await addSkillToLock('alpha', sampleEntry);
    await addSkillToLock('beta', { ...sampleEntry, source: 'test/other' });
    await saveSelectedAgents(['claude-code', 'codex']);
    await dismissPrompt('findSkillsPrompt');

    const lock = await readSkillLock();
    expect(Object.keys(lock.skills)).toEqual(['alpha', 'beta']);
    expect(lock.lastSelectedAgents).toEqual(['claude-code', 'codex']);
    expect(lock.dismissed?.findSkillsPrompt).toBe(true);
    expect(readdirSync(dirname(lockPath))).toEqual(['.skill-lock.json']);

    await writeSkillLock(lock);
    expect(JSON.parse(readFileSync(lockPath, 'utf8'))).toEqual(lock);
    expect(readdirSync(dirname(lockPath))).toEqual(['.skill-lock.json']);
  });
});
