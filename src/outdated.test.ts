import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import {
  buildGlobalEntries,
  parseOutdatedOptions,
  runOutdated,
  summarize,
  type OutdatedJson,
  type OutdatedJsonSkill,
} from './outdated.ts';
import type { GlobalCheckResult, SkillLockEntry } from './updates.ts';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

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

// ----------------------------------------
// Integration: runOutdated end-to-end with stdout capture
// ----------------------------------------

describe('runOutdated --json integration', () => {
  let prevHome: string | undefined;
  let prevXdg: string | undefined;
  let testRoot: string;
  let logs: string[];
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Redirect the lock-file lookup to a clean tempdir so we never
    // touch the developer's real `~/.agents/.skill-lock.json`. The
    // lockfile-path code reads `XDG_STATE_HOME` first, then `HOME`.
    testRoot = mkdtempSync(join(tmpdir(), 'skills-outdated-test-'));
    prevHome = process.env.HOME;
    prevXdg = process.env.XDG_STATE_HOME;
    process.env.HOME = testRoot;
    process.env.XDG_STATE_HOME = join(testRoot, 'state');
    // cwd stays the repo root so project-skill detection finds no
    // project skills — cleaner test surface.
    logs = [];
    logSpy = vi.spyOn(console, 'log').mockImplementation((msg: unknown) => {
      logs.push(typeof msg === 'string' ? msg : JSON.stringify(msg));
    });
  });

  afterEach(() => {
    logSpy.mockRestore();
    process.env.HOME = prevHome;
    if (prevXdg === undefined) delete process.env.XDG_STATE_HOME;
    else process.env.XDG_STATE_HOME = prevXdg;
    rmSync(testRoot, { recursive: true, force: true });
  });

  it('emits a valid schema-1 JSON payload with --json', async () => {
    await runOutdated(['--json', '-g']);

    expect(logs.length).toBe(1);
    const report: OutdatedJson = JSON.parse(logs[0]!);

    expect(report.schema).toBe(1);
    expect(typeof report.checkedAt).toBe('string');
    expect(new Date(report.checkedAt).toString()).not.toBe('Invalid Date');
    expect(report.scope).toBe('global');
    expect(Array.isArray(report.skills)).toBe(true);
    expect(report.summary).toMatchObject({
      checked: expect.any(Number),
      outdated: expect.any(Number),
      upToDate: expect.any(Number),
      skipped: expect.any(Number),
      errored: expect.any(Number),
    });
    // Sum invariant: bucket counts must equal total.
    const { outdated, upToDate, skipped, errored, checked } = report.summary;
    expect(outdated + upToDate + skipped + errored).toBe(checked);
  });

  it('returns an empty report when there are no installed skills', async () => {
    // Ensure the global lock file doesn't exist at all — summary.checked
    // must be 0 and skills must be an empty array.
    await runOutdated(['--json', '-g']);
    const report: OutdatedJson = JSON.parse(logs[0]!);
    expect(report.summary.checked).toBe(0);
    expect(report.skills).toEqual([]);
  });

  it('--json implies -y (does not require a TTY for scope resolution)', async () => {
    // If --json didn't imply -y, resolveUpdateScope would block on
    // `p.select` for an interactive prompt. The test runs under vitest
    // with no TTY, so hanging = failure. Timeout guard: 3s is plenty
    // for the tempdir-backed empty-lockfile path.
    await Promise.race([
      runOutdated(['--json']),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('--json did not imply -y; runOutdated hung')), 3000)
      ),
    ]);
    expect(logs.length).toBeGreaterThan(0);
    // Just assert we got a parseable JSON report
    const report = JSON.parse(logs[0]!) as OutdatedJson;
    expect(report.schema).toBe(1);
  });

  it('supports project-level reporting with a local skills-lock.json', async () => {
    // Write a project-level skills-lock.json in the test root and run
    // outdated --json -p from that directory. Project skills always
    // surface as `outdated: null` with the documented error message.
    const lockPath = join(testRoot, 'skills-lock.json');
    writeFileSync(
      lockPath,
      JSON.stringify({
        version: 1,
        skills: {
          'my-skill': {
            source: 'owner/repo',
            ref: 'main',
            sourceType: 'github',
            computedHash: 'abc123',
          },
        },
      })
    );

    const prevCwd = process.cwd();
    process.chdir(testRoot);
    try {
      await runOutdated(['--json', '-p']);
    } finally {
      process.chdir(prevCwd);
    }

    const report: OutdatedJson = JSON.parse(logs[0]!);
    expect(report.scope).toBe('project');
    expect(report.skills).toHaveLength(1);
    const [entry] = report.skills;
    expect(entry.name).toBe('my-skill');
    expect(entry.scope).toBe('project');
    expect(entry.outdated).toBeNull();
    expect(entry.error).toBe('Project-scope skills are refreshed on update');
    expect(report.summary.skipped).toBe(1);
  });

  // Suppress unused-var warning on test helpers that future integration
  // tests may need.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _helpers = { mkdirSync };
});
