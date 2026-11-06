import { createServer, type Server } from 'node:http';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { delimiter, dirname, join } from 'node:path';
import * as tar from 'tar';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { Sandbox, entries, readSkill } from './sandbox.ts';

/**
 * Notion installs go through the Notion CLI (`ntn api ...`), which needs a logged-in
 * workspace. Here `ntn` is a stub on PATH that answers the same API routes and
 * logs every call, and archive URLs point at a local server. Everything after
 * `ntn` (download, extraction, pack manifest, install, lock) is the real package.
 */

const PAGE_ID = '0123456789abcdef0123456789abcdef';
const PAGE_UUID = '01234567-89ab-cdef-0123-456789abcdef';
const PAGE_URL = `https://www.notion.so/acme/Release-Notes-Skill-${PAGE_ID}`;

const FAKE_NTN = `#!/usr/bin/env node
const { appendFileSync, readFileSync } = require('node:fs');
const args = process.argv.slice(2);
appendFileSync(process.env.FAKE_NTN_LOG, JSON.stringify(args) + '\\n');
const routes = JSON.parse(readFileSync(process.env.FAKE_NTN_ROUTES, 'utf8'));
const route = routes[args[1]];
if (args[0] !== 'api' || route === undefined) {
  process.stderr.write('unknown route ' + args.join(' ') + '\\n');
  process.exit(1);
}
if (route.fail) {
  process.stderr.write(route.fail + '\\n');
  process.exit(1);
}
process.stdout.write(JSON.stringify(route));
`;

function skillMd(name: string, description: string): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n\nE2E fixture.\n`;
}

let server: Server;
let baseUrl: string;
let fixtures: string;

async function buildArchive(name: string, files: Record<string, string>): Promise<void> {
  const top = name.replace(/\.tgz$/, '');
  for (const [path, content] of Object.entries(files)) {
    const full = join(fixtures, 'src', top, path);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, content);
  }
  await tar.c({ gzip: true, file: join(fixtures, 'www', name), cwd: join(fixtures, 'src') }, [top]);
}

beforeAll(async () => {
  fixtures = join(inject('e2eRoot'), 'notion-fixtures');
  await mkdir(join(fixtures, 'www'), { recursive: true });
  await buildArchive('team-pack.tgz', {
    'skills/notion-alpha/SKILL.md': skillMd('notion-alpha', 'Alpha skill from a Notion pack'),
    'skills/notion-beta/SKILL.md': skillMd('notion-beta', 'Beta skill from a Notion pack'),
    'skills/notion-beta/reference.md': '# Reference\n',
  });
  await buildArchive('other-pack.tgz', {
    'skills/notion-gamma/SKILL.md': skillMd('notion-gamma', 'Gamma skill from another pack'),
  });
  await buildArchive('page-skill.tgz', {
    'SKILL.md': skillMd('release-notes', 'Write release notes from a Notion page'),
    'examples/sample.md': '# Sample\n',
  });

  server = createServer(async (req, res) => {
    try {
      const body = await readFile(join(fixtures, 'www', (req.url ?? '/').slice(1)));
      res.writeHead(200, { 'content-type': 'application/gzip', 'content-length': body.length });
      res.end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

interface NotionSandbox {
  sandbox: Sandbox;
  env: Record<string, string>;
  calls: () => string[][];
}

async function notionSandbox(routes?: Record<string, unknown>): Promise<NotionSandbox> {
  const sandbox = await Sandbox.create('notion');
  const bin = join(sandbox.root, 'bin');
  await mkdir(bin);
  await writeFile(join(bin, 'ntn'), FAKE_NTN);
  await chmod(join(bin, 'ntn'), 0o755);

  const packs = [
    { id: 'pack-team', name: 'Team Pack', description: 'Shared team skills', version_id: 'v1' },
    { id: 'pack-other', name: 'Other Pack', description: 'Unrelated skills', version_id: 'v7' },
  ];
  const routesFile = join(sandbox.root, 'ntn-routes.json');
  await writeFile(
    routesFile,
    JSON.stringify(
      routes ?? {
        '/v1/users/me': { object: 'user', bot: { workspace_name: 'Acme E2E' } },
        '/v1/ai/plugins': { results: packs, next_cursor: null, has_more: false },
        '/v1/ai/plugins/pack-team': {
          id: 'pack-team',
          version_id: 'v1',
          url: `${baseUrl}/team-pack.tgz`,
        },
        '/v1/ai/plugins/pack-other': {
          id: 'pack-other',
          version_id: 'v7',
          url: `${baseUrl}/other-pack.tgz`,
        },
        [`/v1/ai/skills/${PAGE_UUID}`]: {
          id: PAGE_UUID,
          version_id: 'p1',
          url: `${baseUrl}/page-skill.tgz`,
        },
      }
    )
  );

  const log = join(sandbox.root, 'ntn-calls.log');
  await writeFile(log, '');
  const env = {
    PATH: `${bin}${delimiter}${process.env.PATH ?? ''}`,
    FAKE_NTN_ROUTES: routesFile,
    FAKE_NTN_LOG: log,
    // The archive server is local even when the host routes traffic through a proxy.
    NO_PROXY: ['127.0.0.1', 'localhost', process.env.NO_PROXY].filter(Boolean).join(','),
    no_proxy: ['127.0.0.1', 'localhost', process.env.no_proxy].filter(Boolean).join(','),
  };
  const calls = () =>
    readFileSync(log, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as string[]);
  return { sandbox, env, calls };
}

describe.skipIf(process.platform === 'win32')('notion', () => {
  it('lists packs from the authenticated workspace', async () => {
    const { sandbox, env, calls } = await notionSandbox();
    const result = await sandbox.skills(['add', 'notion', '--list'], { env });
    expect(result.output).toContain('Acme E2E');
    expect(result.output).toContain('Team Pack');
    expect(result.output).toContain('Other Pack');
    expect(entries(sandbox.project)).toEqual([]);

    const listCall = calls().find((args) => args[1] === '/v1/ai/plugins');
    expect(listCall).toEqual(expect.arrayContaining(['api', 'page_size==100', '--notion-version']));
  });

  it('installs a selected pack and removes its skills', async () => {
    const { sandbox, env, calls } = await notionSandbox();
    await sandbox.skills(['add', 'notion', '--skill', 'team-pack', '-a', 'claude-code', '-y'], {
      env,
    });

    expect(readSkill(sandbox.path('.claude', 'skills', 'notion-alpha')).name).toBe('notion-alpha');
    const beta = sandbox.path('.claude', 'skills', 'notion-beta');
    expect(readSkill(beta).name).toBe('notion-beta');
    expect(existsSync(join(beta, 'reference.md'))).toBe(true);
    // Unselected packs are never fetched.
    expect(existsSync(sandbox.path('.claude', 'skills', 'notion-gamma'))).toBe(false);
    expect(calls().some((args) => args[1] === '/v1/ai/plugins/pack-other')).toBe(false);

    await sandbox.skills(['remove', 'notion-alpha', 'notion-beta', '-y'], { env });
    expect(entries(sandbox.path('.claude', 'skills'))).toEqual([]);
  });

  it('installs every pack non-interactively with -y', async () => {
    const { sandbox, env } = await notionSandbox();
    await sandbox.skills(['add', 'notion', '-a', 'codex', '-y'], { env });
    expect(entries(sandbox.path('.agents', 'skills'))).toEqual([
      'notion-alpha',
      'notion-beta',
      'notion-gamma',
    ]);
  });

  it('installs a single skill from a Notion page URL', async () => {
    const { sandbox, env, calls } = await notionSandbox();
    await sandbox.skills(['add', PAGE_URL, '-a', 'claude-code', '-y'], { env });

    const dir = sandbox.path('.claude', 'skills', 'release-notes');
    expect(readSkill(dir).name).toBe('release-notes');
    expect(existsSync(join(dir, 'examples', 'sample.md'))).toBe(true);
    expect(calls().map((args) => args[1])).toContain(`/v1/ai/skills/${PAGE_UUID}`);
  });

  it('locks Notion installs so update and restore fetch them through ntn again', async () => {
    const { sandbox, env, calls } = await notionSandbox();
    await sandbox.skills(['add', 'notion', '--skill', 'team-pack', '-a', 'codex', '-y'], { env });
    await sandbox.skills(['add', PAGE_URL, '-a', 'codex', '-y'], { env });

    const lock = JSON.parse(readFileSync(sandbox.path('skills-lock.json'), 'utf8'));
    expect(lock.skills['notion-alpha']).toMatchObject({
      source: 'notion',
      sourceType: 'download',
      sourceUrl: 'notion://packs/pack-team',
      skillPath: 'skills/notion-alpha/SKILL.md',
    });
    expect(lock.skills['release-notes']).toMatchObject({
      sourceType: 'download',
      sourceUrl: `https://www.notion.so/${PAGE_ID}`,
      skillPath: 'SKILL.md',
    });

    const update = await sandbox.skills(['update', '-p', '-y'], { env });
    expect(update.output).toContain('All project skills are up to date');

    // Delete the folders but keep the lock, as after a fresh clone.
    const before = calls().length;
    rmSync(sandbox.path('.agents', 'skills', 'notion-beta'), { recursive: true, force: true });
    rmSync(sandbox.path('.agents', 'skills', 'release-notes'), { recursive: true, force: true });
    await sandbox.skills(['experimental_install'], { env });
    expect(readSkill(sandbox.path('.agents', 'skills', 'notion-beta')).name).toBe('notion-beta');
    expect(readSkill(sandbox.path('.agents', 'skills', 'release-notes')).name).toBe(
      'release-notes'
    );
    const restoreRoutes = calls()
      .slice(before)
      .map((args) => args[1]);
    expect(restoreRoutes).toContain('/v1/ai/plugins/pack-team');
    expect(restoreRoutes).toContain(`/v1/ai/skills/${PAGE_UUID}`);
  });

  it('surfaces ntn failures without installing anything', async () => {
    const { sandbox, env } = await notionSandbox({
      '/v1/users/me': { fail: 'not logged in' },
      '/v1/ai/plugins': { fail: 'Unauthorized: run ntn login' },
    });
    const result = await sandbox.skills(['add', 'notion', '-y'], { env, check: false });
    expect(result.code).not.toBe(0);
    expect(result.output).toContain('Unauthorized: run ntn login');
    expect(entries(sandbox.project)).toEqual([]);
  });

  it('explains how to get ntn when it is not installed', async () => {
    const sandbox = await Sandbox.create('notion-missing');
    const result = await sandbox.skills(['add', 'notion', '--list'], {
      env: { PATH: dirname(process.execPath) },
      check: false,
    });
    expect(result.output).toContain('Notion CLI (ntn) is required');
    expect(result.output).toContain('ntn login');
  });
});
