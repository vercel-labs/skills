import { execFile } from 'child_process';
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanupTempDir, cloneRepo } from '../src/git.ts';

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

describe('cloneRepo LFS handling', () => {
  const tempDirs: string[] = [];
  const originalEnv = {
    GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL,
    GIT_CONFIG_NOSYSTEM: process.env.GIT_CONFIG_NOSYSTEM,
  };

  afterEach(async () => {
    if (originalEnv.GIT_CONFIG_GLOBAL === undefined) delete process.env.GIT_CONFIG_GLOBAL;
    else process.env.GIT_CONFIG_GLOBAL = originalEnv.GIT_CONFIG_GLOBAL;
    if (originalEnv.GIT_CONFIG_NOSYSTEM === undefined) delete process.env.GIT_CONFIG_NOSYSTEM;
    else process.env.GIT_CONFIG_NOSYSTEM = originalEnv.GIT_CONFIG_NOSYSTEM;

    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('clones successfully when the configured LFS filter executable is unavailable', async () => {
    const root = await mkdtemp(join(tmpdir(), 'skills-lfs-test-'));
    tempDirs.push(root);
    const source = join(root, 'source');
    const globalConfig = join(root, 'global.gitconfig');

    await runGit(['init', source]);
    await runGit(['config', 'user.email', 'skills-test@example.com'], source);
    await runGit(['config', 'user.name', 'Skills Test'], source);
    await writeFile(join(source, '.gitattributes'), '*.bin filter=lfs\n');
    await writeFile(join(source, 'asset.bin'), 'not-an-lfs-pointer\n');
    await runGit(['add', '.'], source);
    await runGit(['commit', '-m', 'fixture'], source);
    const expectedContents = await runGitOutput(['show', 'HEAD:asset.bin'], source);

    // Without cloneRepo's command-level overrides, this filter makes checkout
    // fail because the configured executable deliberately does not exist.
    await writeFile(
      globalConfig,
      `[filter "lfs"]
  required = true
  smudge = skills-test-missing-lfs smudge -- %f
  clean = skills-test-missing-lfs clean -- %f
  process = skills-test-missing-lfs filter-process
`
    );
    process.env.GIT_CONFIG_NOSYSTEM = '1';
    process.env.GIT_CONFIG_GLOBAL = globalConfig;

    const cloneDir = await cloneRepo(source);
    tempDirs.push(cloneDir);

    const actualContents = await readFile(join(cloneDir, 'asset.bin'), 'utf8');
    expect(actualContents.replaceAll('\r\n', '\n')).toBe(expectedContents.replaceAll('\r\n', '\n'));
    await cleanupTempDir(cloneDir);
    tempDirs.splice(tempDirs.indexOf(cloneDir), 1);
  }, 20_000);
});
