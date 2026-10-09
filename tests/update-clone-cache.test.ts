import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'obuild';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));

// Real CLI and Git, with a private HOME and URL rewrites instead of network access.
describe('global update clone reuse', () => {
  let root: string;
  let home: string;
  let cwd: string;
  let temp: string;
  let trace: string;
  let config: string;
  let env: NodeJS.ProcessEnv;
  let cliRoot: string;
  let cli: string;

  beforeAll(async () => {
    // dist.test.ts rebuilds (and deletes) the shared dist directory concurrently.
    // Build our own CLI; its location under node_modules resolves tar/yaml without symlinks.
    cliRoot = await mkdtemp(join(projectRoot, 'node_modules/.skills-update-cli-'));
    await build({
      cwd: projectRoot,
      entries: [
        {
          type: 'bundle',
          input: './src/cli.ts',
          outDir: join(cliRoot, 'dist'),
          dts: false,
          license: false,
        },
      ],
    });
    await cp(join(projectRoot, 'bin'), join(cliRoot, 'bin'), { recursive: true });
    await cp(join(projectRoot, 'package.json'), join(cliRoot, 'package.json'));
    cli = join(cliRoot, 'bin/cli.mjs');
  }, 30_000);

  afterAll(async () => {
    if (cliRoot) await rm(cliRoot, { recursive: true, force: true });
  });

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'skills-update-cache-test-'));
    home = join(root, 'home');
    cwd = join(root, 'project');
    temp = join(root, 'tmp');
    trace = join(root, 'git.trace');
    config = join(root, 'gitconfig');
    for (const path of [home, cwd, temp, join(home, '.claude'), join(home, '.agents')]) {
      await mkdir(path, { recursive: true });
    }
    await writeFile(config, '');
    await writeFile(trace, '');
    await writeFile(
      join(home, '.agents/.skill-lock.json'),
      JSON.stringify({ version: 3, skills: {}, dismissed: { findSkillsPrompt: true } })
    );
    env = {
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      HOME: home,
      USERPROFILE: home,
      APPDATA: join(home, 'AppData/Roaming'),
      LOCALAPPDATA: join(home, 'AppData/Local'),
      XDG_CONFIG_HOME: join(home, '.config'),
      XDG_CACHE_HOME: join(home, '.cache'),
      XDG_DATA_HOME: join(home, '.local/share'),
      TMPDIR: temp,
      TMP: temp,
      TEMP: temp,
      GIT_CONFIG_GLOBAL: config,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_TERMINAL_PROMPT: '0',
      GIT_TRACE: trace,
      DISABLE_TELEMETRY: '1',
      DO_NOT_TRACK: '1',
      CI: '1',
      NO_COLOR: '1',
    };
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  function git(args: string[], repo = cwd): string {
    return execFileSync('git', args, { cwd: repo, env, encoding: 'utf8', stdio: 'pipe' });
  }

  function runCli(args: string[]): string {
    return execFileSync(process.execPath, [cli, ...args], {
      cwd,
      env,
      encoding: 'utf8',
      timeout: 20_000,
      maxBuffer: 2 * 1024 * 1024,
      stdio: 'pipe',
    });
  }

  async function writeSkills(repo: string, names: string[], revision: number): Promise<void> {
    for (const name of names) {
      const folder = join(repo, 'skills', name);
      await mkdir(folder, { recursive: true });
      await writeFile(
        join(folder, 'SKILL.md'),
        `---\nname: ${name}\ndescription: Offline update fixture\n---\n\nRevision ${revision}\n`
      );
    }
  }

  async function createRepo(
    id: string,
    names: string[],
    source = `https://skills-test.invalid/owner/${id}.git`
  ): Promise<{ repo: string; source: string }> {
    const repo = join(root, id);
    await mkdir(repo);
    git(['init', '--initial-branch=main'], repo);
    git(['config', 'user.email', 'fixture@example.invalid'], repo);
    git(['config', 'user.name', 'Skills Fixture'], repo);
    git(['config', '--file', config, `url.${pathToFileURL(repo).href}.insteadOf`, source]);
    await writeSkills(repo, names, 1);
    commit(repo);
    return { repo, source };
  }

  function commit(repo: string): void {
    git(['add', '.'], repo);
    git(['-c', 'commit.gpgsign=false', 'commit', '-m', 'fixture'], repo);
  }

  async function cloneCount(): Promise<number> {
    return (await readFile(trace, 'utf8')).match(/built-in: git clone\b/g)?.length ?? 0;
  }

  async function assertInstalled(names: string[]): Promise<void> {
    const lock = JSON.parse(await readFile(join(home, '.agents/.skill-lock.json'), 'utf8'));
    for (const name of names) {
      expect(lock.skills[name].skillFolderHash).toBeTruthy();
      expect(await readFile(join(home, '.agents/skills', name, 'SKILL.md'), 'utf8')).toContain(
        'Revision 2'
      );
    }
  }

  it('clones once for installation when two skills share a source', async () => {
    const names = ['cache-a', 'cache-b'];
    const { repo, source } = await createRepo('one', names);
    runCli(['add', source, '--skill', ...names, '--full-depth', '-g', '-y']);
    await writeSkills(repo, names, 2);
    commit(repo);
    await writeFile(trace, '');

    const output = runCli(['update', '-g', '-y']);

    expect(output).toContain('Updated 2 skill(s)');
    await assertInstalled(names);
    // One clone for the generic-Git update check, one shared installation clone.
    expect(await cloneCount()).toBe(2);
    expect(
      (await readdir(temp)).filter((name) => name.startsWith('skills-update-clones-'))
    ).toEqual([]);
  }, 20_000);

  it('preserves locked GitHub paths when another folder has the same skill name', async () => {
    const names = ['cache-a', 'cache-b'];
    const { repo, source } = await createRepo(
      'github',
      names,
      'https://github.com/perf-fixture/skills.git'
    );
    const fixturePath = join(root, 'tree.json');
    const preloadPath = join(root, 'offline-fetch.mjs');
    await writeFile(
      preloadPath,
      `import { readFileSync } from 'node:fs';
      globalThis.fetch = async (input) => {
        const url = new URL(typeof input === 'string' ? input : input.url);
        if (url.hostname !== 'api.github.com') throw new Error('Unexpected fixture request');
        if (url.pathname === '/repos/perf-fixture/skills') return Response.json({ private: false });
        if (url.pathname.startsWith('/repos/perf-fixture/skills/git/trees/')) {
          return Response.json(JSON.parse(readFileSync(process.env.SKILLS_TEST_TREE, 'utf8')));
        }
        throw new Error('Unexpected fixture request');
      };`
    );
    env.NODE_OPTIONS = `--import=${pathToFileURL(preloadPath).href}`;
    env.SKILLS_TEST_TREE = fixturePath;
    const writeTree = async () => {
      const tree = git(['ls-tree', '-r', '-t', 'HEAD'], repo)
        .trim()
        .split('\n')
        .map((line) => {
          const [metadata, path] = line.split('\t');
          const [, type, sha] = metadata!.split(' ');
          return { type, sha, path };
        });
      await writeFile(
        fixturePath,
        JSON.stringify({ sha: git(['rev-parse', 'HEAD^{tree}'], repo).trim(), tree })
      );
    };
    await writeTree();
    runCli(['add', source, '--skill', ...names, '--full-depth', '-g', '-y']);
    await writeSkills(repo, names, 2);
    const decoy = join(repo, 'skills', 'decoy');
    await mkdir(decoy);
    await writeFile(
      join(decoy, 'SKILL.md'),
      '---\nname: cache-a\ndescription: Duplicate name fixture\n---\nWrong folder\n'
    );
    commit(repo);
    await writeTree();
    await writeFile(trace, '');

    expect(runCli(['update', '-g', '-y'])).toContain('Updated 2 skill(s)');

    await assertInstalled(names);
    const lock = JSON.parse(await readFile(join(home, '.agents/.skill-lock.json'), 'utf8'));
    for (const name of names) {
      expect(lock.skills[name].skillPath).toBe(`skills/${name}/SKILL.md`);
      expect(lock.skills[name].sourceType).toBe('github');
      expect(lock.skills[name].sourceUrl).toBe(source);
    }
    // The GitHub check uses the fixture tree; both path-targeted add children share one clone.
    expect(await cloneCount()).toBe(1);
  }, 20_000);

  it('does not share a checkout between two refs of the same repository', async () => {
    const mainNames = ['cache-a', 'cache-b'];
    const alternateNames = ['cache-c', 'cache-d'];
    const { repo, source } = await createRepo('one', [...mainNames, ...alternateNames]);
    git(['branch', 'alternate'], repo);
    runCli(['add', `${source}#main`, '--skill', ...mainNames, '--full-depth', '-g', '-y']);
    runCli([
      'add',
      `${source}#alternate`,
      '--skill',
      ...alternateNames,
      '--full-depth',
      '-g',
      '-y',
    ]);
    await writeSkills(repo, mainNames, 2);
    commit(repo);
    git(['checkout', 'alternate'], repo);
    await writeSkills(repo, alternateNames, 2);
    commit(repo);
    await writeFile(trace, '');

    expect(runCli(['update', '-g', '-y'])).toContain('Updated 4 skill(s)');

    await assertInstalled([...mainNames, ...alternateNames]);
    const lock = JSON.parse(await readFile(join(home, '.agents/.skill-lock.json'), 'utf8'));
    for (const name of mainNames) expect(lock.skills[name].ref).toBe('main');
    for (const name of alternateNames) expect(lock.skills[name].ref).toBe('alternate');
    // Each ref requires its own update-check clone and installation clone.
    expect(await cloneCount()).toBe(4);
  }, 20_000);

  it('isolates repositories and does not persist the cache between updates', async () => {
    const allNames: string[] = [];
    for (const [id, names] of [
      ['one', ['cache-a', 'cache-b']],
      ['two', ['cache-c', 'cache-d']],
    ] as const) {
      const { repo, source } = await createRepo(id, [...names]);
      runCli(['add', source, '--skill', ...names, '--full-depth', '-g', '-y']);
      await writeSkills(repo, [...names], 2);
      commit(repo);
      allNames.push(...names);
    }
    const lockPath = join(home, '.agents/.skill-lock.json');
    const oldLock = await readFile(lockPath, 'utf8');

    for (let run = 0; run < 2; run++) {
      await writeFile(lockPath, oldLock);
      await writeFile(trace, '');
      expect(runCli(['update', '-g', '-y'])).toContain('Updated 4 skill(s)');
      await assertInstalled(allNames);
      // Two source checks plus one installation clone for each repository.
      expect(await cloneCount()).toBe(4);
      expect(
        (await readdir(temp)).filter((name) => name.startsWith('skills-update-clones-'))
      ).toEqual([]);
    }
  }, 20_000);
});
