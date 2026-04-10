import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { addSkillToLock, readSkillLock, findEntriesBySkillName } from '../src/skill-lock.ts';

describe('collision detection', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'collision-test-'));
    vi.stubEnv('XDG_STATE_HOME', tempDir);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(tempDir, { recursive: true, force: true });
  });

  it('detects collision when same skill name exists from different source', async () => {
    await addSkillToLock('react-tips', {
      source: 'owner1/repo',
      sourceType: 'github',
      sourceUrl: 'https://github.com/owner1/repo.git',
      skillFolderHash: 'abc',
    });

    const lock = await readSkillLock();
    const matches = findEntriesBySkillName(lock, 'react-tips');
    const currentSource = 'owner2/repo';
    const conflicting = matches.filter((m) => m.entry.source !== currentSource);

    expect(conflicting).toHaveLength(1);
    expect(conflicting[0]!.entry.source).toBe('owner1/repo');
  });

  it('no collision when same skill name exists from same source', async () => {
    await addSkillToLock('react-tips', {
      source: 'owner1/repo',
      sourceType: 'github',
      sourceUrl: 'https://github.com/owner1/repo.git',
      skillFolderHash: 'abc',
    });

    const lock = await readSkillLock();
    const matches = findEntriesBySkillName(lock, 'react-tips');
    const currentSource = 'owner1/repo';
    const conflicting = matches.filter((m) => m.entry.source !== currentSource);

    expect(conflicting).toHaveLength(0);
  });

  it('no collision when no existing skill with that name', async () => {
    const lock = await readSkillLock();
    const matches = findEntriesBySkillName(lock, 'react-tips');
    expect(matches).toHaveLength(0);
  });
});
