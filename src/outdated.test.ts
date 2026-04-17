import { describe, it, expect } from 'vitest';
import {
  parseOutdatedOptions,
  buildGlobalEntries,
  summarize,
  type OutdatedJsonSkill,
} from './outdated.ts';
import type { GlobalCheckResult, SkillLockEntry } from './updates.ts';

// ----------------------------------------
// Fixtures
// ----------------------------------------

function makeEntry(overrides: Partial<SkillLockEntry> = {}): SkillLockEntry {
  return {
    source: 'owner/repo',
    sourceType: 'github',
    sourceUrl: 'https://github.com/owner/repo',
    ref: 'main',
    skillPath: 'skills/demo/SKILL.md',
    skillFolderHash: 'aaaaaaaaaaaaaaaa',
    installedAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

// ----------------------------------------

describe('parseOutdatedOptions', () => {
  it('parses empty args', () => {
    expect(parseOutdatedOptions([])).toEqual({});
  });

  it('parses -g / --global', () => {
    expect(parseOutdatedOptions(['-g']).global).toBe(true);
    expect(parseOutdatedOptions(['--global']).global).toBe(true);
  });

  it('parses -p / --project', () => {
    expect(parseOutdatedOptions(['-p']).project).toBe(true);
    expect(parseOutdatedOptions(['--project']).project).toBe(true);
  });

  it('parses -y / --yes', () => {
    expect(parseOutdatedOptions(['-y']).yes).toBe(true);
    expect(parseOutdatedOptions(['--yes']).yes).toBe(true);
  });

  it('parses --json', () => {
    expect(parseOutdatedOptions(['--json']).json).toBe(true);
  });

  it('collects positional args as skill filter', () => {
    expect(parseOutdatedOptions(['gmail', 'calendar']).skills).toEqual(['gmail', 'calendar']);
  });

  it('mixes flags and positionals', () => {
    const opts = parseOutdatedOptions(['-g', '--json', 'gmail', '-y']);
    expect(opts.global).toBe(true);
    expect(opts.json).toBe(true);
    expect(opts.yes).toBe(true);
    expect(opts.skills).toEqual(['gmail']);
  });

  it('ignores unknown flags', () => {
    const opts = parseOutdatedOptions(['--unknown', 'gmail']);
    expect(opts).toEqual({ skills: ['gmail'] });
  });
});

describe('buildGlobalEntries', () => {
  it('emits outdated: true when upstream hash differs', () => {
    const result: GlobalCheckResult = {
      checked: [
        {
          name: 'gmail',
          entry: makeEntry({ skillFolderHash: 'localhash' }),
          upstreamHash: 'upstreamhash',
          error: null,
        },
      ],
      skipped: [],
      checkedCount: 1,
    };
    const entries = buildGlobalEntries(result);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.outdated).toBe(true);
    expect(entries[0]!.localHash).toBe('localhash');
    expect(entries[0]!.upstreamHash).toBe('upstreamhash');
    expect(entries[0]!.error).toBeNull();
  });

  it('emits outdated: false when hashes match', () => {
    const result: GlobalCheckResult = {
      checked: [
        {
          name: 'gmail',
          entry: makeEntry({ skillFolderHash: 'samehash' }),
          upstreamHash: 'samehash',
          error: null,
        },
      ],
      skipped: [],
      checkedCount: 1,
    };
    const entries = buildGlobalEntries(result);
    expect(entries[0]!.outdated).toBe(false);
    expect(entries[0]!.error).toBeNull();
  });

  it('emits outdated: null with error when fetch threw', () => {
    const result: GlobalCheckResult = {
      checked: [
        {
          name: 'gmail',
          entry: makeEntry(),
          upstreamHash: null,
          error: 'network: ENOTFOUND',
        },
      ],
      skipped: [],
      checkedCount: 1,
    };
    const entries = buildGlobalEntries(result);
    expect(entries[0]!.outdated).toBeNull();
    expect(entries[0]!.error).toBe('network: ENOTFOUND');
    expect(entries[0]!.upstreamHash).toBeNull();
  });

  it('emits outdated: null when upstream returns no hash (private/deleted)', () => {
    const result: GlobalCheckResult = {
      checked: [
        {
          name: 'gmail',
          entry: makeEntry(),
          upstreamHash: null,
          error: null,
        },
      ],
      skipped: [],
      checkedCount: 1,
    };
    const entries = buildGlobalEntries(result);
    expect(entries[0]!.outdated).toBeNull();
    expect(entries[0]!.error).toBe('No upstream hash available');
  });

  it('passes skipped skills through with reason as error', () => {
    const result: GlobalCheckResult = {
      checked: [],
      skipped: [
        {
          name: 'my-local',
          reason: 'Local path',
          sourceUrl: '/Users/x/skill',
          sourceType: 'local',
        },
      ],
      checkedCount: 1,
    };
    const entries = buildGlobalEntries(result);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.outdated).toBeNull();
    expect(entries[0]!.error).toBe('Local path');
    expect(entries[0]!.sourceType).toBe('local');
  });

  it('handles a mixed result (outdated + current + errored + skipped)', () => {
    const result: GlobalCheckResult = {
      checked: [
        {
          name: 'a',
          entry: makeEntry({ skillFolderHash: 'old' }),
          upstreamHash: 'new',
          error: null,
        },
        {
          name: 'b',
          entry: makeEntry({ skillFolderHash: 'same' }),
          upstreamHash: 'same',
          error: null,
        },
        {
          name: 'c',
          entry: makeEntry(),
          upstreamHash: null,
          error: 'rate limited',
        },
      ],
      skipped: [
        {
          name: 'd',
          reason: 'Well-known skill',
          sourceUrl: 'https://example.com/.well-known/skills/d',
          sourceType: 'well-known',
        },
      ],
      checkedCount: 4,
    };
    const entries = buildGlobalEntries(result);
    expect(entries.map((e) => e.name)).toEqual(['a', 'b', 'c', 'd']);
    expect(entries[0]!.outdated).toBe(true);
    expect(entries[1]!.outdated).toBe(false);
    expect(entries[2]!.outdated).toBeNull();
    expect(entries[2]!.error).toBe('rate limited');
    expect(entries[3]!.outdated).toBeNull();
    expect(entries[3]!.error).toBe('Well-known skill');
  });
});

describe('summarize', () => {
  it('counts each status bucket correctly', () => {
    const skills: OutdatedJsonSkill[] = [
      // outdated
      {
        name: 'a',
        scope: 'global',
        source: 'owner/a',
        sourceUrl: '',
        sourceType: 'github',
        ref: null,
        skillPath: null,
        localHash: 'x',
        upstreamHash: 'y',
        outdated: true,
        error: null,
      },
      // up to date
      {
        name: 'b',
        scope: 'global',
        source: 'owner/b',
        sourceUrl: '',
        sourceType: 'github',
        ref: null,
        skillPath: null,
        localHash: 'x',
        upstreamHash: 'x',
        outdated: false,
        error: null,
      },
      // errored (localHash present, but couldn't check)
      {
        name: 'c',
        scope: 'global',
        source: 'owner/c',
        sourceUrl: '',
        sourceType: 'github',
        ref: null,
        skillPath: null,
        localHash: 'x',
        upstreamHash: null,
        outdated: null,
        error: 'network',
      },
      // skipped (localHash null)
      {
        name: 'd',
        scope: 'global',
        source: '/local/d',
        sourceUrl: '',
        sourceType: 'local',
        ref: null,
        skillPath: null,
        localHash: null,
        upstreamHash: null,
        outdated: null,
        error: 'Local path',
      },
    ];
    const summary = summarize(skills);
    expect(summary).toEqual({
      checked: 4,
      outdated: 1,
      upToDate: 1,
      skipped: 1,
      errored: 1,
    });
  });

  it('handles an empty list', () => {
    expect(summarize([])).toEqual({
      checked: 0,
      outdated: 0,
      upToDate: 0,
      skipped: 0,
      errored: 0,
    });
  });
});
