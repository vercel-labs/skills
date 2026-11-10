import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { runCli } from '../src/test-utils.ts';
import { PERSONAL_LOCK_FILE, readMergedLocalLock } from '../src/local-lock.ts';
import { withWarnings } from '../src/warnings.ts';

describe('skills-lock.local.json', () => {
  let testDir: string;

  function writeSkill(dir: string, name: string): void {
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'SKILL.md'),
      `---\nname: ${name}\ndescription: ${name}\n---\n# ${name}\n`
    );
  }

  function writeLock(file: string, skills: Record<string, string>): void {
    writeFileSync(
      join(testDir, file),
      JSON.stringify({
        version: 2,
        skills: Object.fromEntries(
          Object.entries(skills).map(([name, source]) => [
            name,
            { source, sourceType: 'local', computedHash: 'x' },
          ])
        ),
      })
    );
  }

  const readLock = (file: string) => JSON.parse(readFileSync(join(testDir, file), 'utf-8'));
  const installed = (name: string) =>
    existsSync(join(testDir, '.agents', 'skills', name, 'SKILL.md'));

  beforeEach(() => {
    testDir = join(
      tmpdir(),
      `skills-personal-lock-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe('readMergedLocalLock', () => {
    it('merges the personal lock over the shared one', async () => {
      writeLock('skills-lock.json', { alpha: './shared', beta: './shared' });
      writeLock(PERSONAL_LOCK_FILE, { beta: './mine', gamma: './mine' });

      const { lock, personal } = await readMergedLocalLock(testDir);

      expect(Object.keys(lock.skills).sort()).toEqual(['alpha', 'beta', 'gamma']);
      expect(lock.skills.alpha!.source).toBe(join(testDir, 'shared'));
      expect(lock.skills.beta!.source).toBe(join(testDir, 'mine'));
      expect([...personal].sort()).toEqual(['beta', 'gamma']);
    });

    it('works with only one of the files present', async () => {
      writeLock(PERSONAL_LOCK_FILE, { gamma: './mine' });

      const { lock, personal } = await readMergedLocalLock(testDir);

      expect(Object.keys(lock.skills)).toEqual(['gamma']);
      expect(personal.has('gamma')).toBe(true);
    });

    it('warns about an unusable personal lock and leaves it out', async () => {
      writeLock('skills-lock.json', { alpha: './shared' });
      writeFileSync(join(testDir, PERSONAL_LOCK_FILE), '<<<<<<< HEAD');
      const warnings: string[] = [];

      const { lock, personal } = await withWarnings(
        (warning) => warnings.push(warning.code),
        () => readMergedLocalLock(testDir)
      );

      expect(Object.keys(lock.skills)).toEqual(['alpha']);
      expect(personal.size).toBe(0);
      expect(warnings).toEqual(['SKILLS_LOCAL_LOCK_IGNORED']);
    });

    it('reports an unusable personal lock only once per run', async () => {
      writeFileSync(join(testDir, PERSONAL_LOCK_FILE), '<<<<<<< HEAD');
      const warnings: string[] = [];

      await withWarnings(
        (warning) => warnings.push(warning.code),
        async () => {
          await readMergedLocalLock(testDir);
          await readMergedLocalLock(testDir);
        }
      );

      expect(warnings).toEqual(['SKILLS_LOCAL_LOCK_IGNORED']);
    });

    it('still rejects an unusable shared lock', async () => {
      writeFileSync(join(testDir, 'skills-lock.json'), '<<<<<<< HEAD');

      await expect(readMergedLocalLock(testDir)).rejects.toMatchObject({
        code: 'SKILLS_INVALID_LOCAL_LOCK',
      });
    });
  });

  describe('experimental_install', () => {
    it('restores skills from both locks and records each back into its own file', () => {
      writeSkill(join(testDir, 'src-a', 'alpha'), 'alpha');
      writeSkill(join(testDir, 'src-b', 'beta'), 'beta');
      writeLock('skills-lock.json', { alpha: './src-a' });
      writeLock(PERSONAL_LOCK_FILE, { beta: './src-b' });

      const result = runCli(['experimental_install'], testDir);

      expect(result.exitCode).toBe(0);
      expect(installed('alpha')).toBe(true);
      expect(installed('beta')).toBe(true);
      const shared = readLock('skills-lock.json');
      const personal = readLock(PERSONAL_LOCK_FILE);
      expect(Object.keys(shared.skills)).toEqual(['alpha']);
      expect(Object.keys(personal.skills)).toEqual(['beta']);
      expect(personal.skills.beta.computedHash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('migrates a version 1 personal lock in its own file', () => {
      writeSkill(join(testDir, 'src-b', 'beta'), 'beta');
      writeFileSync(
        join(testDir, PERSONAL_LOCK_FILE),
        JSON.stringify({
          version: 1,
          skills: { beta: { source: './src-b', sourceType: 'local', computedHash: 'x' } },
        })
      );

      const result = runCli(['experimental_install'], testDir);

      expect(result.exitCode).toBe(0);
      expect(installed('beta')).toBe(true);
      const personal = readLock(PERSONAL_LOCK_FILE);
      expect(personal.version).toBe(2);
      expect(personal.skills.beta.computedHash).toMatch(/^[a-f0-9]{64}$/);
      expect(existsSync(join(testDir, 'skills-lock.json'))).toBe(false);
    });

    it('skips node_modules entries in the personal lock', () => {
      writeFileSync(
        join(testDir, PERSONAL_LOCK_FILE),
        JSON.stringify({
          version: 2,
          skills: { pkg: { source: 'some-pkg', sourceType: 'node_modules', computedHash: 'x' } },
        })
      );

      const result = runCli(['experimental_install'], testDir);

      expect(result.stdout).toContain('Skipped pkg');
      expect(existsSync(join(testDir, 'skills-lock.json'))).toBe(false);
    });

    it('prunes a stale shared node_modules entry but keeps the personal override', () => {
      writeSkill(join(testDir, 'src-mine', 'foo'), 'foo');
      const fromPackage = (source: string) => ({
        source,
        sourceType: 'node_modules',
        computedHash: 'x',
      });
      writeFileSync(
        join(testDir, 'skills-lock.json'),
        JSON.stringify({
          version: 2,
          skills: { foo: fromPackage('foo-pkg'), bar: fromPackage('bar-pkg') },
        })
      );
      writeLock(PERSONAL_LOCK_FILE, { foo: './src-mine' });

      runCli(['experimental_install'], testDir);

      expect(installed('foo')).toBe(true);
      expect(readLock('skills-lock.json').skills.foo).toBeUndefined();
      expect(readLock(PERSONAL_LOCK_FILE).skills.foo.source).toBe('./src-mine');
    });

    it('names skills-lock.local.json when a personal skill fails --frozen-lockfile', () => {
      writeSkill(join(testDir, 'src-b', 'beta'), 'beta');
      writeLock(PERSONAL_LOCK_FILE, { beta: './src-b' });

      const result = runCli(['experimental_install', '--frozen-lockfile'], testDir);

      expect(result.exitCode).toBe(1);
      expect(result.stdout).toContain(`because ${PERSONAL_LOCK_FILE} is not up to date`);
      expect(result.stdout).toContain(`beta has changed since ${PERSONAL_LOCK_FILE} was written`);
    });

    it('restores from the personal lock alone', () => {
      writeSkill(join(testDir, 'src-b', 'beta'), 'beta');
      writeLock(PERSONAL_LOCK_FILE, { beta: './src-b' });

      const result = runCli(['experimental_install'], testDir);

      expect(result.exitCode).toBe(0);
      expect(installed('beta')).toBe(true);
      expect(existsSync(join(testDir, 'skills-lock.json'))).toBe(false);
    });

    it('prefers the personal entry when both locks name the same skill', () => {
      writeSkill(join(testDir, 'src-a', 'alpha'), 'alpha');
      mkdirSync(join(testDir, 'src-mine', 'alpha'), { recursive: true });
      writeFileSync(
        join(testDir, 'src-mine', 'alpha', 'SKILL.md'),
        '---\nname: alpha\ndescription: mine\n---\n# mine\n'
      );
      writeLock('skills-lock.json', { alpha: './src-a' });
      writeLock(PERSONAL_LOCK_FILE, { alpha: './src-mine' });
      const sharedBefore = readFileSync(join(testDir, 'skills-lock.json'), 'utf-8');

      const result = runCli(['experimental_install'], testDir);

      expect(result.exitCode).toBe(0);
      expect(
        readFileSync(join(testDir, '.agents', 'skills', 'alpha', 'SKILL.md'), 'utf-8')
      ).toContain('# mine');
      expect(readFileSync(join(testDir, 'skills-lock.json'), 'utf-8')).toBe(sharedBefore);
    });
  });

  describe('add --local', () => {
    beforeEach(() => {
      writeSkill(join(testDir, 'src', 'alpha'), 'alpha');
    });

    it('records the install in skills-lock.local.json only', () => {
      const result = runCli(['add', './src', '-a', 'universal', '-y', '--local'], testDir);

      expect(result.exitCode).toBe(0);
      expect(installed('alpha')).toBe(true);
      expect(existsSync(join(testDir, 'skills-lock.json'))).toBe(false);
      expect(readLock(PERSONAL_LOCK_FILE).skills.alpha.source).toBe('./src');
    });

    it('cannot be combined with --global', () => {
      const result = runCli(['add', './src', '-a', 'universal', '-y', '--local', '-g'], testDir);

      expect(result.exitCode).toBe(1);
      expect(result.stdout + result.stderr).toContain('Cannot combine --local with --global');
      expect(installed('alpha')).toBe(false);
    });
  });

  it('check reports a personal skill whose installed files differ from its lock entry', () => {
    writeSkill(join(testDir, 'src', 'alpha'), 'alpha');
    expect(runCli(['add', './src', '-a', 'universal', '-y', '--local'], testDir).exitCode).toBe(0);
    const skillMd = join(testDir, '.agents', 'skills', 'alpha', 'SKILL.md');
    writeFileSync(skillMd, readFileSync(skillMd, 'utf-8') + 'edited\n');

    const result = runCli(['check'], testDir);

    expect(result.stdout).toContain('alpha has local changes');
    expect(result.exitCode).toBe(1);
  });

  it('a plain add moves a personal skill into skills-lock.json', () => {
    writeSkill(join(testDir, 'src', 'alpha'), 'alpha');
    expect(runCli(['add', './src', '-a', 'universal', '-y', '--local'], testDir).exitCode).toBe(0);

    expect(runCli(['add', './src', '-a', 'universal', '-y'], testDir).exitCode).toBe(0);

    expect(readLock('skills-lock.json').skills.alpha.source).toBe('./src');
    expect(readLock(PERSONAL_LOCK_FILE).skills).toEqual({});
  });

  it('remove of a personal override keeps the team entry in skills-lock.json', () => {
    writeSkill(join(testDir, 'src', 'alpha'), 'alpha');
    writeLock('skills-lock.json', { alpha: './src' });
    writeLock(PERSONAL_LOCK_FILE, { alpha: './src' });
    expect(runCli(['experimental_install'], testDir).exitCode).toBe(0);

    const result = runCli(['remove', 'alpha', '-y'], testDir);

    expect(result.exitCode).toBe(0);
    expect(readLock(PERSONAL_LOCK_FILE).skills).toEqual({});
    expect(readLock('skills-lock.json').skills.alpha.source).toBe('./src');
    expect(result.stdout + result.stderr).toContain(
      "skills-lock.json still lists the team's alpha"
    );
  });

  describe('with an unusable personal lock', () => {
    beforeEach(() => {
      writeSkill(join(testDir, 'src', 'alpha'), 'alpha');
      expect(runCli(['add', './src', '-a', 'universal', '-y'], testDir).exitCode).toBe(0);
      writeFileSync(join(testDir, PERSONAL_LOCK_FILE), '<<<<<<< HEAD');
    });

    it('still removes a shared skill, with a warning', () => {
      const result = runCli(['remove', 'alpha', '-y'], testDir);

      expect(result.exitCode).toBe(0);
      expect((result.stdout + result.stderr).split('its skills are left out').length - 1).toBe(1);
      expect(installed('alpha')).toBe(false);
      expect(readLock('skills-lock.json').skills).toEqual({});
    });

    it('refuses add --local', () => {
      const result = runCli(['add', './src', '-a', 'universal', '-y', '--local'], testDir);

      expect(result.exitCode).toBe(1);
      expect(result.stdout + result.stderr).toContain('SKILLS_INVALID_LOCAL_LOCK');
    });
  });

  it('remove drops a personal skill from skills-lock.local.json', () => {
    writeSkill(join(testDir, 'src', 'alpha'), 'alpha');
    expect(runCli(['add', './src', '-a', 'universal', '-y', '--local'], testDir).exitCode).toBe(0);

    const result = runCli(['remove', 'alpha', '-y'], testDir);

    expect(result.exitCode).toBe(0);
    expect(installed('alpha')).toBe(false);
    expect(readLock(PERSONAL_LOCK_FILE).skills).toEqual({});
  });
});
