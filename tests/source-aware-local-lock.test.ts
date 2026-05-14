import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { addSkillToLocalLock, removeSkillFromLocalLock, readLocalLock } from '../src/local-lock.ts';

describe('source-aware local lock keys', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'local-lock-test-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('stores skill under source::name key', async () => {
    await addSkillToLocalLock(
      'my-skill',
      { source: 'owner/repo', sourceType: 'github', computedHash: 'abc123' },
      tempDir
    );
    const lock = await readLocalLock(tempDir);
    expect(lock.skills['owner/repo::my-skill']).toBeDefined();
    expect(lock.skills['my-skill']).toBeUndefined();
  });

  it('allows same skill name from different sources', async () => {
    await addSkillToLocalLock(
      'react-tips',
      { source: 'owner1/repo', sourceType: 'github', computedHash: 'abc' },
      tempDir
    );
    await addSkillToLocalLock(
      'react-tips',
      { source: 'owner2/repo', sourceType: 'github', computedHash: 'def' },
      tempDir
    );
    const lock = await readLocalLock(tempDir);
    expect(lock.skills['owner1/repo::react-tips']).toBeDefined();
    expect(lock.skills['owner2/repo::react-tips']).toBeDefined();
  });

  it('removes skill by name regardless of source', async () => {
    await addSkillToLocalLock(
      'my-skill',
      { source: 'owner/repo', sourceType: 'github', computedHash: 'abc' },
      tempDir
    );
    const removed = await removeSkillFromLocalLock('my-skill', tempDir);
    expect(removed).toBe(true);
    const lock = await readLocalLock(tempDir);
    expect(Object.keys(lock.skills)).toHaveLength(0);
  });

  it('creates lock file with version 2', async () => {
    await addSkillToLocalLock(
      'test',
      { source: 'owner/repo', sourceType: 'github', computedHash: 'abc' },
      tempDir
    );
    const lock = await readLocalLock(tempDir);
    expect(lock.version).toBe(2);
  });
});
