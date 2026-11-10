import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Isolate side-effecting UI / network deps so runAdd can run headless in CI.
vi.mock('@clack/prompts', () => {
  const noop = () => {};
  return {
    intro: noop,
    outro: noop,
    note: noop,
    confirm: vi.fn().mockResolvedValue(true),
    cancel: noop,
    log: {
      info: noop,
      message: noop,
      warn: noop,
      error: (...a: unknown[]) => console.log('[clack.error]', ...a),
      step: noop,
      success: noop,
    },
    spinner: () => ({ start: noop, stop: noop }),
  };
});

vi.mock('../src/telemetry.ts', () => ({
  track: vi.fn(),
  setVersion: vi.fn(),
  fetchAuditData: vi.fn().mockResolvedValue(null),
}));

vi.mock('../src/detect-agent.ts', () => ({
  detectAgent: vi.fn().mockResolvedValue({ isAgent: false, agent: { name: 'none' } }),
  getAgentType: vi.fn(),
  ensureUniversalAgents: vi.fn((x: string[]) => x),
}));

// Keep parsing real; stub only the GitHub API lookup so the test runs offline.
vi.mock('../src/source-parser.ts', async (importActual) => {
  const actual = await importActual<typeof import('../src/source-parser.ts')>();
  return {
    ...actual,
    lookupGitHubRepo: vi.fn(),
  };
});

vi.mock('../src/git.ts', async (importActual) => ({
  ...(await importActual<typeof import('../src/git.ts')>()),
  cloneRepo: vi.fn(),
  cleanupTempDir: vi.fn().mockResolvedValue(undefined),
}));

import { runAdd } from '../src/add.ts';
import { resolveSource } from '../src/api/resolve.ts';
import { cloneRepo } from '../src/git.ts';
import { track } from '../src/telemetry.ts';
import {
  fetchGitHubRepoInfo,
  lookupGitHubRepo,
  parseSource,
  withCanonicalGitHubRepo,
} from '../src/source-parser.ts';

const renamed = { private: false, fullName: 'new-owner/new-repo' };

describe('withCanonicalGitHubRepo', () => {
  it('rewrites a renamed repo and keeps ref, subpath, and skill filter', () => {
    const parsed = parseSource('https://github.com/old-owner/old-repo/tree/v1/skills/a');
    expect(withCanonicalGitHubRepo(parsed, renamed.fullName)).toEqual({
      type: 'github',
      url: 'https://github.com/new-owner/new-repo.git',
      ref: 'v1',
      subpath: 'skills/a',
    });

    const filtered = parseSource('old-owner/old-repo@my-skill');
    expect(withCanonicalGitHubRepo(filtered, renamed.fullName)).toMatchObject({
      url: 'https://github.com/new-owner/new-repo.git',
      skillFilter: 'my-skill',
    });
  });

  it('keeps the source when the name is current or unknown', () => {
    const parsed = parseSource('new-owner/new-repo');
    expect(withCanonicalGitHubRepo(parsed, renamed.fullName)).toBe(parsed);
    expect(withCanonicalGitHubRepo(parsed, null)).toBe(parsed);
  });

  it('never rewrites non-GitHub.com sources', () => {
    const gitlab = parseSource('https://gitlab.com/old-owner/old-repo');
    expect(withCanonicalGitHubRepo(gitlab, renamed.fullName)).toBe(gitlab);
    const enterprise = parseSource('old-owner/old-repo', { githubHost: 'ghe.example.com' });
    expect(withCanonicalGitHubRepo(enterprise, renamed.fullName)).toBe(enterprise);
  });
});

describe('fetchGitHubRepoInfo', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the canonical name GitHub reports', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ private: false, full_name: 'new-owner/new-repo' }))
      );
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchGitHubRepoInfo('old-owner', 'old-repo')).resolves.toEqual(renamed);
    expect(fetchMock).toHaveBeenCalledWith('https://api.github.com/repos/old-owner/old-repo');
  });

  it('returns null when the repo is not visible', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 404 })));
    await expect(fetchGitHubRepoInfo('old-owner', 'old-repo')).resolves.toBeNull();
  });

  it('ignores a malformed full_name', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ private: true, full_name: '../x' })))
    );
    await expect(fetchGitHubRepoInfo('old-owner', 'old-repo')).resolves.toEqual({
      private: true,
      fullName: null,
    });
  });
});

describe('following a renamed GitHub repo', () => {
  let base: string;
  let origCwd: string;

  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), 'github-rename-'));
    origCwd = process.cwd();
    vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit called');
    }) as never);
  });

  async function makeRepo(): Promise<void> {
    const repo = join(base, 'repo');
    await mkdir(repo, { recursive: true });
    await writeFile(
      join(repo, 'SKILL.md'),
      '---\nname: renamed-skill\ndescription: test\n---\n',
      'utf-8'
    );
    vi.mocked(cloneRepo).mockResolvedValue(repo);
    vi.mocked(lookupGitHubRepo).mockResolvedValue(renamed);
  }

  afterEach(async () => {
    process.chdir(origCwd);
    await rm(base, { recursive: true, force: true });
    vi.restoreAllMocks();
    vi.mocked(track).mockClear();
  });

  it('locks and reports the canonical owner/repo', async () => {
    await makeRepo();
    const project = join(base, 'project');
    await mkdir(project, { recursive: true });
    process.chdir(project);
    await runAdd(['old-owner/old-repo'], {
      yes: true,
      agent: ['codex'],
      global: false,
      mode: 'copy',
    });

    const lock = JSON.parse(await readFile(join(project, 'skills-lock.json'), 'utf-8'));
    expect(lock.skills['renamed-skill'].source).toBe('new-owner/new-repo');
    expect(track).toHaveBeenCalledWith(expect.objectContaining({ source: 'new-owner/new-repo' }));
  });

  it('reports the canonical source from the API', async () => {
    await makeRepo();
    const handle = await resolveSource('old-owner/old-repo', { cwd: base });
    expect(handle.source.url).toBe('https://github.com/new-owner/new-repo.git');
    await handle.dispose();
  });
});
