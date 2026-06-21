import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  recordSkillInstall,
  recordSkillRemove,
  readInventory,
  getInventoryPath,
  INVENTORY_VERSION,
} from '../src/inventory.ts';

// The inventory module reads HOME at call time, so we can redirect it
// per-test by mutating process.env.HOME.

describe('inventory manifest', () => {
  let fakeHome: string;
  let originalHome: string | undefined;

  beforeEach(async () => {
    fakeHome = await mkdtemp(join(tmpdir(), 'inv-'));
    originalHome = process.env.HOME;
    process.env.HOME = fakeHome;
  });

  afterEach(async () => {
    if (originalHome !== undefined) process.env.HOME = originalHome;
    else delete process.env.HOME;
    await rm(fakeHome, { recursive: true, force: true });
  });

  it('returns an empty inventory when no file exists', async () => {
    const inv = await readInventory();
    expect(inv.version).toBe(INVENTORY_VERSION);
    expect(inv.skills).toEqual([]);
  });

  it('records an install and persists it', async () => {
    await recordSkillInstall({
      name: 'frontend-design',
      source: 'github.com/vercel-labs/agent-skills',
      scope: 'global',
      installed_at: '2026-05-25T10:00:00Z',
      provider_id: 'github',
    });
    const inv = await readInventory();
    expect(inv.skills).toHaveLength(1);
    expect(inv.skills[0]!.name).toBe('frontend-design');
    expect(inv.skills[0]!.source).toBe('github.com/vercel-labs/agent-skills');

    // File actually exists at the expected path under fake HOME.
    const path = getInventoryPath();
    expect(path).toBe(join(fakeHome, '.agents', 'skills-inventory.json'));
    const raw = JSON.parse(await readFile(path, 'utf-8'));
    expect(raw.version).toBe(INVENTORY_VERSION);
  });

  it('is idempotent on (name, scope, project_path) — re-install replaces, does not duplicate', async () => {
    await recordSkillInstall({
      name: 'x',
      source: 'github.com/a/b',
      scope: 'global',
      installed_at: '2026-05-25T10:00:00Z',
    });
    await recordSkillInstall({
      name: 'x',
      source: 'github.com/a/b',
      scope: 'global',
      installed_at: '2026-05-25T11:00:00Z',
    });
    const inv = await readInventory();
    expect(inv.skills).toHaveLength(1);
    expect(inv.skills[0]!.installed_at).toBe('2026-05-25T11:00:00Z');
  });

  it('keeps separate entries for the same skill in global vs. project scope', async () => {
    await recordSkillInstall({
      name: 'x',
      source: 'github.com/a/b',
      scope: 'global',
      installed_at: '2026-05-25T10:00:00Z',
    });
    await recordSkillInstall({
      name: 'x',
      source: 'github.com/a/b',
      scope: 'project',
      project_path: '/work/repo-a',
      installed_at: '2026-05-25T10:00:00Z',
    });
    await recordSkillInstall({
      name: 'x',
      source: 'github.com/a/b',
      scope: 'project',
      project_path: '/work/repo-b',
      installed_at: '2026-05-25T10:00:00Z',
    });
    const inv = await readInventory();
    expect(inv.skills).toHaveLength(3);
  });

  it('remove deletes the matching entry only', async () => {
    await recordSkillInstall({
      name: 'x',
      source: 'github.com/a/b',
      scope: 'global',
      installed_at: '2026-05-25T10:00:00Z',
    });
    await recordSkillInstall({
      name: 'y',
      source: 'github.com/a/c',
      scope: 'global',
      installed_at: '2026-05-25T10:00:00Z',
    });
    await recordSkillRemove({ name: 'x', scope: 'global' });
    const inv = await readInventory();
    expect(inv.skills.map((s) => s.name)).toEqual(['y']);
  });
});
