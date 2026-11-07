import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import * as tar from 'tar';

vi.mock('../src/telemetry.ts', () => ({
  track: vi.fn(),
  setVersion: vi.fn(),
  fetchAuditData: vi.fn().mockResolvedValue(null),
}));

vi.mock('../src/detect-agent.ts', () => ({
  detectAgent: vi.fn().mockResolvedValue({ isAgent: false, agent: { name: 'none' } }),
  getAgentType: vi.fn(),
  ensureUniversalAgents: vi.fn((agents: string[]) => agents),
}));

import { runAdd } from '../src/add.ts';
import { runUpdate } from '../src/update.ts';
import { runInstallFromLock } from '../src/install.ts';

const SKILL_URL = 'https://downloads.example.com/skills/alpha.md';
const ARCHIVE_URL = 'https://downloads.example.com/skills/pack.tgz';

function skillMd(name: string, body = name): string {
  return `---\nname: ${name}\ndescription: ${name}\n---\n\n# ${body}\n`;
}

describe('direct downloads in the lock', () => {
  let root: string;
  let project: string;
  let originalCwd: string;
  /** What each URL serves; anything else is a 404. */
  let served: Map<string, Uint8Array | string>;
  let output: string[];

  function packArchive(files: Record<string, string>): Uint8Array {
    const src = join(root, `archive-${Math.random().toString(36).slice(2)}`);
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(join(src, 'pack', path, '..'), { recursive: true });
      writeFileSync(join(src, 'pack', path), content);
    }
    const file = join(src, 'pack.tgz');
    tar.c({ gzip: true, file, cwd: src, sync: true }, ['pack']);
    return new Uint8Array(readFileSync(file));
  }

  const lock = () => JSON.parse(readFileSync(join(project, 'skills-lock.json'), 'utf-8'));
  const installed = (name: string) =>
    readFileSync(join(project, '.agents', 'skills', name, 'SKILL.md'), 'utf-8');

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'download-lock-'));
    project = join(root, 'project');
    mkdirSync(join(project, '.agents'), { recursive: true });
    vi.stubEnv('HOME', join(root, 'home'));
    vi.stubEnv('USERPROFILE', join(root, 'home'));
    vi.stubEnv('XDG_STATE_HOME', join(root, 'home', 'state'));
    vi.stubEnv('XDG_CONFIG_HOME', join(root, 'home', 'config'));
    originalCwd = process.cwd();
    process.chdir(project);
    process.exitCode = undefined;

    served = new Map();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const body = served.get(String(url));
      if (body === undefined) return new Response('not found', { status: 404 });
      return new Response(body, { status: 200 });
    });
    output = [];
    vi.spyOn(console, 'log').mockImplementation((...args) => void output.push(args.join(' ')));
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    process.exitCode = undefined;
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
  });

  const add = (url: string, extra: Parameters<typeof runAdd>[1] = {}) =>
    runAdd([url], { yes: true, agent: ['codex'], global: false, ...extra });

  it('locks a raw SKILL.md URL so update can download it again', async () => {
    served.set(SKILL_URL, skillMd('alpha', 'v1'));
    await add(SKILL_URL);

    const entry = lock().skills.alpha;
    expect(entry).toMatchObject({
      source: SKILL_URL,
      sourceUrl: SKILL_URL,
      sourceType: 'download',
      skillPath: 'SKILL.md',
    });
    expect(entry.computedHash).toMatch(/^[0-9a-f]{64}$/);

    await runUpdate(['-p', '-y']);
    expect(output.join('\n')).toContain('All project skills are up to date');

    served.set(SKILL_URL, skillMd('alpha', 'v2'));
    output = [];
    await runUpdate(['-p'], 'check');
    expect(output.join('\n')).toContain('alpha has an update');
    expect(process.exitCode).toBe(1);
    expect(installed('alpha')).toContain('# v1');

    process.exitCode = undefined;
    await runUpdate(['-p', '-y']);
    expect(installed('alpha')).toContain('# v2');
    expect(lock().skills.alpha.computedHash).not.toBe(entry.computedHash);
    expect(process.exitCode).toBeUndefined();
  });

  it('locks each skill of an archive by its path inside the archive', async () => {
    served.set(
      ARCHIVE_URL,
      packArchive({
        'skills/alpha/SKILL.md': skillMd('alpha'),
        'skills/beta/SKILL.md': skillMd('beta'),
      })
    );
    await add(ARCHIVE_URL, { skill: ['*'] });

    expect(lock().skills).toMatchObject({
      alpha: { sourceType: 'download', sourceUrl: ARCHIVE_URL, skillPath: 'skills/alpha/SKILL.md' },
      beta: { sourceType: 'download', sourceUrl: ARCHIVE_URL, skillPath: 'skills/beta/SKILL.md' },
    });
  });

  it('restores a downloaded skill whose folder is gone', async () => {
    served.set(SKILL_URL, skillMd('alpha'));
    await add(SKILL_URL);
    const locked = readFileSync(join(project, 'skills-lock.json'), 'utf-8');
    await rm(join(project, '.agents', 'skills', 'alpha'), { recursive: true });

    await runInstallFromLock([]);

    expect(installed('alpha')).toContain('# alpha');
    expect(readFileSync(join(project, 'skills-lock.json'), 'utf-8')).toBe(locked);
    expect(process.exitCode).toBeUndefined();
  });

  it('reports a download that no longer serves the locked skill', async () => {
    served.set(SKILL_URL, skillMd('alpha'));
    await add(SKILL_URL);
    served.set(SKILL_URL, skillMd('renamed'));

    await runUpdate(['-p', '-y']);

    expect(output.join('\n')).toContain('alpha is no longer in this download');
    expect(process.exitCode).toBe(1);
  });

  it('does not lock a URL with a query string, which may carry a signature', async () => {
    const signed = `${SKILL_URL}?x-amz-signature=secret`;
    served.set(signed, skillMd('alpha'));
    const warnings: string[] = [];
    vi.spyOn(console, 'warn').mockImplementation((...args) => void warnings.push(args.join(' ')));

    await add(signed);

    expect(installed('alpha')).toContain('# alpha');
    expect(existsSync(join(project, 'skills-lock.json'))).toBe(false);
    expect(warnings.join('\n')).toContain('Not recording alpha in the lock file');
    expect(warnings.join('\n')).not.toContain('x-amz-signature');
  });

  it('locks a global download by its folder hash', async () => {
    served.set(SKILL_URL, skillMd('alpha', 'v1'));
    await add(SKILL_URL, { global: true });

    const globalLock = JSON.parse(
      readFileSync(join(root, 'home', 'state', 'skills', '.skill-lock.json'), 'utf-8')
    );
    expect(globalLock.skills.alpha).toMatchObject({
      source: SKILL_URL,
      sourceUrl: SKILL_URL,
      sourceType: 'download',
      skillPath: 'SKILL.md',
      skillFolderHash: expect.stringMatching(/^[0-9a-f]{64}$/),
    });

    served.set(SKILL_URL, skillMd('alpha', 'v2'));
    await runUpdate(['-g', '-y']);
    expect(output.join('\n')).toContain('Updated alpha');
    expect(
      readFileSync(join(root, 'home', '.agents', 'skills', 'alpha', 'SKILL.md'), 'utf-8')
    ).toContain('# v2');
  });
});
