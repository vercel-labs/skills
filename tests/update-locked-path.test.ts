import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execFileSync } from 'child_process';
import { pathToFileURL } from 'url';
import { runCli } from '../src/test-utils.ts';
import { computeSkillFolderHash } from '../src/local-lock.ts';

const SKILL_MD = '---\nname: alpha\ndescription: alpha\n---\n# alpha\n';
// Six levels down, past where discovery walks, as getsentry/toolkit keeps sentry-cli.
const REAL_DIR = 'packages/cli/plugins/x/skills/alpha';
// The folder discovery does find: every entry links into REAL_DIR.
const ALIAS_DIR = 'packages/cli/.cursor/skills/alpha';

// A clone on Windows checks the links out as plain files, so there is no link folder to refuse.
const unixOnly = it.skipIf(process.platform === 'win32');

describe('a skill published as links to a deeper real folder', () => {
  let root: string;
  let project: string;
  let repo: string;
  let repoUrl: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'skills-locked-path-'));
    project = join(root, 'project');
    repo = join(root, 'repo');
    mkdirSync(join(repo, REAL_DIR, 'references'), { recursive: true });
    mkdirSync(join(repo, ALIAS_DIR), { recursive: true });
    writeFileSync(join(repo, REAL_DIR, 'SKILL.md'), SKILL_MD);
    writeFileSync(join(repo, REAL_DIR, 'references', 'a.md'), 'a\n');
    symlinkSync('../../../plugins/x/skills/alpha/SKILL.md', join(repo, ALIAS_DIR, 'SKILL.md'));
    symlinkSync('../../../plugins/x/skills/alpha/references', join(repo, ALIAS_DIR, 'references'));
    const git = (...args: string[]) =>
      execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
        cwd: repo,
        stdio: 'ignore',
      });
    git('init', '-q');
    git('add', '.');
    git('commit', '-q', '-m', 'skills');
    repoUrl = pathToFileURL(repo).href;
    mkdirSync(join(project, '.claude'), { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const installed = () => join(project, '.claude', 'skills', 'alpha');
  const lockPath = () => join(project, 'skills-lock.json');
  const lockedSkillPath = () =>
    JSON.parse(readFileSync(lockPath(), 'utf-8')).skills.alpha.skillPath as string;

  /** What `add` leaves behind when given the real folder's URL. */
  function installFromRealFolder(computedHash: string): void {
    mkdirSync(join(installed(), 'references'), { recursive: true });
    writeFileSync(join(installed(), 'SKILL.md'), SKILL_MD);
    writeFileSync(join(installed(), 'references', 'a.md'), 'a\n');
    const entry = {
      source: repoUrl,
      sourceUrl: repoUrl,
      sourceType: 'git',
      skillPath: `${REAL_DIR}/SKILL.md`,
      computedHash,
    };
    writeFileSync(lockPath(), JSON.stringify({ version: 1, skills: { alpha: entry } }));
  }

  unixOnly('add refuses the link folder instead of installing an empty skill', () => {
    const result = runCli(['add', repoUrl, '--skill', 'alpha', '-a', 'claude-code', '-y'], project);

    expect(result.exitCode).toBe(1);
    expect(result.stdout + result.stderr).toMatch(
      /SKILL\.md is a symlink to \S+ outside the skill directory/
    );
    expect(existsSync(installed())).toBe(false);
    expect(existsSync(lockPath())).toBe(false);
  });

  it('update leaves an unchanged skill at its locked real folder', async () => {
    installFromRealFolder(await computeSkillFolderHash(join(repo, REAL_DIR)));

    const result = runCli(['update', '-y'], project);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('All project skills are up to date');
    expect(lockedSkillPath()).toBe(`${REAL_DIR}/SKILL.md`);
    expect(readFileSync(join(installed(), 'references', 'a.md'), 'utf-8')).toBe('a\n');
  });

  it('update reinstalls a changed skill from its locked real folder', () => {
    installFromRealFolder('stale');

    const result = runCli(['update', '-y'], project);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Updated alpha');
    expect(lockedSkillPath()).toBe(`${REAL_DIR}/SKILL.md`);
    expect(readFileSync(join(installed(), 'SKILL.md'), 'utf-8')).toBe(SKILL_MD);
    expect(readFileSync(join(installed(), 'references', 'a.md'), 'utf-8')).toBe('a\n');
  });
});
