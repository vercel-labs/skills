import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

async function loadSkillLockModule(fakeHome: string) {
  vi.resetModules();
  vi.doMock('os', async () => {
    const actual = await vi.importActual<typeof import('node:os')>('node:os');
    return {
      ...actual,
      homedir: () => fakeHome,
    };
  });

  return import('../src/skill-lock.ts');
}

describe('skill-lock global lockfile behavior', () => {
  let testDir: string;
  let fakeHome: string;
  let lockPath: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'skill-lock-test-'));
    fakeHome = join(testDir, 'home');
    lockPath = join(fakeHome, '.agents', '.skill-lock.json');
    await mkdir(join(fakeHome, '.agents'), { recursive: true });
  });

  afterEach(async () => {
    vi.doUnmock('os');
    vi.resetModules();
    await rm(testDir, { recursive: true, force: true });
  });

  it('dismissPrompt should not wipe tracked skills from a legacy lockfile', async () => {
    await writeFile(
      lockPath,
      JSON.stringify(
        {
          version: 2,
          skills: {
            'tracked-skill': {
              source: 'org/repo',
              sourceType: 'github',
              sourceUrl: 'https://github.com/org/repo',
              skillPath: 'skills/tracked-skill/SKILL.md',
              skillFolderHash: 'abc123',
              installedAt: '2026-03-12T00:00:00.000Z',
              updatedAt: '2026-03-12T00:00:00.000Z',
            },
          },
        },
        null,
        2
      ),
      'utf-8'
    );

    const skillLock = await loadSkillLockModule(fakeHome);
    await skillLock.dismissPrompt('findSkillsPrompt');

    const written = JSON.parse(await readFile(lockPath, 'utf-8'));
    expect(written.skills['tracked-skill']).toBeDefined();
    expect(written.dismissed.findSkillsPrompt).toBe(true);
  });

  it('saveSelectedAgents should not wipe tracked skills from a legacy lockfile', async () => {
    await writeFile(
      lockPath,
      JSON.stringify(
        {
          version: 2,
          skills: {
            'tracked-skill': {
              source: 'org/repo',
              sourceType: 'github',
              sourceUrl: 'https://github.com/org/repo',
              skillPath: 'skills/tracked-skill/SKILL.md',
              skillFolderHash: 'abc123',
              installedAt: '2026-03-12T00:00:00.000Z',
              updatedAt: '2026-03-12T00:00:00.000Z',
            },
          },
        },
        null,
        2
      ),
      'utf-8'
    );

    const skillLock = await loadSkillLockModule(fakeHome);
    await skillLock.saveSelectedAgents(['codex', 'opencode']);

    const written = JSON.parse(await readFile(lockPath, 'utf-8'));
    expect(written.skills['tracked-skill']).toBeDefined();
    expect(written.lastSelectedAgents).toEqual(['codex', 'opencode']);
  });

  it('dismissPrompt should preserve unknown top-level fields when rewriting the lockfile', async () => {
    await writeFile(
      lockPath,
      JSON.stringify(
        {
          version: 3,
          skills: {
            'tracked-skill': {
              source: 'org/repo',
              sourceType: 'github',
              sourceUrl: 'https://github.com/org/repo',
              skillPath: 'skills/tracked-skill/SKILL.md',
              skillFolderHash: 'abc123',
              installedAt: '2026-03-12T00:00:00.000Z',
              updatedAt: '2026-03-12T00:00:00.000Z',
            },
          },
          customMetadata: {
            sourceGroupingMode: 'composite-keys',
          },
        },
        null,
        2
      ),
      'utf-8'
    );

    const skillLock = await loadSkillLockModule(fakeHome);
    await skillLock.dismissPrompt('findSkillsPrompt');

    const written = JSON.parse(await readFile(lockPath, 'utf-8'));
    expect(written.skills['tracked-skill']).toBeDefined();
    expect(written.dismissed.findSkillsPrompt).toBe(true);
    expect(written.customMetadata).toEqual({
      sourceGroupingMode: 'composite-keys',
    });
  });

  it('addSkillToLock should not overwrite a different source that shares the same skill name', async () => {
    const skillLock = await loadSkillLockModule(fakeHome);

    await skillLock.addSkillToLock('shared-skill', {
      source: 'org/alpha',
      sourceType: 'github',
      sourceUrl: 'https://github.com/org/alpha',
      skillPath: 'skills/shared-skill/SKILL.md',
      skillFolderHash: 'hash-alpha',
    });

    await skillLock.addSkillToLock('shared-skill', {
      source: 'org/beta',
      sourceType: 'github',
      sourceUrl: 'https://github.com/org/beta',
      skillPath: 'skills/shared-skill/SKILL.md',
      skillFolderHash: 'hash-beta',
    });

    const written = JSON.parse(await readFile(lockPath, 'utf-8'));
    expect(Object.keys(written.skills)).toHaveLength(2);
    expect(
      Object.values(written.skills).some(
        (entry: any) => entry.source === 'org/alpha' && entry.skillFolderHash === 'hash-alpha'
      )
    ).toBe(true);
    expect(
      Object.values(written.skills).some(
        (entry: any) => entry.source === 'org/beta' && entry.skillFolderHash === 'hash-beta'
      )
    ).toBe(true);
  });

  it('getSkillsBySource should preserve same-name skills from different sources', async () => {
    const skillLock = await loadSkillLockModule(fakeHome);

    await skillLock.addSkillToLock('shared-skill', {
      source: 'org/alpha',
      sourceType: 'github',
      sourceUrl: 'https://github.com/org/alpha',
      skillPath: 'skills/shared-skill/SKILL.md',
      skillFolderHash: 'hash-alpha',
    });

    await skillLock.addSkillToLock('shared-skill', {
      source: 'org/beta',
      sourceType: 'github',
      sourceUrl: 'https://github.com/org/beta',
      skillPath: 'skills/shared-skill/SKILL.md',
      skillFolderHash: 'hash-beta',
    });

    const bySource = await skillLock.getSkillsBySource();
    expect(Array.from(bySource.keys()).sort()).toEqual(['org/alpha', 'org/beta']);
    expect(bySource.get('org/alpha')?.skills).toEqual(['shared-skill']);
    expect(bySource.get('org/beta')?.skills).toEqual(['shared-skill']);
  });

  it('removeSkillFromLock should remove all tracked variants of a colliding skill name', async () => {
    const skillLock = await loadSkillLockModule(fakeHome);

    await skillLock.addSkillToLock('shared-skill', {
      source: 'org/alpha',
      sourceType: 'github',
      sourceUrl: 'https://github.com/org/alpha',
      skillPath: 'skills/shared-skill/SKILL.md',
      skillFolderHash: 'hash-alpha',
    });

    await skillLock.addSkillToLock('shared-skill', {
      source: 'org/beta',
      sourceType: 'github',
      sourceUrl: 'https://github.com/org/beta',
      skillPath: 'skills/shared-skill/SKILL.md',
      skillFolderHash: 'hash-beta',
    });

    const removed = await skillLock.removeSkillFromLock('shared-skill');
    const written = JSON.parse(await readFile(lockPath, 'utf-8'));

    expect(removed).toBe(true);
    expect(Object.keys(written.skills)).toHaveLength(0);
  });

  it('removeSkillFromLock should remove all source-aware entries for a shared skill name', async () => {
    await writeFile(
      lockPath,
      JSON.stringify(
        {
          version: 3,
          skills: {
            'org/alpha::shared-skill': {
              source: 'org/alpha',
              sourceType: 'github',
              sourceUrl: 'https://github.com/org/alpha',
              skillPath: 'skills/shared-skill/SKILL.md',
              skillFolderHash: 'hash-alpha',
              installedAt: '2026-03-12T00:00:00.000Z',
              updatedAt: '2026-03-12T00:00:00.000Z',
            },
            'org/beta::shared-skill': {
              source: 'org/beta',
              sourceType: 'github',
              sourceUrl: 'https://github.com/org/beta',
              skillPath: 'skills/shared-skill/SKILL.md',
              skillFolderHash: 'hash-beta',
              installedAt: '2026-03-12T00:00:00.000Z',
              updatedAt: '2026-03-12T00:00:00.000Z',
            },
          },
        },
        null,
        2
      ),
      'utf-8'
    );

    const skillLock = await loadSkillLockModule(fakeHome);
    const removed = await skillLock.removeSkillFromLock('shared-skill');
    const written = JSON.parse(await readFile(lockPath, 'utf-8'));

    expect(removed).toBe(true);
    expect(Object.keys(written.skills)).toHaveLength(0);
  });
});
