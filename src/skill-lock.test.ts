import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  addSkillToLock,
  getSkillsFromLockBySource,
  readSkillLock,
  writeSkillLock,
} from './skill-lock.ts';

describe('skill-lock install preferences', () => {
  let stateDir: string | undefined;

  async function useTempStateDir(): Promise<string> {
    stateDir = await mkdtemp(join(tmpdir(), 'skill-lock-state-'));
    vi.stubEnv('XDG_STATE_HOME', stateDir);
    return stateDir;
  }

  afterEach(async () => {
    vi.unstubAllEnvs();

    if (stateDir) {
      await rm(stateDir, { recursive: true, force: true });
      stateDir = undefined;
    }
  });

  it('reads v3 lock entries without install preference fields', async () => {
    const dir = await useTempStateDir();
    await mkdir(join(dir, 'skills'), { recursive: true });
    await writeFile(
      join(dir, 'skills', '.skill-lock.json'),
      JSON.stringify({
        version: 3,
        skills: {
          legacy: {
            source: 'org/repo',
            sourceType: 'github',
            sourceUrl: 'https://github.com/org/repo.git',
            skillFolderHash: 'abc',
            installedAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        },
      }),
      'utf-8'
    );

    const lock = await readSkillLock();
    expect(lock.skills.legacy?.installMode).toBeUndefined();
    expect(lock.skills.legacy?.agents).toBeUndefined();
  });

  it('writes and matches remembered install preferences by source', async () => {
    await useTempStateDir();

    await addSkillToLock('remembered', {
      source: 'org/repo',
      sourceType: 'github',
      sourceUrl: 'https://github.com/org/repo.git',
      skillFolderHash: 'abc',
      agents: ['claude-code', 'continue'],
      installMode: 'copy',
    });

    const matches = await getSkillsFromLockBySource(['org/repo']);
    expect(matches.remembered?.agents).toEqual(['claude-code', 'continue']);
    expect(matches.remembered?.installMode).toBe('copy');
  });

  it('keeps optional preference fields when writing the full lock', async () => {
    const dir = await useTempStateDir();

    await writeSkillLock({
      version: 3,
      skills: {
        alpha: {
          source: 'org/repo',
          sourceType: 'github',
          sourceUrl: 'https://github.com/org/repo.git',
          skillFolderHash: 'abc',
          installedAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          agents: ['codex'],
          installMode: 'symlink',
        },
      },
    });

    const raw = await readFile(join(dir, 'skills', '.skill-lock.json'), 'utf-8');
    expect(JSON.parse(raw).skills.alpha).toMatchObject({
      agents: ['codex'],
      installMode: 'symlink',
    });
  });
});
