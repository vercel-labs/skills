import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fetchNotionPackDirectory,
  fetchNotionPacks,
  fetchNotionWorkspaceName,
  isNotionSource,
  parseNotionSkillUrl,
  prepareNotionPackSource,
  prepareNotionSkillSource,
  type NotionPack,
  type NtnRunner,
} from './notion-test.ts';
import { discoverSkills } from './skills.ts';

const cleanupDirs: string[] = [];

afterEach(() => {
  for (const dir of cleanupDirs.splice(0)) {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  }
});

function listResponse(
  results: unknown[],
  options: { hasMore?: boolean; nextCursor?: string | null } = {}
): string {
  return JSON.stringify({
    object: 'list',
    results,
    next_cursor: options.nextCursor ?? null,
    has_more: options.hasMore ?? false,
    type: 'plugin',
  });
}

function meResponse(workspaceName: unknown): string {
  return JSON.stringify({ object: 'user', type: 'bot', bot: { workspace_name: workspaceName } });
}

describe('Notion pack prototype', () => {
  it('uses only paginated ntn list calls and returns packs without fetching details', async () => {
    const runNtn = vi.fn<NtnRunner>(async (args) => {
      const cursor = args.find((arg) => arg.startsWith('start_cursor=='));
      if (!cursor) {
        return listResponse(
          [
            {
              id: '>tO?',
              name: 'Company-wide',
              description: '',
              version_id: 'a'.repeat(64),
            },
          ],
          { hasMore: true, nextCursor: 'next123' }
        );
      }

      return listResponse([
        {
          id: '6be44900-5769-4e54-ba7e-a6411285f214',
          name: 'Draft Skills',
          description: 'Draft plugin pack',
          version_id: 'b'.repeat(64),
        },
      ]);
    });

    const packs = await fetchNotionPacks({ runNtn });

    expect(packs.map((pack) => pack.name)).toEqual(['Company-wide', 'Draft Skills']);
    expect(runNtn).toHaveBeenCalledTimes(2);
    expect(runNtn).toHaveBeenNthCalledWith(1, [
      'api',
      '/v1/ai/plugins',
      'page_size==100',
      '--notion-version',
      '2026-03-11',
    ]);
    expect(runNtn).toHaveBeenNthCalledWith(2, [
      'api',
      '/v1/ai/plugins',
      'page_size==100',
      'start_cursor==next123',
      '--notion-version',
      '2026-03-11',
    ]);
    expect(runNtn.mock.calls.flat(2).join(' ')).not.toContain('/v1/ai/plugins/>tO?');
    expect(runNtn.mock.calls.flat(2).join(' ')).not.toContain(
      '/v1/ai/plugins/6be44900-5769-4e54-ba7e-a6411285f214'
    );
  });

  it('accepts omitted pack descriptions from the alpha API', async () => {
    const runNtn = vi.fn<NtnRunner>(async () =>
      listResponse([
        {
          id: '~R\\;',
          name: 'Product Design',
          version_id: 'a'.repeat(64),
        },
      ])
    );

    const packs = await fetchNotionPacks({ runNtn });

    expect(packs).toEqual([
      {
        id: '~R\\;',
        name: 'Product Design',
        description: '',
        version_id: 'a'.repeat(64),
      },
    ]);
  });

  it('percent-encodes opaque pack IDs for lazy directory lookup', async () => {
    const pack: NotionPack = {
      id: '>tO?',
      name: 'Company-wide',
      description: '',
      version_id: 'a'.repeat(64),
    };
    const runNtn = vi.fn<NtnRunner>(async () =>
      JSON.stringify({
        id: pack.id,
        version_id: pack.version_id,
        url: 'https://downloads.example/company-wide.tgz',
      })
    );

    const directory = await fetchNotionPackDirectory(pack, { runNtn });

    expect(directory.url).toBe('https://downloads.example/company-wide.tgz');
    expect(runNtn).toHaveBeenCalledWith([
      'api',
      '/v1/ai/plugins/%3EtO%3F',
      '--notion-version',
      '2026-03-11',
    ]);
  });

  it('stages selected packs as one grouped local install source', async () => {
    const pack: NotionPack = {
      id: '>tO?',
      name: 'Company-wide',
      description: '',
      version_id: 'a'.repeat(64),
    };
    const downloadTemp = mkdtempSync(join(tmpdir(), 'notion-pack-download-test-'));
    cleanupDirs.push(downloadTemp);
    const downloadRoot = join(downloadTemp, 'company-wide');
    const skillDir = join(downloadRoot, 'skills', 'write-update');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      '---\nname: write-update\ndescription: Write a company update\n---\n'
    );

    const runNtn = vi.fn<NtnRunner>(async (args) => {
      if (args[1] === '/v1/users/me') return meResponse('Acme HQ');
      if (args[1] === '/v1/ai/plugins') return listResponse([pack]);
      return JSON.stringify({
        id: pack.id,
        version_id: pack.version_id,
        url: 'https://downloads.example/company-wide.tgz',
      });
    });

    const prepared = await prepareNotionPackSource({
      yes: true,
      runNtn,
      download: vi.fn(async () => ({
        rootDir: downloadRoot,
        tempDir: downloadTemp,
        kind: 'archive' as const,
      })),
    });

    expect(prepared).not.toBeNull();
    cleanupDirs.push(prepared!.tempDir);
    const stagedSkills = await discoverSkills(prepared!.rootDir, undefined, { fullDepth: true });
    expect(
      stagedSkills.map((skill) => ({ name: skill.name, pluginName: skill.pluginName }))
    ).toEqual([{ name: 'write-update', pluginName: 'Company-wide' }]);
    expect(prepared).toMatchObject({ packCount: 1, skillCount: 1 });
    // list + workspace probe (in parallel), then the per-pack directory lookup
    expect(runNtn).toHaveBeenCalledTimes(3);
  });

  it('rejects invalid repeated pagination cursors', async () => {
    const runNtn = vi.fn<NtnRunner>(async () =>
      listResponse([], { hasMore: true, nextCursor: 'same123' })
    );

    await expect(fetchNotionPacks({ runNtn })).rejects.toThrow(
      'Notion Agent Plugins pagination returned an invalid cursor'
    );
    expect(runNtn).toHaveBeenCalledTimes(2);
  });

  it('reports invalid JSON returned by ntn', async () => {
    const runNtn = vi.fn<NtnRunner>(async () => 'not json');

    await expect(fetchNotionPacks({ runNtn })).rejects.toThrow(
      'ntn returned invalid JSON for the Notion packs list'
    );
  });

  it.each(['notion', 'NOTION'])('recognizes %s as a Notion source', (source) => {
    expect(isNotionSource(source)).toBe(true);
  });

  it.each([
    'notion-test',
    'https://www.notion.so/acme/Skills-123',
    'https://acme.notion.site/Skills-123',
    'notion.example',
    'https://example.com/notion',
    'owner/notion',
  ])('does not treat %s as a Notion source', (source) => {
    expect(isNotionSource(source)).toBe(false);
  });
});

describe('Notion single skill', () => {
  it.each([
    [
      'https://app.notion.com/p/notiondevs/Capture-meeting-decisions-c169bd0a546a45d48344ffacad25d763?source=copy_link',
      'c169bd0a-546a-45d4-8344-ffacad25d763',
    ],
    [
      'https://www.notion.so/Capture-meeting-decisions-c169bd0a546a45d48344ffacad25d763',
      'c169bd0a-546a-45d4-8344-ffacad25d763',
    ],
    [
      'https://notion.so/acme/c169bd0a-546a-45d4-8344-ffacad25d763',
      'c169bd0a-546a-45d4-8344-ffacad25d763',
    ],
  ])('extracts the page ID from %s', (source, expected) => {
    expect(parseNotionSkillUrl(source)).toBe(expected);
  });

  it.each([
    'notion',
    'vercel-labs/agent-skills',
    'https://github.com/vercel-labs/agent-skills',
    'https://notion.so/acme',
    'https://notion.example.com/p/c169bd0a546a45d48344ffacad25d763',
    './local-skill',
  ])('does not treat %s as a Notion skill URL', (source) => {
    expect(parseNotionSkillUrl(source)).toBeNull();
  });

  it('downloads the skill directory for a page ID as a local install source', async () => {
    const pageId = 'c169bd0a-546a-45d4-8344-ffacad25d763';
    const downloadTemp = mkdtempSync(join(tmpdir(), 'notion-skill-download-test-'));
    cleanupDirs.push(downloadTemp);
    const downloadRoot = join(downloadTemp, 'capture-meeting-decisions');
    mkdirSync(downloadRoot, { recursive: true });
    writeFileSync(
      join(downloadRoot, 'SKILL.md'),
      '---\nname: capture-meeting-decisions\ndescription: Capture decisions from meeting notes\n---\n'
    );

    const runNtn = vi.fn<NtnRunner>(async (args) =>
      args[1] === '/v1/users/me'
        ? meResponse('Acme HQ')
        : JSON.stringify({
            id: pageId,
            version_id: 'c'.repeat(64),
            url: 'https://downloads.example/capture-meeting-decisions.tgz',
          })
    );
    const download = vi.fn(async () => ({
      rootDir: downloadRoot,
      tempDir: downloadTemp,
      kind: 'archive' as const,
    }));

    const prepared = await prepareNotionSkillSource(pageId, { runNtn, download });

    expect(prepared).toEqual({ rootDir: downloadRoot, tempDir: downloadTemp });
    expect(runNtn).toHaveBeenCalledWith([
      'api',
      `/v1/ai/skills/${pageId}`,
      '--notion-version',
      '2026-03-11',
    ]);
    expect(download).toHaveBeenCalledWith(
      'https://downloads.example/capture-meeting-decisions.tgz'
    );
    const skills = await discoverSkills(prepared.rootDir);
    expect(skills.map((skill) => skill.name)).toEqual(['capture-meeting-decisions']);
  });

  it('reports invalid JSON returned by ntn for a skill', async () => {
    const runNtn = vi.fn<NtnRunner>(async () => 'not json');

    await expect(
      prepareNotionSkillSource('c169bd0a-546a-45d4-8344-ffacad25d763', { runNtn })
    ).rejects.toThrow(
      'ntn returned invalid JSON for Notion skill c169bd0a-546a-45d4-8344-ffacad25d763'
    );
  });
});

describe('Notion workspace reporting', () => {
  it('reads the workspace name from the authenticated ntn session', async () => {
    const runNtn = vi.fn<NtnRunner>(async () => meResponse('Notion Developers'));

    await expect(fetchNotionWorkspaceName({ runNtn })).resolves.toBe('Notion Developers');
    expect(runNtn).toHaveBeenCalledWith(['api', '/v1/users/me', '--notion-version', '2026-03-11']);
  });

  it.each([
    ['invalid JSON', async () => 'not json'],
    ['a missing bot field', async () => JSON.stringify({ object: 'user' })],
    ['a non-string workspace name', async () => meResponse(42)],
    [
      'an ntn failure',
      async () => {
        throw new Error('ntn api failed');
      },
    ],
  ])('returns null rather than throwing on %s', async (_label, impl) => {
    await expect(fetchNotionWorkspaceName({ runNtn: vi.fn<NtnRunner>(impl) })).resolves.toBeNull();
  });

  it('still installs a skill when the workspace lookup fails', async () => {
    const pageId = 'c169bd0a-546a-45d4-8344-ffacad25d763';
    const downloadTemp = mkdtempSync(join(tmpdir(), 'notion-skill-noworkspace-'));
    cleanupDirs.push(downloadTemp);
    const downloadRoot = join(downloadTemp, 'capture-meeting-decisions');
    mkdirSync(downloadRoot, { recursive: true });
    writeFileSync(join(downloadRoot, 'SKILL.md'), '---\nname: x\ndescription: y\n---\n');

    const runNtn = vi.fn<NtnRunner>(async (args) => {
      if (args[1] === '/v1/users/me') throw new Error('workspace probe exploded');
      return JSON.stringify({
        id: pageId,
        version_id: 'c'.repeat(64),
        url: 'https://downloads.example/x.tgz',
      });
    });

    await expect(
      prepareNotionSkillSource(pageId, {
        runNtn,
        download: vi.fn(async () => ({
          rootDir: downloadRoot,
          tempDir: downloadTemp,
          kind: 'archive' as const,
        })),
      })
    ).resolves.toEqual({ rootDir: downloadRoot, tempDir: downloadTemp });
  });
});
