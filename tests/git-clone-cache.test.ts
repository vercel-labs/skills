import { execFileSync } from 'node:child_process';
import { access, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { withGitCloneCache } from '../src/git.ts';

const gitModule = new URL('../src/git.ts', import.meta.url).href;

// Separate Node processes exercise the same clone/cleanup seam as update's add children.
describe('invocation-scoped Git clone cache', () => {
  let root: string;
  let source: string;
  let env: NodeJS.ProcessEnv;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'skills-clone-cache-test-'));
    source = join(root, 'source');
    const config = join(root, 'gitconfig');
    await writeFile(config, '');
    env = {
      ...process.env,
      GIT_CONFIG_GLOBAL: config,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_COUNT: '0',
      GIT_TERMINAL_PROMPT: '0',
      EDITOR: 'false',
      PAGER: 'cat',
    };
    const git = (args: string[], cwd = root) =>
      execFileSync('git', args, { cwd, env, stdio: 'pipe' });
    git(['init', '--initial-branch=main', source]);
    git(['config', 'user.name', 'Skills Fixture'], source);
    git(['config', 'user.email', 'fixture@example.invalid'], source);
    await writeFile(join(source, 'fixture.txt'), 'complete checkout\n');
    git(['add', '.'], source);
    git(['-c', 'commit.gpgsign=false', 'commit', '-m', 'fixture'], source);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  function cloneInChild(url: string, cacheEnv: NodeJS.ProcessEnv): string {
    const output = execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `import { cloneRepo, cleanupTempDir } from ${JSON.stringify(gitModule)};
         const dir = await cloneRepo(process.argv[1]);
         await cleanupTempDir(dir);
         await cleanupTempDir(dir);
         console.log(JSON.stringify(dir));`,
        url,
      ],
      {
        env: { ...env, SKILLS_UPDATE_CLONE_CACHE_DIR: cacheEnv.SKILLS_UPDATE_CLONE_CACHE_DIR },
        encoding: 'utf8',
        stdio: 'pipe',
        timeout: 20_000,
      }
    );
    return JSON.parse(output.trim());
  }

  it('lets sequential children borrow the same checkout without deleting it', async () => {
    let directory: string;
    await withGitCloneCache(async (cacheEnv) => {
      directory = cloneInChild(source, cacheEnv);
      expect(await readFile(join(directory, 'fixture.txt'), 'utf8')).toBe('complete checkout\n');
      expect(cloneInChild(source, cacheEnv)).toBe(directory);
      await expect(access(join(directory, '.git'))).resolves.toBeUndefined();
    });
    await expect(access(directory!)).rejects.toMatchObject({ code: 'ENOENT' });
  }, 20_000);

  it('does not cache a failed clone, allowing a later child to retry', async () => {
    const delayedSource = join(root, 'appears-later');
    await withGitCloneCache(async (cacheEnv) => {
      expect(() => cloneInChild(delayedSource, cacheEnv)).toThrow();
      await rename(source, delayedSource);
      const directory = cloneInChild(delayedSource, cacheEnv);
      expect(await readFile(join(directory, 'fixture.txt'), 'utf8')).toBe('complete checkout\n');
    });
  }, 20_000);

  it('removes the whole cache when its owner fails', async () => {
    let cacheDirectory: string;
    await expect(
      withGitCloneCache(async (cacheEnv) => {
        cacheDirectory = cacheEnv.SKILLS_UPDATE_CLONE_CACHE_DIR!;
        cloneInChild(source, cacheEnv);
        throw new Error('installation interrupted');
      })
    ).rejects.toThrow('installation interrupted');
    await expect(access(cacheDirectory!)).rejects.toMatchObject({ code: 'ENOENT' });
  }, 20_000);

  it('still rejects unsafe transports when the cache is enabled', async () => {
    await withGitCloneCache(async (cacheEnv) => {
      expect(() => cloneInChild('ext::git-remote-skills-test', cacheEnv)).toThrow();
      expect(() => cloneInChild('fd::3', cacheEnv)).toThrow();
    });
  }, 20_000);
});
