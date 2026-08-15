import { describe, it, expect, afterEach, vi } from 'vitest';
import { checkWellKnownForUpdates, type WellKnownUpdateItem } from '../src/update.ts';
import {
  computeWellKnownSkillDigest,
  wellKnownProvider,
  type WellKnownSkill,
} from '../src/providers/index.ts';

const BASE_URL = 'https://skills.example.com/p/testpack';

const DIGEST_A = `sha256:${'a'.repeat(64)}`;
const DIGEST_B = `sha256:${'b'.repeat(64)}`;
const DIGEST_STALE = `sha256:${'0'.repeat(64)}`;

function skillMd(name: string, body: string): string {
  return `---\nname: ${name}\ndescription: ${name} description\n---\n${body}\n`;
}

const V1_CONTENTS: Record<string, string> = {
  'alpha-skill': skillMd('alpha-skill', '# Alpha v1'),
  'beta-skill': skillMd('beta-skill', '# Beta v1'),
};

function v1Index(names: string[]): unknown {
  return {
    skills: names.map((name) => ({
      name,
      description: `${name} description`,
      files: ['SKILL.md'],
    })),
  };
}

function v2Index(entries: Array<{ name: string; digest: string }>): unknown {
  return {
    $schema: 'https://schemas.agentskills.io/discovery/0.2.0/schema.json',
    skills: entries.map((entry) => ({
      name: entry.name,
      type: 'skill-md',
      description: `${entry.name} description`,
      url: `${BASE_URL}/.well-known/skills/${entry.name}/SKILL.md`,
      digest: entry.digest,
    })),
  };
}

function stubWellKnownServer(
  index: unknown | null,
  contents: Record<string, string> = V1_CONTENTS
): ReturnType<typeof vi.fn> {
  const mock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/.well-known/agent-skills/index.json')) {
      return new Response(null, { status: 404 });
    }
    if (url.endsWith('/.well-known/skills/index.json')) {
      if (index === null) return new Response(null, { status: 404 });
      return Response.json(index);
    }
    const match = url.match(/\/\.well-known\/skills\/([^/]+)\/SKILL\.md$/);
    if (match && contents[match[1]!]) {
      return new Response(contents[match[1]!]);
    }
    return new Response(null, { status: 404 });
  });
  vi.stubGlobal('fetch', mock);
  return mock;
}

async function digestOf(name: string, contents = V1_CONTENTS): Promise<string> {
  stubWellKnownServer(v1Index(Object.keys(contents)), contents);
  const skills = await wellKnownProvider.fetchAllSkills(BASE_URL);
  const skill = skills.find((s) => s.installName === name);
  if (!skill) throw new Error(`fixture skill ${name} not fetched`);
  return computeWellKnownSkillDigest(skill);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('computeWellKnownSkillDigest', () => {
  it('passes through the v2 index digest when present', () => {
    const skill = {
      files: new Map([['SKILL.md', 'content']]),
      indexEntry: {
        name: 'x',
        type: 'skill-md',
        description: 'd',
        url: 'https://example.com/x',
        digest: 'sha256:abc',
      },
    } as unknown as WellKnownSkill;
    expect(computeWellKnownSkillDigest(skill)).toBe('sha256:abc');
  });

  it('hashes files deterministically for v1 entries', () => {
    const entry = { name: 'x', description: 'd', files: ['SKILL.md', 'notes.md'] };
    const forward = {
      files: new Map<string, string>([
        ['SKILL.md', 'root'],
        ['notes.md', 'notes'],
      ]),
      indexEntry: entry,
    } as unknown as WellKnownSkill;
    const reversed = {
      files: new Map<string, string>([
        ['notes.md', 'notes'],
        ['SKILL.md', 'root'],
      ]),
      indexEntry: entry,
    } as unknown as WellKnownSkill;
    expect(computeWellKnownSkillDigest(forward)).toBe(computeWellKnownSkillDigest(reversed));
    expect(computeWellKnownSkillDigest(forward)).toMatch(/^sha256:/);
  });

  it('changes when file contents change', () => {
    const entry = { name: 'x', description: 'd', files: ['SKILL.md'] };
    const one = {
      files: new Map([['SKILL.md', 'v1']]),
      indexEntry: entry,
    } as unknown as WellKnownSkill;
    const two = {
      files: new Map([['SKILL.md', 'v2']]),
      indexEntry: entry,
    } as unknown as WellKnownSkill;
    expect(computeWellKnownSkillDigest(one)).not.toBe(computeWellKnownSkillDigest(two));
  });
});

describe('checkWellKnownForUpdates', () => {
  it('returns error when no index is served', async () => {
    stubWellKnownServer(null);
    const result = await checkWellKnownForUpdates(BASE_URL, [
      { name: 'alpha-skill', digest: 'sha256:whatever' },
    ]);
    expect(result.status).toBe('error');
  });

  it('returns current when v1 content digests match', async () => {
    const items: WellKnownUpdateItem[] = [
      { name: 'alpha-skill', digest: await digestOf('alpha-skill') },
      { name: 'beta-skill', digest: await digestOf('beta-skill') },
    ];
    stubWellKnownServer(v1Index(['alpha-skill', 'beta-skill']));
    const result = await checkWellKnownForUpdates(BASE_URL, items);
    expect(result.status).toBe('current');
  });

  it('classifies changed skills when v1 content changes', async () => {
    const items: WellKnownUpdateItem[] = [
      { name: 'alpha-skill', digest: await digestOf('alpha-skill') },
      { name: 'beta-skill', digest: await digestOf('beta-skill') },
    ];
    const changedContents = {
      ...V1_CONTENTS,
      'alpha-skill': skillMd('alpha-skill', '# Alpha v2 CHANGED'),
    };
    stubWellKnownServer(v1Index(['alpha-skill', 'beta-skill']), changedContents);
    const result = await checkWellKnownForUpdates(BASE_URL, items);
    expect(result.status).toBe('changed');
    if (result.status !== 'changed') return;
    expect(result.changedSkills).toEqual(['alpha-skill']);
    expect(result.removedSkills).toEqual([]);
  });

  it('classifies skills removed from the index', async () => {
    const items: WellKnownUpdateItem[] = [
      { name: 'alpha-skill', digest: await digestOf('alpha-skill') },
      { name: 'beta-skill', digest: await digestOf('beta-skill') },
    ];
    stubWellKnownServer(v1Index(['alpha-skill']));
    const result = await checkWellKnownForUpdates(BASE_URL, items);
    expect(result.status).toBe('changed');
    if (result.status !== 'changed') return;
    expect(result.changedSkills).toEqual([]);
    expect(result.removedSkills).toEqual(['beta-skill']);
  });

  it('reports skills present upstream but not installed as new', async () => {
    const items: WellKnownUpdateItem[] = [
      { name: 'alpha-skill', digest: await digestOf('alpha-skill') },
    ];
    stubWellKnownServer(v1Index(['alpha-skill', 'beta-skill']));
    const result = await checkWellKnownForUpdates(BASE_URL, items);
    expect(result.status).toBe('current');
    if (result.status !== 'current') return;
    expect(result.newSkills).toEqual(['beta-skill']);
  });

  it('reports new skills alongside changes', async () => {
    const alphaDigest = await digestOf('alpha-skill');
    const changedContents = {
      ...V1_CONTENTS,
      'alpha-skill': skillMd('alpha-skill', '# Alpha v2 CHANGED'),
    };
    stubWellKnownServer(v1Index(['alpha-skill', 'beta-skill']), changedContents);
    const result = await checkWellKnownForUpdates(BASE_URL, [
      { name: 'alpha-skill', digest: alphaDigest },
    ]);
    expect(result.status).toBe('changed');
    if (result.status !== 'changed') return;
    expect(result.changedSkills).toEqual(['alpha-skill']);
    expect(result.newSkills).toEqual(['beta-skill']);
  });

  it('compares v2 digests without fetching skill files', async () => {
    const mock = stubWellKnownServer(
      v2Index([
        { name: 'alpha-skill', digest: DIGEST_A },
        { name: 'beta-skill', digest: DIGEST_B },
      ])
    );
    const result = await checkWellKnownForUpdates(BASE_URL, [
      { name: 'alpha-skill', digest: DIGEST_A },
      { name: 'beta-skill', digest: DIGEST_STALE },
    ]);
    expect(result.status).toBe('changed');
    if (result.status !== 'changed') return;
    expect(result.changedSkills).toEqual(['beta-skill']);
    const fetchedUrls = mock.mock.calls.map((call) => String(call[0]));
    expect(fetchedUrls.every((url) => !url.endsWith('/SKILL.md'))).toBe(true);
  });

  it('sends the update-check header on index fetches', async () => {
    const mock = stubWellKnownServer(v2Index([{ name: 'alpha-skill', digest: DIGEST_A }]));
    await checkWellKnownForUpdates(BASE_URL, [{ name: 'alpha-skill', digest: DIGEST_A }]);
    const indexCall = mock.mock.calls.find((call) =>
      String(call[0]).endsWith('/.well-known/skills/index.json')
    );
    expect(indexCall).toBeDefined();
    const init = indexCall![1] as RequestInit;
    expect(new Headers(init.headers).get('X-Skills-Update-Check')).toBe('1');
  });

  it('treats entries with missing digests as changed', async () => {
    stubWellKnownServer(v1Index(['alpha-skill']));
    const result = await checkWellKnownForUpdates(BASE_URL, [{ name: 'alpha-skill', digest: '' }]);
    expect(result.status).toBe('changed');
    if (result.status !== 'changed') return;
    expect(result.changedSkills).toEqual(['alpha-skill']);
  });

  it('marks every v1 index fetch and downloads only tracked skill files', async () => {
    const alphaDigest = await digestOf('alpha-skill');
    const mock = stubWellKnownServer(v1Index(['alpha-skill', 'beta-skill']));
    await checkWellKnownForUpdates(BASE_URL, [{ name: 'alpha-skill', digest: alphaDigest }]);
    const indexCalls = mock.mock.calls.filter((call) => String(call[0]).endsWith('/index.json'));
    expect(indexCalls.length).toBeGreaterThan(0);
    for (const call of indexCalls) {
      expect(new Headers((call[1] as RequestInit)?.headers).get('X-Skills-Update-Check')).toBe('1');
    }
    const fileCalls = mock.mock.calls
      .map((call) => String(call[0]))
      .filter((url) => url.endsWith('/SKILL.md'));
    expect(fileCalls).toEqual([`${BASE_URL}/.well-known/skills/alpha-skill/SKILL.md`]);
  });
});
