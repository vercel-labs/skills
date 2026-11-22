import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { runCli } from '../src/test-utils.ts';
import { computeLegacySkillFolderHash, computeSkillFolderHash } from '../src/local-lock.ts';

describe('experimental_install', () => {
  let testDir: string;

  function writeSkill(dir: string, name: string): void {
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'SKILL.md'),
      `---\nname: ${name}\ndescription: ${name}\n---\n# ${name}\n`
    );
  }

  function writeLock(skills: Record<string, string>, hashOf?: (source: string) => string): void {
    writeFileSync(
      join(testDir, 'skills-lock.json'),
      JSON.stringify({
        version: 2,
        skills: Object.fromEntries(
          Object.entries(skills).map(([name, source]) => [
            name,
            { source, sourceType: 'local', computedHash: hashOf?.(source) ?? 'x' },
          ])
        ),
      })
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

  function writeV1Lock(computedHash: string): void {
    writeFileSync(
      join(testDir, 'skills-lock.json'),
      JSON.stringify({
        version: 1,
        skills: { alpha: { source: './src-a', sourceType: 'local', computedHash } },
      })
    );
  }

  it('upgrades a v1 lock in place, keeping installed skills that match it', async () => {
    writeSkill(join(testDir, 'src-a', 'alpha'), 'alpha');
    writeSkill(join(testDir, '.agents', 'skills', 'alpha'), 'alpha');
    writeV1Lock(await computeLegacySkillFolderHash(join(testDir, '.agents', 'skills', 'alpha')));

    const result = runCli(['experimental_install'], testDir);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('1 skill already installed');
    const lock = JSON.parse(readFileSync(join(testDir, 'skills-lock.json'), 'utf-8'));
    expect(lock.version).toBe(2);
    expect(lock.skills.alpha.computedHash).toBe(
      await computeSkillFolderHash(join(testDir, '.agents', 'skills', 'alpha'))
    );
  });

  it('restores an installed skill that no longer matches its v1 hash', () => {
    writeSkill(join(testDir, 'src-a', 'alpha'), 'alpha');
    mkdirSync(join(testDir, '.agents', 'skills', 'alpha'), { recursive: true });
    writeFileSync(join(testDir, '.agents', 'skills', 'alpha', 'SKILL.md'), 'edited');
    writeV1Lock('v1');

    const result = runCli(['experimental_install'], testDir);

    expect(result.exitCode).toBe(0);
    expect(
      readFileSync(join(testDir, '.agents', 'skills', 'alpha', 'SKILL.md'), 'utf-8')
    ).toContain('name: alpha');
  });

  it('restores every source in the lock', () => {
    writeSkill(join(testDir, 'src-a', 'alpha'), 'alpha');
    writeSkill(join(testDir, 'src-b', 'beta'), 'beta');
    writeLock({ alpha: './src-a', beta: './src-b' });

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

  it('keeps restoring after a source fails, leaving its lock entry as it was', () => {
    writeSkill(join(testDir, 'src-b', 'beta'), 'beta');
    writeLock({ alpha: './missing', beta: './src-b' });
    const before = JSON.parse(readFileSync(join(testDir, 'skills-lock.json'), 'utf-8'));

    const result = runCli(['experimental_install'], testDir);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toMatch(/Failed to restore alpha from \S*missing/);
    expect(result.stdout).toContain('Restored 1 skill; failed to restore 1 skill');
    expect(installed('beta')).toBe(true);
    const lock = JSON.parse(readFileSync(join(testDir, 'skills-lock.json'), 'utf-8'));
    expect(lock.skills.alpha).toEqual(before.skills.alpha);
  });

  it('fails an entry whose skill is no longer in its source', () => {
    writeSkill(join(testDir, 'src-a', 'alpha'), 'alpha');
    writeLock({ alpha: './src-a', renamed: './src-a' });
    const before = JSON.parse(readFileSync(join(testDir, 'skills-lock.json'), 'utf-8'));

    const result = runCli(['experimental_install'], testDir);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toMatch(/renamed not found in \S*src-a/);
    expect(result.stdout).toContain('failed to restore 1 skill from skills-lock.json: renamed');
    expect(installed('alpha')).toBe(true);
    const lock = JSON.parse(readFileSync(join(testDir, 'skills-lock.json'), 'utf-8'));
    expect(lock.skills.renamed).toEqual(before.skills.renamed);
  });

  describe('already installed skills', () => {
    const installedContent = () =>
      readFileSync(join(testDir, '.agents', 'skills', 'alpha', 'SKILL.md'), 'utf-8');

    beforeEach(async () => {
      await writeMatchingLock();
      expect(runCli(['experimental_install'], testDir).exitCode).toBe(0);
    });

    it('are left as they are when they match the lock', () => {
      const result = runCli(['experimental_install'], testDir);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('1 skill already installed');
    });

    it('are restored when their files differ from the lock', () => {
      writeFileSync(join(testDir, '.agents', 'skills', 'alpha', 'SKILL.md'), 'edited');

      const result = runCli(['experimental_install'], testDir);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('alpha does not match skills-lock.json');
      expect(installedContent()).toContain('name: alpha');
    });

    it('are only reported as modified with --dry-run', () => {
      writeFileSync(join(testDir, '.agents', 'skills', 'alpha', 'SKILL.md'), 'edited');

      const result = runCli(['experimental_install', '--dry-run'], testDir);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('would restore the locked version');
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
      expect(result.stdout).not.toContain('already installed');
      expect(installedContent()).toContain('name: alpha');
    });
  });

  describe('agent links', () => {
    let home: string;
    const linkOf = (dir: string) => lstatSync(join(testDir, dir, 'skills', 'alpha'));
    const restore = (args: string[] = []) =>
      runCli(['experimental_install', ...args], testDir, { HOME: home });

    function writeLastSelectedAgents(agentList: string[]): void {
      const dir = join(home, '.local', 'state', 'skills');
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, '.skill-lock.json'),
        JSON.stringify({ version: 3, skills: {}, lastSelectedAgents: agentList })
      );
    }

    beforeEach(() => {
      home = join(testDir, 'home');
      mkdirSync(home, { recursive: true });
      writeSkill(join(testDir, 'src-a', 'alpha'), 'alpha');
      writeLock({ alpha: './src-a' });
    });

    it('fill only .agents/skills when no agent is selected or detected', () => {
      const result = restore();

      expect(result.exitCode).toBe(0);
      expect(installed('alpha')).toBe(true);
      expect(existsSync(join(testDir, '.claude'))).toBe(false);
    });

    it('go to the agents detected on the machine', () => {
      mkdirSync(join(home, '.claude'));

      expect(restore().exitCode).toBe(0);
      expect(linkOf('.claude').isSymbolicLink()).toBe(true);
    });

    it('prefer the agents last selected with skills add', () => {
      mkdirSync(join(home, '.claude'));
      writeLastSelectedAgents(['windsurf', 'not-an-agent']);

      expect(restore().exitCode).toBe(0);
      expect(linkOf('.windsurf').isSymbolicLink()).toBe(true);
      expect(existsSync(join(testDir, '.claude'))).toBe(false);
    });

    it('prefer --agent over everything else', () => {
      writeLastSelectedAgents(['windsurf']);

      expect(restore(['--agent', 'claude-code']).exitCode).toBe(0);
      expect(linkOf('.claude').isSymbolicLink()).toBe(true);
      expect(existsSync(join(testDir, '.windsurf'))).toBe(false);
      expect(installed('alpha')).toBe(true);
    });

    it('reject an unknown --agent', () => {
      const result = restore(['--agent', 'not-an-agent']);

      expect(result.exitCode).toBe(1);
      expect(result.stdout).toContain('Invalid agents: not-an-agent');
      expect(installed('alpha')).toBe(false);
    });

    it('are copies when the lock entry was installed with --copy', () => {
      const lock = JSON.parse(readFileSync(join(testDir, 'skills-lock.json'), 'utf-8'));
      lock.skills.alpha.installMode = 'copy';
      writeFileSync(join(testDir, 'skills-lock.json'), JSON.stringify(lock));

      expect(restore(['--agent', 'claude-code']).exitCode).toBe(0);
      expect(linkOf('.claude').isDirectory()).toBe(true);
      expect(linkOf('.agents').isDirectory()).toBe(true);
      const after = JSON.parse(readFileSync(join(testDir, 'skills-lock.json'), 'utf-8'));
      expect(after.skills.alpha.installMode).toBe('copy');
    });

    it('are added to skills that are already installed', () => {
      expect(restore().exitCode).toBe(0);

      const result = restore(['--agent', 'claude-code']);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('1 skill already installed');
      expect(linkOf('.claude').isSymbolicLink()).toBe(true);
    });

    it('are only planned with --dry-run', () => {
      const result = restore(['--agent', 'claude-code', '--dry-run']);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Would link to Claude Code');
      expect(existsSync(join(testDir, '.claude'))).toBe(false);
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

    it('fails for an entry migrated from a v1 lock without its skill installed', () => {
      writeSkill(join(testDir, 'src-a', 'alpha'), 'alpha');
      writeFileSync(
        join(testDir, 'skills-lock.json'),
        JSON.stringify({
          version: 1,
          skills: { alpha: { source: './src-a', sourceType: 'local', computedHash: 'v1' } },
        })
      );
      const before = lockFile();

      const result = runCli(['experimental_install', '--frozen-lockfile'], testDir);

      expect(result.exitCode).toBe(1);
      expect(result.stdout).toContain('alpha has no content hash');
      expect(installed('alpha')).toBe(false);
      expect(lockFile()).toBe(before);
    });

    it('restores over an installed skill that differs from the lock', async () => {
      await writeMatchingLock();
      expect(runCli(['experimental_install'], testDir).exitCode).toBe(0);
      const before = lockFile();
      writeFileSync(join(testDir, '.agents', 'skills', 'alpha', 'SKILL.md'), 'edited');

      const result = runCli(['experimental_install', '--frozen-lockfile'], testDir);

      expect(result.exitCode).toBe(0);
      expect(
        readFileSync(join(testDir, '.agents', 'skills', 'alpha', 'SKILL.md'), 'utf-8')
      ).toContain('name: alpha');
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
