import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  checkPackForUpdates,
  getSkipReason,
  groupPackItems,
  type PackUpdateItem,
} from '../src/update.ts';
import { packSnapshotToBlobSkills, type PackSnapshot } from '../src/pack.ts';
import type { SkillLockEntry } from '../src/skill-lock.ts';

const snapshot: PackSnapshot = {
  id: 'abc123',
  createdAt: '2026-06-26T00:00:00.000Z',
  revision: 'rev-1',
  sourceType: 'zip',
  sourceLabel: 'my-skills.zip',
  skills: [
    {
      name: 'first-skill',
      description: 'Does the first thing.',
      files: [
        { path: 'SKILL.md', contents: '# First' },
        { path: 'references/notes.md', contents: 'notes' },
      ],
    },
    {
      name: 'second-skill',
      description: 'Does the second thing.',
      files: [{ path: 'SKILL.md', contents: '# Second' }],
    },
  ],
};

const snapshotHashes = new Map(
  packSnapshotToBlobSkills(snapshot).map((skill) => [skill.name, skill.snapshotHash])
);

function lockItems(
  overrides?: Partial<Record<string, Partial<PackUpdateItem>>>
): PackUpdateItem[] {
  return [...snapshotHashes.entries()].map(([name, hash]) => ({
    name,
    hash,
    packRevision: 'rev-1',
    ...overrides?.[name],
  }));
}

function stubFetch(response: Response | Error): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      if (response instanceof Error) throw response;
      return response;
    })
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('groupPackItems', () => {
  it('groups items by pack id', () => {
    const item = (name: string): PackUpdateItem => ({ name, hash: 'h' });
    const groups = groupPackItems([
      { sourceUrl: 'https://skills.sh/p/aaa', item: item('one') },
      { sourceUrl: 'https://skills.sh/p/aaa', item: item('two') },
      { sourceUrl: 'https://skills.sh/p/bbb', item: item('three') },
    ]);
    expect([...groups.keys()].sort()).toEqual(['aaa', 'bbb']);
    expect(groups.get('aaa')!.map((i) => i.name)).toEqual(['one', 'two']);
  });

  it('skips entries whose source is not a pack url', () => {
    const groups = groupPackItems([
      { sourceUrl: 'https://github.com/owner/repo', item: { name: 'x', hash: 'h' } },
    ]);
    expect(groups.size).toBe(0);
  });
});

describe('checkPackForUpdates', () => {
  it('returns not-found on 404', async () => {
    stubFetch(new Response(null, { status: 404 }));
    const result = await checkPackForUpdates('abc123', lockItems());
    expect(result.status).toBe('not-found');
  });

  it('returns error when the fetch fails', async () => {
    stubFetch(new Error('network down'));
    const result = await checkPackForUpdates('abc123', lockItems());
    expect(result.status).toBe('error');
  });

  it('returns current when all lock entries match the served revision', async () => {
    stubFetch(Response.json(snapshot));
    const result = await checkPackForUpdates(
      'abc123',
      lockItems({ 'first-skill': { hash: 'stale' } })
    );
    expect(result.status).toBe('current');
  });

  it('returns current when revisions are absent but skill hashes match', async () => {
    stubFetch(Response.json({ ...snapshot, revision: undefined }));
    const result = await checkPackForUpdates(
      'abc123',
      lockItems({
        'first-skill': { packRevision: undefined },
        'second-skill': { packRevision: undefined },
      })
    );
    expect(result.status).toBe('current');
  });

  it('classifies changed skills when the revision differs', async () => {
    stubFetch(Response.json({ ...snapshot, revision: 'rev-2' }));
    const result = await checkPackForUpdates(
      'abc123',
      lockItems({ 'first-skill': { hash: 'stale' } })
    );
    expect(result.status).toBe('changed');
    if (result.status !== 'changed') return;
    expect(result.changedSkills).toEqual(['first-skill']);
    expect(result.newSkills).toEqual([]);
    expect(result.removedSkills).toEqual([]);
  });

  it('classifies skills added to and removed from the pack', async () => {
    stubFetch(Response.json({ ...snapshot, revision: 'rev-2' }));
    const items = lockItems().filter((item) => item.name !== 'second-skill');
    items.push({ name: 'retired-skill', hash: 'gone', packRevision: 'rev-1' });
    const result = await checkPackForUpdates('abc123', items);
    expect(result.status).toBe('changed');
    if (result.status !== 'changed') return;
    expect(result.changedSkills).toEqual([]);
    expect(result.newSkills).toEqual(['second-skill']);
    expect(result.removedSkills).toEqual(['retired-skill']);
  });

  it('treats entries with empty hashes and no revision as changed', async () => {
    stubFetch(Response.json({ ...snapshot, revision: 'rev-2' }));
    const result = await checkPackForUpdates(
      'abc123',
      lockItems({
        'first-skill': { hash: '', packRevision: undefined },
        'second-skill': { hash: '', packRevision: undefined },
      })
    );
    expect(result.status).toBe('changed');
    if (result.status !== 'changed') return;
    expect(result.changedSkills.sort()).toEqual(['first-skill', 'second-skill']);
  });
});

describe('getSkipReason for pack entries', () => {
  it('labels pack entries as pack snapshots', () => {
    const entry: SkillLockEntry = {
      source: 'https://skills.sh/p/abc123',
      sourceType: 'pack',
      sourceUrl: 'https://skills.sh/p/abc123',
      skillFolderHash: '',
      installedAt: '2026-06-26T00:00:00.000Z',
      updatedAt: '2026-06-26T00:00:00.000Z',
    };
    expect(getSkipReason(entry)).toBe('Pack snapshot');
  });
});
