import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { runCli } from '../src/test-utils.ts';
import type { LocalSkillLockEntry } from '../src/local-lock.ts';
import { computeSkillFolderHash } from '../src/local-lock.ts';

describe('experimental_install', () => {
  let testDir: string;

  function writeSkill(dir: string, name: string, extra?: string): void {
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'SKILL.md'),
      `---\nname: ${name}\ndescription: ${name}\n---\n# ${name}\n`
    );
    if (extra) writeFileSync(join(dir, extra), 'extra\n');
  }

  /** A bare string is a local source; `hashOf` supplies its recorded content hash. */
  function writeLock(
    skills: Record<string, LocalSkillLockEntry | string>,
    hashOf?: (source: string) => string
  ): void {
    writeFileSync(
      join(testDir, 'skills-lock.json'),
      JSON.stringify(
        {
          version: 1,
          skills: Object.fromEntries(
            Object.entries(skills).map(([name, entry]) => [
              name,
              typeof entry === 'string'
                ? { ...localEntry(entry), computedHash: hashOf?.(entry) ?? 'x' }
                : entry,
            ])
          ),
        },
        null,
        2
      )
    );
  }

  function localEntry(source: string, skillPath?: string): LocalSkillLockEntry {
    return { source, sourceType: 'local', computedHash: 'x', ...(skillPath && { skillPath }) };
  }

  function gitEntry(source: string, skillPath: string): LocalSkillLockEntry {
    return { source, sourceType: 'git', skillPath, computedHash: 'x' };
  }

  /** A local git repository with one skills/<name> folder per name; returns its file:// URL. */
  function createGitRepo(root: string, skills: Array<{ name: string; folder?: string }>): string {
    mkdirSync(root, { recursive: true });
    git(root, ['init']);
    for (const skill of skills) {
      writeSkill(join(root, 'skills', skill.folder ?? skill.name), skill.name);
    }
    git(root, ['add', '.']);
    git(root, ['commit', '-m', 'fixture']);
    return `file://${root}`;
  }

  function git(cwd: string, args: string[]): void {
    execFileSync(
      'git',
      ['-c', 'user.name=skills-test', '-c', 'user.email=test@example.com', ...args],
      { cwd, stdio: 'ignore' }
    );
  }

  /** Lock pointing at `./src-a/alpha` with its real content hash. */
  async function writeMatchingLock(): Promise<string> {
    writeSkill(join(testDir, 'src-a', 'alpha'), 'alpha');
    const hash = await computeSkillFolderHash(join(testDir, 'src-a', 'alpha'));
    writeLock({ alpha: './src-a' }, () => hash);
    return readFileSync(join(testDir, 'skills-lock.json'), 'utf-8');
  }

  const installed = (name: string) =>
    existsSync(join(testDir, '.agents', 'skills', name, 'SKILL.md'));

  beforeEach(() => {
    testDir = join(
      tmpdir(),
      `skills-install-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('restores every source in the lock', () => {
    writeSkill(join(testDir, 'src-a', 'alpha'), 'alpha');
    writeSkill(join(testDir, 'src-b', 'beta'), 'beta');
    writeLock({ alpha: localEntry('./src-a'), beta: localEntry('./src-b') });

    const result = runCli(['experimental_install'], testDir);

    expect(result.exitCode).toBe(0);
    expect(installed('alpha')).toBe(true);
    expect(installed('beta')).toBe(true);
    const lock = JSON.parse(readFileSync(join(testDir, 'skills-lock.json'), 'utf-8'));
    expect(lock.skills.alpha.computedHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('prints the plan and writes nothing with --dry-run', () => {
    writeSkill(join(testDir, 'src-a', 'alpha'), 'alpha');
    writeLock({ alpha: './src-a' });
    const before = readFileSync(join(testDir, 'skills-lock.json'), 'utf-8');

    const result = runCli(['experimental_install', '--dry-run'], testDir);

    expect(result.exitCode).toBe(0);
    expect(installed('alpha')).toBe(false);
    expect(readFileSync(join(testDir, 'skills-lock.json'), 'utf-8')).toBe(before);
    expect(result.stdout).toContain('Would restore 1 skill');
    expect(result.stdout).toContain('alpha');
  });

  it('keeps restoring after a source fails', () => {
    writeSkill(join(testDir, 'src-b', 'beta'), 'beta');
    writeLock({ alpha: localEntry('./missing'), beta: localEntry('./src-b') });

    const result = runCli(['experimental_install'], testDir);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain('Failed to install from');
    expect(installed('beta')).toBe(true);
  });

  it('keeps restoring when a skill was deleted from its repository', () => {
    const repo = join(testDir, 'repo');
    const source = createGitRepo(repo, [{ name: 'alpha' }, { name: 'beta' }]);
    writeLock({
      alpha: gitEntry(source, 'skills/alpha/SKILL.md'),
      beta: gitEntry(source, 'skills/beta/SKILL.md'),
    });

    rmSync(join(repo, 'skills', 'beta'), { recursive: true, force: true });
    git(repo, ['add', '-A']);
    git(repo, ['commit', '-m', 'drop beta']);

    const result = runCli(['experimental_install'], testDir);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain('Missing upstream');
    expect(result.stdout).toContain('beta');
    expect(installed('alpha')).toBe(true);
    expect(installed('beta')).toBe(false);
  });

  it('does not warn about broken skills elsewhere in the same repository', () => {
    const repo = join(testDir, 'repo');
    const source = createGitRepo(repo, [{ name: 'alpha' }]);

    // An unrelated SKILL.md with invalid YAML. Restore knows the locked paths,
    // so it must not parse (or warn about) this one.
    mkdirSync(join(repo, 'skills', 'broken'), { recursive: true });
    writeFileSync(
      join(repo, 'skills', 'broken', 'SKILL.md'),
      '---\nname: broken\ndescription: Pass: everything\n---\n'
    );
    git(repo, ['add', '-A']);
    git(repo, ['commit', '-m', 'broken skill']);

    writeLock({ alpha: gitEntry(source, 'skills/alpha/SKILL.md') });

    const result = runCli(['experimental_install'], testDir);

    expect(result.exitCode).toBe(0);
    expect(result.stdout + result.stderr).not.toContain('YAML parse error');
    expect(installed('alpha')).toBe(true);
  });

  it('reinstalls a skill that moved and updates its locked path', () => {
    const repo = join(testDir, 'repo');
    const source = createGitRepo(repo, [{ name: 'alpha' }]);
    writeLock({ alpha: gitEntry(source, 'skills/alpha/SKILL.md') });

    execFileSync('git', ['mv', 'skills/alpha', 'skills/moved-alpha'], {
      cwd: repo,
      stdio: 'ignore',
    });
    git(repo, ['commit', '-m', 'move alpha']);

    const result = runCli(['experimental_install'], testDir);

    expect(result.exitCode).toBe(0);
    expect(installed('alpha')).toBe(true);
    const lock = JSON.parse(readFileSync(join(testDir, 'skills-lock.json'), 'utf-8'));
    expect(lock.skills.alpha.skillPath).toBe('skills/moved-alpha/SKILL.md');
  });

  it('still cleans removed files from the canonical copy on reinstall', () => {
    writeSkill(join(testDir, 'src-a', 'alpha'), 'alpha', 'notes.md');
    writeLock({ alpha: localEntry('./src-a') });

    expect(runCli(['experimental_install'], testDir).exitCode).toBe(0);
    const installedNotes = join(testDir, '.agents', 'skills', 'alpha', 'notes.md');
    expect(existsSync(installedNotes)).toBe(true);

    rmSync(join(testDir, 'src-a', 'alpha', 'notes.md'));
    expect(runCli(['experimental_install', '--force'], testDir).exitCode).toBe(0);

    expect(existsSync(installedNotes)).toBe(false);
  });

  describe('already installed skills', () => {
    const installedContent = () =>
      readFileSync(join(testDir, '.agents', 'skills', 'alpha', 'SKILL.md'), 'utf-8');

    beforeEach(() => {
      writeSkill(join(testDir, 'src-a', 'alpha'), 'alpha');
      writeLock({ alpha: './src-a' });
      mkdirSync(join(testDir, '.agents', 'skills', 'alpha'), { recursive: true });
      writeFileSync(join(testDir, '.agents', 'skills', 'alpha', 'SKILL.md'), 'edited');
    });

    it('are left as they are', () => {
      const result = runCli(['experimental_install'], testDir);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('1 skill already installed');
      expect(installedContent()).toBe('edited');
    });

    it('are restored when the folder has no SKILL.md', () => {
      rmSync(join(testDir, '.agents', 'skills', 'alpha', 'SKILL.md'));

      expect(runCli(['experimental_install'], testDir).exitCode).toBe(0);
      expect(installedContent()).toContain('name: alpha');
    });

    it('are reinstalled with --force', () => {
      const result = runCli(['experimental_install', '--force'], testDir);

      expect(result.exitCode).toBe(0);
      expect(installedContent()).toContain('name: alpha');
    });
  });

  describe('--frozen-lockfile', () => {
    const lockFile = () => readFileSync(join(testDir, 'skills-lock.json'), 'utf-8');

    it('restores skills that match the lock without touching it', async () => {
      const before = await writeMatchingLock();

      const result = runCli(['experimental_install', '--frozen-lockfile'], testDir);

      expect(result.exitCode).toBe(0);
      expect(installed('alpha')).toBe(true);
      expect(lockFile()).toBe(before);
    });

    it('fails without installing when a skill differs from the lock', () => {
      writeSkill(join(testDir, 'src-a', 'alpha'), 'alpha');
      writeLock({ alpha: './src-a' });
      const before = lockFile();

      const result = runCli(['experimental_install', '--frozen-lockfile'], testDir);

      expect(result.exitCode).toBe(1);
      expect(result.stdout).toContain('skills-lock.json is not up to date');
      expect(result.stdout).toContain('alpha has changed');
      expect(installed('alpha')).toBe(false);
      expect(lockFile()).toBe(before);
    });

    it('fails when the lock is absent', () => {
      const result = runCli(['experimental_install', '--frozen-lockfile'], testDir);

      expect(result.exitCode).toBe(1);
      expect(result.stdout).toContain('skills-lock.json is absent');
    });

    it('is the default in CI and --no-frozen-lockfile turns it off', () => {
      writeSkill(join(testDir, 'src-a', 'alpha'), 'alpha');
      writeLock({ alpha: './src-a' });

      const frozen = runCli(['experimental_install'], testDir, { CI: 'true' });
      expect(frozen.exitCode).toBe(1);
      expect(installed('alpha')).toBe(false);

      const thawed = runCli(['experimental_install', '--no-frozen-lockfile'], testDir, {
        CI: 'true',
      });
      expect(thawed.exitCode).toBe(0);
      expect(installed('alpha')).toBe(true);
      expect(JSON.parse(lockFile()).skills.alpha.computedHash).toMatch(/^[a-f0-9]{64}$/);
    });
  });
});
