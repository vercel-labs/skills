import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { Sandbox, entries, isSymlink, readSkill, type JsonListEntry } from './sandbox.ts';

/**
 * `add --rename` against live GitHub: the skill installs under the new name,
 * and update, restore, list and remove keep using it. Updates are forced by
 * editing the recorded hash, so they reinstall from upstream regardless of
 * whether the skill changed there.
 */
const REPOS = [
  // Cloned from GitHub.
  { source: 'anthropics/skills', skill: 'pdf', alias: 'acme-pdf' },
  // Served through the skills.sh blob fast path.
  { source: 'vercel-labs/agent-skills', skill: 'web-design-guidelines', alias: 'acme-design' },
] as const;

/** Edit skills-lock.json or the global lock in place. */
function editJson(path: string, edit: (json: any) => void): void {
  const json = JSON.parse(readFileSync(path, 'utf8'));
  edit(json);
  writeFileSync(path, JSON.stringify(json, null, 2));
}

describe.each(REPOS)('$source', (repo) => {
  it('installs under the new name and keeps it through update, list and remove', async () => {
    const sandbox = await Sandbox.create('rename');
    const [installed] = await sandbox.skillsJson([
      'add',
      repo.source,
      '--skill',
      repo.skill,
      '--rename',
      repo.alias,
      '-a',
      'claude-code',
      '-y',
    ]);

    expect(installed).toMatchObject({ name: repo.alias, status: 'installed' });
    expect(entries(sandbox.path('.claude', 'skills'))).toEqual([repo.alias]);
    expect(readSkill(sandbox.path('.claude', 'skills', repo.alias)).name).toBe(repo.alias);
    const lock = sandbox.projectLock();
    expect(Object.keys(lock.skills)).toEqual([repo.alias]);
    expect(lock.skills[repo.alias]).toMatchObject({
      source: repo.source,
      sourceType: 'github',
      skillName: repo.skill,
    });
    expect(lock.skills[repo.alias]!.skillPath).toMatch(
      new RegExp(`(^|/)${repo.skill}/SKILL\\.md$`)
    );

    const listed = await sandbox.skillsJson<Array<JsonListEntry & { renamedFrom: string | null }>>([
      'ls',
    ]);
    expect(listed).toEqual([
      expect.objectContaining({
        name: repo.alias,
        source: repo.source,
        renamedFrom: repo.skill,
        // The lock hashes the rewritten SKILL.md, so the installed copy verifies.
        status: 'tracked',
      }),
    ]);
    expect((await sandbox.skills(['ls'])).output).toContain(`(renamed from ${repo.skill})`);

    // Nothing changed upstream: the renamed skill must not look outdated.
    const check = await sandbox.skills(['check'], { check: false });
    expect(check.output).not.toContain('has an update');
    expect(check.code).toBe(0);

    // Force a reinstall: upstream is looked up by the source name, installed under the alias.
    const hash = lock.skills[repo.alias]!.computedHash;
    editJson(sandbox.path('skills-lock.json'), (json) => {
      json.skills[repo.alias].computedHash = '0'.repeat(64);
    });
    // `check` exits 1 when an update is available.
    const outdated = await sandbox.skills(['check'], { check: false });
    expect(outdated.output).toContain(`${repo.alias} has an update`);
    expect(outdated.code).toBe(1);
    const update = await sandbox.skills(['update', '-p', '-y']);
    expect(update.output).toContain(`Updated ${repo.alias}`);
    expect(entries(sandbox.path('.claude', 'skills'))).toEqual([repo.alias]);
    expect(readSkill(sandbox.path('.claude', 'skills', repo.alias)).name).toBe(repo.alias);
    expect(sandbox.projectLock().skills[repo.alias]).toMatchObject({
      skillName: repo.skill,
      computedHash: hash,
    });

    await sandbox.skills(['remove', repo.alias, '-y']);
    expect(entries(sandbox.path('.claude', 'skills'))).toEqual([]);
    expect(sandbox.projectLock().skills).toEqual({});
  });

  it('restores under the new name from skills-lock.json', async () => {
    const sandbox = await Sandbox.create('rename-restore');
    // Install the skill twice: as-is and renamed.
    await sandbox.skills(['add', repo.source, '--skill', repo.skill, '-a', 'codex', '-y']);
    await sandbox.skills([
      'add',
      repo.source,
      '--skill',
      repo.skill,
      '--rename',
      repo.alias,
      '-a',
      'codex',
      '-y',
    ]);
    const before = sandbox.projectLock();
    await rm(sandbox.path('.agents'), { recursive: true, force: true });

    await sandbox.skills(['experimental_install', '--frozen-lockfile']);

    expect(entries(sandbox.path('.agents', 'skills'))).toEqual([repo.alias, repo.skill].sort());
    expect(readSkill(sandbox.path('.agents', 'skills', repo.alias)).name).toBe(repo.alias);
    expect(readSkill(sandbox.path('.agents', 'skills', repo.skill)).name).toBe(repo.skill);
    expect(sandbox.projectLock()).toEqual(before);
  });
});

describe('anthropics/skills', () => {
  const source = 'anthropics/skills';

  it('rewrites the shared copy and links agents to it', async () => {
    const sandbox = await Sandbox.create('rename-symlink');
    await sandbox.skills([
      'add',
      source,
      '--skill',
      'pdf',
      '--rename',
      'acme-pdf',
      '-a',
      'claude-code',
      'codex',
      '-y',
    ]);

    const canonical = sandbox.path('.agents', 'skills', 'acme-pdf');
    const link = sandbox.path('.claude', 'skills', 'acme-pdf');
    expect(readSkill(canonical).name).toBe('acme-pdf');
    expect(isSymlink(link)).toBe(true);
    expect(realpathSync(link)).toBe(realpathSync(canonical));
    expect(existsSync(sandbox.path('.agents', 'skills', 'pdf'))).toBe(false);
  });

  it('keeps the new name when a global skill is updated', async () => {
    const sandbox = await Sandbox.create('rename-global');
    await sandbox.skills([
      'add',
      source,
      '--skill',
      'pdf',
      '--rename',
      'acme-pdf',
      '-g',
      '-a',
      'claude-code',
      '-y',
    ]);
    const lockPath = sandbox.homePath('.agents', '.skill-lock.json');
    const entry = sandbox.globalLock().skills['acme-pdf'];
    expect(entry).toMatchObject({ source, sourceType: 'github', skillName: 'pdf' });
    expect(entry!.skillFolderHash).toMatch(/^[0-9a-f]{40}$/);
    expect(readSkill(sandbox.homePath('.claude', 'skills', 'acme-pdf')).name).toBe('acme-pdf');

    editJson(lockPath, (json) => {
      json.skills['acme-pdf'].skillFolderHash = '0'.repeat(40);
    });
    const update = await sandbox.skills(['update', '-g', '-y']);

    expect(update.output).toContain('Updated acme-pdf');
    expect(entries(sandbox.homePath('.claude', 'skills'))).toEqual(['acme-pdf']);
    expect(readSkill(sandbox.homePath('.claude', 'skills', 'acme-pdf')).name).toBe('acme-pdf');
    expect(sandbox.globalLock().skills).toEqual({
      'acme-pdf': expect.objectContaining({
        skillName: 'pdf',
        skillFolderHash: entry!.skillFolderHash,
      }),
    });
  });

  it('refuses to rename several skills at once without writing anything', async () => {
    const sandbox = await Sandbox.create('rename-multiple');
    const result = await sandbox.skills(
      ['add', source, '--skill', 'pdf', 'docx', '--rename', 'acme', '-a', 'codex', '-y'],
      { check: false }
    );

    expect(result.code).not.toBe(0);
    expect(result.output).toContain('--rename installs one skill');
    expect(entries(sandbox.project)).toEqual([]);
  });

  it('renames several skills in one installSkills call', async () => {
    const sandbox = await Sandbox.create('rename-api');
    const { value } = await sandbox.api<{
      installed: string[];
      listed: Array<{ name: string; renamedFrom?: string }>;
      multipleCode: string | null;
    }>(`
      const result = await api.installSkills('${source}', {
        cwd: project,
        skills: ['pdf', 'docx'],
        rename: { pdf: 'acme-pdf', docx: 'acme-docx' },
        agents: ['claude-code'],
        telemetry: false,
      });
      const listed = await api.listSkills({ cwd: project, scope: 'project' });
      return {
        installed: [...new Set(result.installed.map((t) => t.skill))].sort(),
        listed: listed.skills.map(({ name, renamedFrom }) => ({ name, renamedFrom })),
        multipleCode: await codeOf(
          api.installSkills('${source}', { cwd: project, rename: { nope: 'x' }, telemetry: false })
        ),
      };
    `);

    expect(value.installed).toEqual(['acme-docx', 'acme-pdf']);
    expect(value.listed).toEqual(
      expect.arrayContaining([
        { name: 'acme-pdf', renamedFrom: 'pdf' },
        { name: 'acme-docx', renamedFrom: 'docx' },
      ])
    );
    expect(value.multipleCode).toBe('SKILLS_NO_MATCHING_SKILLS');
    expect(readSkill(sandbox.path('.claude', 'skills', 'acme-pdf')).name).toBe('acme-pdf');
    expect(sandbox.projectLock().skills['acme-docx']).toMatchObject({ skillName: 'docx' });
  });
});
