/**
 * Tests for cloneRepoSparse: cloning only the requested subpath of a
 * repository via --depth 1 --filter=blob:none --sparse + sparse-checkout set.
 *
 * All tests run against file:// fixture repositories created in temp dirs —
 * zero network, no mocking of git.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { platform, tmpdir } from 'os';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { cloneRepoSparse, cleanupTempDir } from '../src/git.ts';
import { discoverSkills } from '../src/skills.ts';
import { runCli } from '../src/test-utils.ts';

const isWindows = platform() === 'win32';

const SLASH_BRANCH = 'bugfix/ABC-123-some-fix';

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'pipe' });
}

function commitAll(cwd: string, message: string): void {
  git(cwd, 'add', '.');
  git(cwd, '-c', 'user.email=test@example.com', '-c', 'user.name=test', 'commit', '-m', message);
}

function writeSkill(repoDir: string, skillPath: string, name: string): void {
  const dir = join(repoDir, skillPath);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: Test skill ${name}\n---\n\n# ${name}\n`
  );
}

describe('cloneRepoSparse', () => {
  let fixtureDir: string;
  let fixtureUrl: string;
  const clonedDirs: string[] = [];

  beforeAll(() => {
    fixtureDir = mkdtempSync(join(tmpdir(), 'skills-sparse-fixture-'));
    fixtureUrl = pathToFileURL(fixtureDir).href;

    // Monorepo layout: skills nested under libs/skills, with sibling
    // top-level dirs that a sparse checkout must NOT materialize.
    git(fixtureDir, 'init', '-b', 'main');
    writeFileSync(join(fixtureDir, 'README.md'), '# monorepo\n');
    mkdirSync(join(fixtureDir, 'apps', 'web'), { recursive: true });
    writeFileSync(join(fixtureDir, 'apps', 'web', 'app.txt'), 'web app\n');
    writeSkill(fixtureDir, 'libs/skills/base-skill', 'base-skill');
    commitAll(fixtureDir, 'init');

    // A branch whose name contains slashes, carrying an extra skill.
    git(fixtureDir, 'checkout', '-b', SLASH_BRANCH);
    writeSkill(fixtureDir, 'libs/skills/branch-skill', 'branch-skill');
    commitAll(fixtureDir, 'add branch skill');
    git(fixtureDir, 'checkout', 'main');
  });

  afterAll(() => {
    rmSync(fixtureDir, { recursive: true, force: true });
  });

  afterEach(async () => {
    for (const dir of clonedDirs.splice(0)) {
      await cleanupTempDir(dir).catch(() => {});
    }
  });

  it('clones only the subpath (sibling top-level dirs are absent)', async () => {
    const dir = await cloneRepoSparse(fixtureUrl, undefined, 'libs/skills');
    clonedDirs.push(dir);

    expect(existsSync(join(dir, 'libs', 'skills', 'base-skill', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(dir, 'apps'))).toBe(false);
  });

  it('combines a slash-branch ref with a subpath', async () => {
    const dir = await cloneRepoSparse(fixtureUrl, SLASH_BRANCH, 'libs/skills');
    clonedDirs.push(dir);

    expect(existsSync(join(dir, 'libs', 'skills', 'branch-skill', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(dir, 'apps'))).toBe(false);
  });

  it.skipIf(isWindows)(
    'falls back to a full shallow clone when git does not support sparse checkout',
    async () => {
      // Simulate an old git: a PATH shim that rejects sparse options and
      // delegates everything else to the real binary.
      const realGit = execFileSync('which', ['git']).toString().trim();
      const shimDir = mkdtempSync(join(tmpdir(), 'skills-git-shim-'));
      const shimPath = join(shimDir, 'git');
      writeFileSync(
        shimPath,
        `#!/bin/sh\n` +
          `for arg in "$@"; do\n` +
          `  case "$arg" in\n` +
          `    --sparse|sparse-checkout) echo "error: unknown option" >&2; exit 129 ;;\n` +
          `  esac\n` +
          `done\n` +
          `exec "${realGit}" "$@"\n`
      );
      chmodSync(shimPath, 0o755);

      const originalPath = process.env.PATH;
      process.env.PATH = `${shimDir}:${originalPath}`;
      try {
        const dir = await cloneRepoSparse(fixtureUrl, SLASH_BRANCH, 'libs/skills');
        clonedDirs.push(dir);

        // The fallback is a full shallow clone: everything is present.
        expect(existsSync(join(dir, 'libs', 'skills', 'branch-skill', 'SKILL.md'))).toBe(true);
        expect(existsSync(join(dir, 'apps', 'web', 'app.txt'))).toBe(true);
      } finally {
        process.env.PATH = originalPath;
        rmSync(shimDir, { recursive: true, force: true });
      }
    }
  );

  it('discovers skills in a sparse clone exactly like in a full clone', async () => {
    const dir = await cloneRepoSparse(fixtureUrl, SLASH_BRANCH, 'libs/skills');
    clonedDirs.push(dir);

    const skills = await discoverSkills(dir, 'libs/skills');
    const names = skills.map((skill) => skill.name);
    expect(names).toContain('branch-skill');
    expect(names).toContain('base-skill');
  });
});

describe('add command e2e with a slash-branch monorepo', () => {
  let fixtureDir: string;
  let fixtureUrl: string;
  let projectDir: string;
  let claudeConfigDir: string;

  beforeAll(() => {
    fixtureDir = mkdtempSync(join(tmpdir(), 'skills-add-e2e-fixture-'));
    fixtureUrl = pathToFileURL(fixtureDir).href;
    projectDir = mkdtempSync(join(tmpdir(), 'skills-add-e2e-project-'));
    claudeConfigDir = mkdtempSync(join(tmpdir(), 'skills-add-e2e-claude-'));

    // The default branch itself contains slashes, plus a nested skills dir.
    git(fixtureDir, 'init', '-b', SLASH_BRANCH);
    mkdirSync(join(fixtureDir, 'apps'), { recursive: true });
    writeFileSync(join(fixtureDir, 'apps', 'app.txt'), 'app\n');
    writeSkill(fixtureDir, 'libs/skills/monorepo-skill', 'monorepo-skill');
    commitAll(fixtureDir, 'init');
  });

  afterAll(() => {
    rmSync(fixtureDir, { recursive: true, force: true });
    rmSync(projectDir, { recursive: true, force: true });
    rmSync(claudeConfigDir, { recursive: true, force: true });
  });

  it('installs a nested skill from a file:// monorepo on a slash-named branch', () => {
    const result = runCli(
      ['add', fixtureUrl, '-y', '-g', '--agent', 'claude-code'],
      projectDir,
      {
        CLAUDE_CONFIG_DIR: claudeConfigDir,
        DISABLE_TELEMETRY: '1',
      },
      60000
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('monorepo-skill');
    expect(result.stdout).toContain('Done!');
    expect(existsSync(join(claudeConfigDir, 'skills', 'monorepo-skill', 'SKILL.md'))).toBe(true);
  }, 90000);
});
