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
    EDITOR: process.env.EDITOR,
    GIT_CONFIG_COUNT: process.env.GIT_CONFIG_COUNT,
    GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL,
    GIT_CONFIG_KEY_0: process.env.GIT_CONFIG_KEY_0,
    GIT_CONFIG_NOSYSTEM: process.env.GIT_CONFIG_NOSYSTEM,
    GIT_CONFIG_VALUE_0: process.env.GIT_CONFIG_VALUE_0,
    PAGER: process.env.PAGER,
  };

  afterEach(async () => {
    if (originalEnv.EDITOR === undefined) delete process.env.EDITOR;
    else process.env.EDITOR = originalEnv.EDITOR;
    if (originalEnv.GIT_CONFIG_COUNT === undefined) delete process.env.GIT_CONFIG_COUNT;
    else process.env.GIT_CONFIG_COUNT = originalEnv.GIT_CONFIG_COUNT;
    if (originalEnv.GIT_CONFIG_GLOBAL === undefined) delete process.env.GIT_CONFIG_GLOBAL;
    else process.env.GIT_CONFIG_GLOBAL = originalEnv.GIT_CONFIG_GLOBAL;
    if (originalEnv.GIT_CONFIG_KEY_0 === undefined) delete process.env.GIT_CONFIG_KEY_0;
    else process.env.GIT_CONFIG_KEY_0 = originalEnv.GIT_CONFIG_KEY_0;
    if (originalEnv.GIT_CONFIG_NOSYSTEM === undefined) delete process.env.GIT_CONFIG_NOSYSTEM;
    else process.env.GIT_CONFIG_NOSYSTEM = originalEnv.GIT_CONFIG_NOSYSTEM;
    if (originalEnv.GIT_CONFIG_VALUE_0 === undefined) delete process.env.GIT_CONFIG_VALUE_0;
    else process.env.GIT_CONFIG_VALUE_0 = originalEnv.GIT_CONFIG_VALUE_0;
    if (originalEnv.PAGER === undefined) delete process.env.PAGER;
    else process.env.PAGER = originalEnv.PAGER;

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
    // Preserve callers that inject Git configuration through the environment,
    // including credential helpers commonly supplied by surrounding tooling.
    process.env.GIT_CONFIG_COUNT = '1';
    process.env.GIT_CONFIG_KEY_0 = 'credential.helper';
    process.env.GIT_CONFIG_VALUE_0 = '';
    process.env.GIT_CONFIG_NOSYSTEM = '1';
    process.env.GIT_CONFIG_GLOBAL = globalConfig;
    // These are harmless for clone, but simple-git still validates explicitly
    // supplied inherited environment variables before spawning Git.
    process.env.EDITOR = 'false';
    process.env.PAGER = 'cat';

    const cloneDir = await cloneRepo(source);
    tempDirs.push(cloneDir);

    const actualContents = await readFile(join(cloneDir, 'asset.bin'), 'utf8');
    expect(actualContents.replaceAll('\r\n', '\n')).toBe(expectedContents.replaceAll('\r\n', '\n'));
    await cleanupTempDir(cloneDir);
    tempDirs.splice(tempDirs.indexOf(cloneDir), 1);
  }, 20_000);
});
