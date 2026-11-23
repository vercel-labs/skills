import { existsSync, realpathSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Sandbox, entries, isSymlink, readSkill, type JsonListEntry } from './sandbox.ts';

/**
 * Live GitHub repositories of different shapes. Skill sets drift as the repos
 * evolve, so assertions pin a few long-lived skills plus a minimum count rather
 * than exact lists.
 */
const REPOS = [
  {
    // Large: ~20 skills, binary assets, skills at `skills/<name>` and the root.
    source: 'anthropics/skills',
    minSkills: 15,
    known: ['pdf', 'frontend-design', 'skill-creator'],
    one: 'pdf',
    two: ['frontend-design', 'skill-creator'],
  },
  {
    // Many small skills nested one level deeper (`skills/<group>/<name>`).
    source: 'mattpocock/skills',
    minSkills: 20,
    known: ['tdd', 'grill-me', 'setup-pre-commit'],
    one: 'tdd',
    two: ['grill-me', 'setup-pre-commit'],
  },
  {
    // Small, served through the skills.sh blob fast path (see blob.e2e.ts).
    source: 'vercel-labs/agent-skills',
    minSkills: 5,
    known: ['web-design-guidelines', 'vercel-react-best-practices'],
    one: 'web-design-guidelines',
    two: ['vercel-react-best-practices', 'vercel-composition-patterns'],
  },
] as const;

describe.each(REPOS)('$source', (repo) => {
  it('lists skills without writing anything', async () => {
    const sandbox = await Sandbox.create('list');
    const result = await sandbox.skills(['add', repo.source, '--list']);
    for (const name of repo.known) expect(result.output).toContain(name);
    expect(entries(sandbox.project)).toEqual([]);
  });

  it('installs one skill into a single agent and records it in skills-lock.json', async () => {
    const sandbox = await Sandbox.create('one');
    const [installed] = await sandbox.skillsJson([
      'add',
      repo.source,
      '--skill',
      repo.one,
      '-a',
      'claude-code',
      '-y',
    ]);

    expect(installed).toMatchObject({ name: repo.one, status: 'installed', scope: 'project' });
    expect(installed!.agents).toEqual(['Claude Code']);
    expect(readSkill(sandbox.path('.claude', 'skills', repo.one)).name).toBe(repo.one);

    const lock = sandbox.projectLock().skills[repo.one];
    expect(lock).toMatchObject({ source: repo.source, sourceType: 'github' });
    expect(lock!.skillPath).toMatch(new RegExp(`(^|/)${repo.one}/SKILL\\.md$`));
    expect(lock!.computedHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('symlinks skills into several agents, lists them, then removes one', async () => {
    const sandbox = await Sandbox.create('multi');
    const names = [repo.one, ...repo.two];
    const results = await sandbox.skillsJson([
      'add',
      repo.source,
      '--skill',
      ...names,
      '-a',
      'claude-code',
      'codex',
      'cursor',
      '-y',
    ]);
    expect(results.map((r) => r.name).sort()).toEqual([...names].sort());
    for (const result of results)
      expect(result).toMatchObject({ status: 'installed', mode: 'symlink' });

    // Universal agents (codex, cursor) read .agents/skills directly; Claude Code gets links.
    for (const name of names) {
      const canonical = sandbox.path('.agents', 'skills', name);
      const link = sandbox.path('.claude', 'skills', name);
      expect(readSkill(canonical).name).toBe(name);
      expect(isSymlink(link)).toBe(true);
      expect(realpathSync(link)).toBe(realpathSync(canonical));
    }

    const listed = await sandbox.skillsJson<JsonListEntry[]>(['ls']);
    expect(listed.map((s) => s.name).sort()).toEqual([...names].sort());
    for (const entry of listed) {
      expect(entry).toMatchObject({ scope: 'project', source: repo.source, sourceType: 'github' });
      // Universal agents only show up once detected in HOME; Claude Code has its own links.
      expect(entry.agents).toContain('Claude Code');
    }
    const claudeOnly = await sandbox.skillsJson<JsonListEntry[]>(['ls', '-a', 'claude-code']);
    expect(claudeOnly).toHaveLength(names.length);

    await sandbox.skills(['remove', repo.one, '-y']);
    expect(existsSync(sandbox.path('.agents', 'skills', repo.one))).toBe(false);
    expect(existsSync(sandbox.path('.claude', 'skills', repo.one))).toBe(false);
    expect(sandbox.projectLock().skills[repo.one]).toBeUndefined();
    for (const name of repo.two) {
      expect(readSkill(sandbox.path('.claude', 'skills', name)).name).toBe(name);
      expect(sandbox.projectLock().skills[name]).toBeDefined();
    }

    await sandbox.skills(['remove', '--all']);
    expect(entries(sandbox.path('.agents', 'skills'))).toEqual([]);
    expect(entries(sandbox.path('.claude', 'skills'))).toEqual([]);
    expect(await sandbox.skillsJson(['ls'])).toEqual([]);
  });

  it('installs every skill with --skill "*"', async () => {
    const sandbox = await Sandbox.create('all');
    const results = await sandbox.skillsJson([
      'add',
      repo.source,
      '--skill',
      '*',
      '-a',
      'codex',
      '-y',
    ]);

    const failed = results.filter((r) => r.status !== 'installed');
    expect(failed).toEqual([]);
    expect(results.length).toBeGreaterThanOrEqual(repo.minSkills);

    const dirs = entries(sandbox.path('.agents', 'skills'));
    expect(dirs).toEqual(expect.arrayContaining([...repo.known]));
    expect(dirs).toHaveLength(results.length);
    for (const dir of dirs) readSkill(sandbox.path('.agents', 'skills', dir));
    expect(Object.keys(sandbox.projectLock().skills).sort()).toEqual(dirs);
  });

  it('restores project skills from skills-lock.json', async () => {
    const sandbox = await Sandbox.create('restore');
    await sandbox.skills(['add', repo.source, '--skill', ...repo.two, '-a', 'codex', '-y']);
    const before = sandbox.projectLock();
    await rm(sandbox.path('.agents'), { recursive: true, force: true });

    await sandbox.skills(['experimental_install', '--frozen-lockfile']);
    for (const name of repo.two) {
      expect(readSkill(sandbox.path('.agents', 'skills', name)).name).toBe(name);
    }
    expect(sandbox.projectLock()).toEqual(before);
  });

  it('installs and removes globally', async () => {
    const sandbox = await Sandbox.create('global');
    const [installed] = await sandbox.skillsJson([
      'add',
      repo.source,
      '--skill',
      repo.one,
      '-g',
      '-a',
      'claude-code',
      '-y',
    ]);
    expect(installed).toMatchObject({ name: repo.one, status: 'installed', scope: 'global' });
    expect(readSkill(sandbox.homePath('.claude', 'skills', repo.one)).name).toBe(repo.one);
    // Global installs never touch the project.
    expect(entries(sandbox.project)).toEqual([]);

    const lock = sandbox.globalLock();
    expect(lock.version).toBe(3);
    expect(lock.skills[repo.one]).toMatchObject({ source: repo.source, sourceType: 'github' });
    // The folder tree SHA is what `skills check`/`update` compare against.
    expect(lock.skills[repo.one]!.skillFolderHash).toMatch(/^[0-9a-f]{40}$/);

    const listed = await sandbox.skillsJson<JsonListEntry[]>(['ls', '-g']);
    expect(listed.map((s) => s.name)).toEqual([repo.one]);
    expect(await sandbox.skillsJson(['ls'])).toEqual([]);

    await sandbox.skills(['remove', '-g', repo.one, '-y']);
    expect(existsSync(sandbox.homePath('.claude', 'skills', repo.one))).toBe(false);
    expect(sandbox.globalLock().skills).toEqual({});
    expect(await sandbox.skillsJson(['ls', '-g'])).toEqual([]);
  });

  it('reports a missing skill without installing anything', async () => {
    const sandbox = await Sandbox.create('missing');
    const result = await sandbox.skills(
      ['add', repo.source, '--skill', 'definitely-not-a-real-skill-e2e', '-a', 'codex', '-y'],
      { check: false }
    );
    expect(result.code).not.toBe(0);
    expect(entries(join(sandbox.project, '.agents', 'skills'))).toEqual([]);
  });
});
