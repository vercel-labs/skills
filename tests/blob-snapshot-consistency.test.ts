import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { TreeEntry } from '../src/blob.ts';

// Keep the installer, locks, discovery, blob resolution and update checks real.
vi.mock('@clack/prompts', () => {
  const noop = () => {};
  return {
    intro: noop,
    outro: noop,
    note: noop,
    cancel: noop,
    log: { info: noop, message: noop, warn: noop, error: noop, step: noop, success: noop },
    spinner: () => ({ start: noop, stop: noop, message: noop }),
  };
});
vi.mock('../src/telemetry.ts', () => ({
  track: vi.fn(),
  setVersion: vi.fn(),
  setDetectedAgent: vi.fn(),
  fetchAuditData: vi.fn().mockResolvedValue(null),
}));
vi.mock('../src/detect-agent.ts', () => ({
  detectAgent: vi.fn().mockResolvedValue({ isAgent: false, agent: { name: 'none' } }),
  getAgentType: vi.fn(),
}));
vi.mock('../src/source-parser.ts', async (importActual) => ({
  ...(await importActual<typeof import('../src/source-parser.ts')>()),
  isRepoPrivate: vi.fn().mockResolvedValue(false),
}));
vi.mock('../src/git.ts', async (importActual) => ({
  ...(await importActual<typeof import('../src/git.ts')>()),
  cloneRepo: vi.fn(),
  cleanupTempDir: vi.fn().mockResolvedValue(undefined),
}));

const SKILL_MD =
  '---\nname: snapshot-test\ndescription: Snapshot consistency fixture\n---\n# Current\n';
const OLD_SKILL_MD = SKILL_MD.replace('# Current', '# Older');
const PREFIX = 'skills/snapshot-test/';
const SOURCE = 'vercel-labs/snapshot-test';
const REFERENCE = '# Current reference\n';

function blobSha(contents: string): string {
  // Ask Git itself so the fixtures do not share the implementation's hash helper.
  return execFileSync('git', ['hash-object', '--stdin'], {
    cwd: tmpdir(),
    input: contents,
    encoding: 'utf8',
  }).trim();
}

function blob(path: string, contents: string): TreeEntry {
  return { path, type: 'blob', sha: blobSha(contents) };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function mockSnapshot(
  entries: TreeEntry[],
  files: Array<{ path: string; contents: string }>,
  skillMd = SKILL_MD,
  rootHash = 'a'.repeat(40)
) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.startsWith('https://api.github.com/repos/')) {
        return jsonResponse({ sha: rootHash, tree: entries });
      }
      if (url.startsWith('https://raw.githubusercontent.com/')) {
        return new Response(skillMd, { status: 200 });
      }
      if (url.startsWith('https://skills.sh/api/download/')) {
        return jsonResponse({ files, hash: 'snapshot-content-hash' });
      }
      throw new Error(`Unexpected HTTP request: ${url}`);
    })
  );
}

describe('snapshot content matches the GitHub tree', () => {
  beforeEach(async () => {
    const { resetRepoTreeAuthState } = await import('../src/blob.ts');
    resetRepoTreeAuthState();
  });

  afterEach(() => vi.unstubAllGlobals());

  it('rejects a stale SKILL.md even when all expected paths are present', async () => {
    mockSnapshot(
      [blob(PREFIX + 'SKILL.md', SKILL_MD)],
      [{ path: 'SKILL.md', contents: OLD_SKILL_MD }]
    );
    const { tryBlobInstall } = await import('../src/blob.ts');
    await expect(tryBlobInstall(SOURCE)).resolves.toBeNull();
  });

  it('rejects stale supporting content when SKILL.md is unchanged', async () => {
    mockSnapshot(
      [blob(PREFIX + 'SKILL.md', SKILL_MD), blob(PREFIX + 'reference.md', REFERENCE)],
      [
        { path: 'SKILL.md', contents: SKILL_MD },
        { path: 'reference.md', contents: '# Older reference\n' },
      ]
    );
    const { tryBlobInstall } = await import('../src/blob.ts');
    await expect(tryBlobInstall(SOURCE)).resolves.toBeNull();
  });

  it('rejects files retained by a snapshot after they were deleted upstream', async () => {
    mockSnapshot(
      [blob(PREFIX + 'SKILL.md', SKILL_MD)],
      [
        { path: 'SKILL.md', contents: SKILL_MD },
        { path: 'removed-reference.md', contents: '# Deleted upstream\n' },
      ]
    );
    const { tryBlobInstall } = await import('../src/blob.ts');
    await expect(tryBlobInstall(SOURCE)).resolves.toBeNull();
  });

  it('accepts matching UTF-8 and empty supporting files without cloning', async () => {
    const unicode = '中文说明 🧩\n';
    mockSnapshot(
      [
        blob(PREFIX + 'SKILL.md', SKILL_MD),
        blob(PREFIX + 'reference.md', unicode),
        blob(PREFIX + 'empty.txt', ''),
      ],
      [
        { path: 'SKILL.md', contents: SKILL_MD },
        { path: 'reference.md', contents: unicode },
        { path: 'empty.txt', contents: '' },
      ]
    );
    const { tryBlobInstall } = await import('../src/blob.ts');
    const result = await tryBlobInstall(SOURCE);
    expect(result?.skills[0]?.files).toHaveLength(3);
    expect(result?.skills[0]?.snapshotHash).toBe('snapshot-content-hash');
  });

  it('rejects a stale root SKILL.md', async () => {
    mockSnapshot(
      [blob('SKILL.md', SKILL_MD), blob('package.json', '{}')],
      [
        { path: 'SKILL.md', contents: OLD_SKILL_MD },
        { path: 'package.json', contents: '{}' },
      ]
    );
    const { tryBlobInstall } = await import('../src/blob.ts');
    await expect(tryBlobInstall(SOURCE)).resolves.toBeNull();
  });

  it('validates only the installed SKILL.md for a root skill', async () => {
    mockSnapshot(
      [blob('SKILL.md', SKILL_MD), blob('package.json', '{"version":"new"}')],
      [
        { path: 'SKILL.md', contents: SKILL_MD },
        { path: 'package.json', contents: '{"version":"old"}' },
        { path: 'removed-source.ts', contents: 'unrelated old source' },
      ]
    );
    const { tryBlobInstall } = await import('../src/blob.ts');
    const result = await tryBlobInstall(SOURCE);
    expect(result?.skills[0]?.files).toEqual([{ path: 'SKILL.md', contents: SKILL_MD }]);
  });

  it('falls back when a root snapshot contains no SKILL.md', async () => {
    mockSnapshot([blob('SKILL.md', SKILL_MD)], [{ path: 'README.md', contents: '# README' }]);
    const { tryBlobInstall } = await import('../src/blob.ts');
    await expect(tryBlobInstall(SOURCE)).resolves.toBeNull();
  });

  it('does not require excluded files that the clone installer omits', async () => {
    mockSnapshot(
      [
        blob(PREFIX + 'SKILL.md', SKILL_MD),
        blob(PREFIX + 'metadata.json', '{}'),
        blob(PREFIX + '__pycache__/cache.pyc', 'excluded'),
      ],
      [{ path: 'SKILL.md', contents: SKILL_MD }]
    );
    const { tryBlobInstall } = await import('../src/blob.ts');
    await expect(tryBlobInstall(SOURCE)).resolves.not.toBeNull();
  });

  it('validates excluded files if the snapshot includes and installs them', async () => {
    mockSnapshot(
      [blob(PREFIX + 'SKILL.md', SKILL_MD), blob(PREFIX + 'metadata.json', '{"version":"new"}')],
      [
        { path: 'SKILL.md', contents: SKILL_MD },
        { path: 'metadata.json', contents: '{"version":"old"}' },
      ]
    );
    const { tryBlobInstall } = await import('../src/blob.ts');
    await expect(tryBlobInstall(SOURCE)).resolves.toBeNull();
  });

  it('rejects the entire fast path when one of several snapshots is stale', async () => {
    const secondMd = SKILL_MD.replace('snapshot-test', 'other-skill');
    const entries = [
      blob(PREFIX + 'SKILL.md', SKILL_MD),
      blob('skills/other-skill/SKILL.md', secondMd),
    ];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.includes('/git/trees/'))
          return jsonResponse({ sha: 'a'.repeat(40), tree: entries });
        if (url.startsWith('https://raw.githubusercontent.com/')) {
          return new Response(url.includes('/other-skill/') ? secondMd : SKILL_MD);
        }
        if (url.includes('/api/download/')) {
          return jsonResponse({
            hash: 'snapshot-content-hash',
            files: [
              {
                path: 'SKILL.md',
                contents: url.endsWith('/other-skill')
                  ? secondMd.replace('# Current', '# Older')
                  : SKILL_MD,
              },
            ],
          });
        }
        throw new Error(`Unexpected HTTP request: ${url}`);
      })
    );
    const { tryBlobInstall } = await import('../src/blob.ts');
    await expect(tryBlobInstall(SOURCE)).resolves.toBeNull();
  });
});

describe('global add and update with a lagging snapshot', () => {
  let base: string;
  let fixture: string;
  let testHome: string;
  let originalCwd: string;
  let rootHash: string;
  let folderHash: string;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    base = await mkdtemp(join(tmpdir(), 'blob-consistency-'));
    fixture = join(base, 'cloned-repo');
    testHome = join(base, 'home');
    await mkdir(join(fixture, PREFIX), { recursive: true });
    await mkdir(testHome, { recursive: true });
    await writeFile(join(fixture, PREFIX, 'SKILL.md'), SKILL_MD);
    await writeFile(join(fixture, PREFIX, 'reference.md'), REFERENCE);
    execFileSync('git', ['init', '--quiet', fixture]);
    execFileSync('git', ['-C', fixture, 'add', '.']);
    execFileSync('git', [
      '-C',
      fixture,
      '-c',
      'user.name=Test Fixture',
      '-c',
      'user.email=fixture@example.invalid',
      'commit',
      '--quiet',
      '-m',
      'Current skill fixture',
    ]);
    rootHash = execFileSync('git', ['-C', fixture, 'rev-parse', 'HEAD^{tree}'], {
      encoding: 'utf8',
    }).trim();
    folderHash = execFileSync('git', ['-C', fixture, 'rev-parse', 'HEAD:skills/snapshot-test'], {
      encoding: 'utf8',
    }).trim();
    vi.stubEnv('HOME', testHome);
    vi.stubEnv('USERPROFILE', testHome);
    vi.stubEnv('XDG_CONFIG_HOME', join(testHome, '.config'));
    vi.stubEnv('XDG_STATE_HOME', '');
    originalCwd = process.cwd();
    process.chdir(base);
    const { cloneRepo } = await import('../src/git.ts');
    vi.mocked(cloneRepo).mockResolvedValue(fixture);
    vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('Unexpected process.exit');
    }) as never);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    mockSnapshot(
      [
        { path: 'skills/snapshot-test', type: 'tree', sha: folderHash },
        blob(PREFIX + 'SKILL.md', SKILL_MD),
        blob(PREFIX + 'reference.md', REFERENCE),
      ],
      [
        { path: 'SKILL.md', contents: OLD_SKILL_MD },
        { path: 'reference.md', contents: '# Older reference\n' },
      ],
      SKILL_MD,
      rootHash
    );
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    await rm(base, { recursive: true, force: true });
  });

  it('installs current clone bytes before recording the current tree and reporting up to date', async () => {
    const { runAdd } = await import('../src/add.ts');
    const { runUpdate } = await import('../src/update.ts');
    const { readSkillLock } = await import('../src/skill-lock.ts');
    const { cloneRepo } = await import('../src/git.ts');
    await runAdd([SOURCE], { global: true, yes: true, agent: ['universal'], mode: 'symlink' });
    const installed = join(testHome, '.agents', 'skills', 'snapshot-test');
    const lock = await readSkillLock();
    expect(lock.skills['snapshot-test']?.skillFolderHash).toBe(folderHash);
    expect(lock.skills['snapshot-test']?.skillPath).toBe(PREFIX + 'SKILL.md');

    // Exercise the real update boundary before checking bytes: the old implementation
    // reports current here even though the installed snapshot still contains old files.
    await runUpdate(['--global', '--yes']);
    expect(vi.mocked(console.log).mock.calls.flat().join('\n')).toContain(
      'All global skills are up to date'
    );
    await expect(readFile(join(installed, 'SKILL.md'), 'utf8')).resolves.toBe(SKILL_MD);
    await expect(readFile(join(installed, 'reference.md'), 'utf8')).resolves.toBe(REFERENCE);
    expect(cloneRepo).toHaveBeenCalledTimes(1);
  });

  it('keeps a matching snapshot on the fast path', async () => {
    mockSnapshot(
      [
        { path: 'skills/snapshot-test', type: 'tree', sha: folderHash },
        blob(PREFIX + 'SKILL.md', SKILL_MD),
        blob(PREFIX + 'reference.md', REFERENCE),
      ],
      [
        { path: 'SKILL.md', contents: SKILL_MD },
        { path: 'reference.md', contents: REFERENCE },
      ],
      SKILL_MD,
      rootHash
    );
    const { runAdd } = await import('../src/add.ts');
    const { readSkillLock } = await import('../src/skill-lock.ts');
    const { cloneRepo } = await import('../src/git.ts');
    await runAdd([SOURCE], { global: true, yes: true, agent: ['universal'], mode: 'symlink' });
    const installed = join(testHome, '.agents', 'skills', 'snapshot-test');
    await expect(readFile(join(installed, 'SKILL.md'), 'utf8')).resolves.toBe(SKILL_MD);
    expect((await readSkillLock()).skills['snapshot-test']?.skillFolderHash).toBe(folderHash);
    expect(cloneRepo).not.toHaveBeenCalled();
  });

  it('does not install stale bytes or record a current lock when the clone fallback fails', async () => {
    const { cloneRepo } = await import('../src/git.ts');
    vi.mocked(cloneRepo).mockRejectedValue(new Error('Controlled clone failure'));
    const { runAdd } = await import('../src/add.ts');
    const { readSkillLock } = await import('../src/skill-lock.ts');
    await expect(
      runAdd([SOURCE], { global: true, yes: true, agent: ['universal'], mode: 'symlink' })
    ).rejects.toThrow('Unexpected process.exit');
    expect((await readSkillLock()).skills['snapshot-test']).toBeUndefined();
    await expect(
      readFile(join(testHome, '.agents', 'skills', 'snapshot-test', 'SKILL.md'), 'utf8')
    ).rejects.toThrow();
  });
});
