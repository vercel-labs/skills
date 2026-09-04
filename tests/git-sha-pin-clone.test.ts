import { execFile } from 'child_process';
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanupTempDir, cloneRepo, GitCloneError } from '../src/git.ts';

function runGit(args: string[], cwd?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd }, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function runGitOutput(args: string[], cwd?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout);
    });
  });
}

describe('cloneRepo commit SHA pinning', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('clones and checks out an exact commit SHA that has no branch or tag', async () => {
    const root = await mkdtemp(join(tmpdir(), 'skills-sha-pin-test-'));
    tempDirs.push(root);
    const source = join(root, 'source');

    await runGit(['init', source]);
    await runGit(['config', 'user.email', 'skills-test@example.com'], source);
    await runGit(['config', 'user.name', 'Skills Test'], source);

    await writeFile(join(source, 'file.txt'), 'first\n');
    await runGit(['add', '.'], source);
    await runGit(['commit', '-m', 'first commit'], source);
    const pinnedSha = (await runGitOutput(['rev-parse', 'HEAD'], source)).trim();

    // A later commit moves the default branch forward with no tag anywhere,
    // so the only way to reach the first commit is by its bare SHA.
    await writeFile(join(source, 'file.txt'), 'second\n');
    await runGit(['add', '.'], source);
    await runGit(['commit', '-m', 'second commit'], source);

    const cloneDir = await cloneRepo(source, pinnedSha);
    tempDirs.push(cloneDir);

    const checkedOutSha = (await runGitOutput(['rev-parse', 'HEAD'], cloneDir)).trim();
    expect(checkedOutSha).toBe(pinnedSha);

    const contents = await readFile(join(cloneDir, 'file.txt'), 'utf8');
    expect(contents.replaceAll('\r\n', '\n')).toBe('first\n');

    await cleanupTempDir(cloneDir);
    tempDirs.splice(tempDirs.indexOf(cloneDir), 1);
  }, 20_000);

  it('still clones the default branch when no ref is given', async () => {
    const root = await mkdtemp(join(tmpdir(), 'skills-sha-pin-test-'));
    tempDirs.push(root);
    const source = join(root, 'source');

    await runGit(['init', source]);
    await runGit(['config', 'user.email', 'skills-test@example.com'], source);
    await runGit(['config', 'user.name', 'Skills Test'], source);
    await writeFile(join(source, 'file.txt'), 'only\n');
    await runGit(['add', '.'], source);
    await runGit(['commit', '-m', 'only commit'], source);

    const cloneDir = await cloneRepo(source);
    tempDirs.push(cloneDir);

    const contents = await readFile(join(cloneDir, 'file.txt'), 'utf8');
    expect(contents.replaceAll('\r\n', '\n')).toBe('only\n');

    await cleanupTempDir(cloneDir);
    tempDirs.splice(tempDirs.indexOf(cloneDir), 1);
  }, 20_000);

  it('still uses --branch for a real branch name (unaffected by the SHA path)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'skills-sha-pin-test-'));
    tempDirs.push(root);
    const source = join(root, 'source');

    await runGit(['init', source]);
    await runGit(['config', 'user.email', 'skills-test@example.com'], source);
    await runGit(['config', 'user.name', 'Skills Test'], source);
    await writeFile(join(source, 'file.txt'), 'main\n');
    await runGit(['add', '.'], source);
    await runGit(['commit', '-m', 'main commit'], source);
    await runGit(['checkout', '-b', 'feature'], source);
    await writeFile(join(source, 'file.txt'), 'feature\n');
    await runGit(['add', '.'], source);
    await runGit(['commit', '-m', 'feature commit'], source);

    const cloneDir = await cloneRepo(source, 'feature');
    tempDirs.push(cloneDir);

    const contents = await readFile(join(cloneDir, 'file.txt'), 'utf8');
    expect(contents.replaceAll('\r\n', '\n')).toBe('feature\n');

    await cleanupTempDir(cloneDir);
    tempDirs.splice(tempDirs.indexOf(cloneDir), 1);
  }, 20_000);

  it('fails with a clear error for a SHA that does not exist in the repo', async () => {
    const root = await mkdtemp(join(tmpdir(), 'skills-sha-pin-test-'));
    tempDirs.push(root);
    const source = join(root, 'source');

    await runGit(['init', source]);
    await runGit(['config', 'user.email', 'skills-test@example.com'], source);
    await runGit(['config', 'user.name', 'Skills Test'], source);
    await writeFile(join(source, 'file.txt'), 'only\n');
    await runGit(['add', '.'], source);
    await runGit(['commit', '-m', 'only commit'], source);

    const bogusSha = '0'.repeat(40);
    await expect(cloneRepo(source, bogusSha)).rejects.toThrow(GitCloneError);
  }, 20_000);
});
