import { describe, it, expect } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import simpleGit from 'simple-git';
import { getLocalBranch } from '../src/git.ts';

describe('getLocalBranch', () => {
  it('returns the branch name for a normal repo', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'git-test-'));
    try {
      const git = simpleGit(dir);
      await git.init();
      await git.addConfig('user.email', 'test@example.com');
      await git.addConfig('user.name', 'Test User');
      await writeFile(join(dir, 'file.txt'), 'content', 'utf-8');
      await git.add('file.txt');
      await git.commit('initial');

      const branch = await getLocalBranch(dir);
      expect(branch).not.toBeNull();
      expect(typeof branch).toBe('string');
      expect(branch!.length).toBeGreaterThan(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('returns null for a directory that is not a git repo', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'git-test-'));
    try {
      const branch = await getLocalBranch(dir);
      expect(branch).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('returns null in detached-HEAD state', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'git-test-'));
    try {
      const git = simpleGit(dir);
      await git.init();
      await git.addConfig('user.email', 'test@example.com');
      await git.addConfig('user.name', 'Test User');
      await writeFile(join(dir, 'file.txt'), 'content', 'utf-8');
      await git.add('file.txt');
      await git.commit('initial');
      const sha = (await git.revparse(['HEAD'])).trim();
      await git.checkout(sha);

      const branch = await getLocalBranch(dir);
      expect(branch).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
