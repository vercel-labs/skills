import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Sandbox, entries, readSkill } from './sandbox.ts';

// vercel-labs is on the blob allowlist: skills come from skills.sh snapshots
// (GitHub Trees API + /api/download) instead of a git clone.
const SOURCE = 'vercel-labs/agent-skills';
const SKILLS = ['web-design-guidelines', 'vercel-react-best-practices'];

async function install(extraArgs: string[]) {
  const sandbox = await Sandbox.create('blob');
  const result = await sandbox.skills([
    'add',
    SOURCE,
    '--skill',
    ...SKILLS,
    '-a',
    'codex',
    '-y',
    ...extraArgs,
  ]);
  return { sandbox, result };
}

describe('blob fast path (skills.sh)', () => {
  it('installs from snapshots without cloning, identical to a git clone', async () => {
    const blob = await install([]);
    expect(blob.result.output).toContain('Fetching skills');
    expect(blob.result.output).not.toContain('Cloning repository');

    // --full-depth skips the blob path and always clones.
    const clone = await install(['--full-depth']);
    expect(clone.result.output).toContain('Repository cloned');

    for (const name of SKILLS) {
      const fromBlob = blob.sandbox.path('.agents', 'skills', name);
      const fromClone = clone.sandbox.path('.agents', 'skills', name);
      expect(readSkill(fromBlob).name).toBe(name);
      expect(readFileSync(`${fromBlob}/SKILL.md`, 'utf8')).toBe(
        readFileSync(`${fromClone}/SKILL.md`, 'utf8')
      );

      const blobLock = blob.sandbox.projectLock().skills[name]!;
      const cloneLock = clone.sandbox.projectLock().skills[name]!;
      expect(blobLock.computedHash).toBe(cloneLock.computedHash);
      expect(blobLock.skillPath).toBe(cloneLock.skillPath);

      // Both installers are meant to drop metadata.json (installer.ts EXCLUDE_FILES,
      // blob.ts SNAPSHOT_EXCLUDED_FILES), so the on-disk trees must match too.
      expect(entries(fromBlob), `${name}: blob vs clone files`).toEqual(entries(fromClone));
    }
  });

  it('records the GitHub folder hash for global blob installs', async () => {
    const sandbox = await Sandbox.create('blob-global');
    const result = await sandbox.skills([
      'add',
      SOURCE,
      '--skill',
      SKILLS[0]!,
      '-g',
      '-a',
      'claude-code',
      '-y',
    ]);
    expect(result.output).not.toContain('Cloning repository');
    expect(readSkill(sandbox.homePath('.claude', 'skills', SKILLS[0]!)).name).toBe(SKILLS[0]);

    const entry = sandbox.globalLock().skills[SKILLS[0]!]!;
    expect(entry).toMatchObject({ source: SOURCE, sourceType: 'github' });
    expect(entry.skillFolderHash).toMatch(/^[0-9a-f]{40}$/);

    // A fresh install is up to date with the remote.
    const check = await sandbox.skills(['check', '-g']);
    expect(check.output).toContain('All global skills are up to date');
  });
});
