import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Sandbox, entries, readSkill } from './sandbox.ts';

// vercel.com publishes a v0.2.0 discovery index at /.well-known/agent-skills/index.json
// with both `skill-md` and `archive` entries.
const SOURCE = 'https://vercel.com';
const SKILL_MD = 'deploy-to-vercel'; // single SKILL.md artifact
const ARCHIVE = 'vercel-composition-patterns'; // archive artifact with extra files

describe('well-known endpoint', () => {
  it('lists skills from the discovery index', async () => {
    const sandbox = await Sandbox.create('wk-list');
    const result = await sandbox.skills(['add', SOURCE, '--list']);
    expect(result.output).toContain('well-known');
    expect(result.output).toContain(SKILL_MD);
    expect(result.output).toContain(ARCHIVE);
    expect(entries(sandbox.project)).toEqual([]);
  });

  it('installs skill-md and archive artifacts, then removes them', async () => {
    const sandbox = await Sandbox.create('wk-install');
    await sandbox.skills(['add', SOURCE, '--skill', SKILL_MD, ARCHIVE, '-a', 'claude-code', '-y']);

    expect(readSkill(sandbox.path('.claude', 'skills', SKILL_MD)).name).toBe(SKILL_MD);
    const archiveDir = sandbox.path('.claude', 'skills', ARCHIVE);
    expect(readSkill(archiveDir).name).toBe(ARCHIVE);
    // Archives carry more than SKILL.md (rules/, AGENTS.md, ...).
    expect(entries(archiveDir).length).toBeGreaterThan(1);

    const lock = sandbox.projectLock().skills;
    for (const name of [SKILL_MD, ARCHIVE]) {
      expect(lock[name]).toMatchObject({
        source: 'vercel.com',
        sourceUrl: SOURCE,
        sourceType: 'well-known',
      });
      expect(lock[name]!.wellKnownDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    }

    await sandbox.skills(['remove', SKILL_MD, ARCHIVE, '-y']);
    expect(existsSync(sandbox.path('.claude', 'skills', SKILL_MD))).toBe(false);
    expect(existsSync(archiveDir)).toBe(false);
    expect(sandbox.projectLock().skills).toEqual({});
  });

  it('installs globally into the home directory', async () => {
    const sandbox = await Sandbox.create('wk-global');
    await sandbox.skills(['add', SOURCE, '--skill', SKILL_MD, '-g', '-a', 'claude-code', '-y']);
    expect(readSkill(sandbox.homePath('.claude', 'skills', SKILL_MD)).name).toBe(SKILL_MD);
    expect(sandbox.globalLock().skills[SKILL_MD]).toMatchObject({ sourceType: 'well-known' });

    await sandbox.skills(['remove', '-g', SKILL_MD, '-y']);
    expect(existsSync(sandbox.homePath('.claude', 'skills', SKILL_MD))).toBe(false);
  });
});
