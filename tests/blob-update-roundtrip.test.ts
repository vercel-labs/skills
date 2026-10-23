// Adapted from AndreaCovelli's MIT-licensed nested-snapshot tests in PR #1867:
// https://github.com/vercel-labs/skills/blob/b7a01432d034827e044a5c9a636509123529872a/tests/blob-project-lock-hash.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

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
  fetchAuditData: vi.fn().mockResolvedValue(null),
}));

vi.mock('../src/detect-agent.ts', () => ({
  detectAgent: vi.fn().mockResolvedValue({ isAgent: false, agent: { name: 'none' } }),
  getAgentType: vi.fn(),
  ensureUniversalAgents: vi.fn((agents: string[]) => agents),
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

vi.mock('node:child_process', async (importActual) => ({
  ...(await importActual<typeof import('node:child_process')>()),
  spawnSync: vi.fn().mockReturnValue({ status: 0 }),
}));

import { installFromSource, runAdd } from '../src/add.ts';
import { resetRepoTreeAuthState } from '../src/blob.ts';
import { cloneRepo } from '../src/git.ts';
import { parseSource } from '../src/source-parser.ts';
import { updateProjectSkills } from '../src/update.ts';

const SKILL_MD = '---\nname: example\ndescription: Example skill\n---\n# Example\n';

describe('nested snapshot installation followed by project update', () => {
  let base: string;
  let repo: string;
  let originalCwd: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    resetRepoTreeAuthState();
    base = await mkdtemp(join(tmpdir(), 'blob-update-roundtrip-'));
    repo = join(base, 'repo');
    const project = join(base, 'project');
    await mkdir(project);
    originalCwd = process.cwd();
    process.chdir(project);
    vi.stubEnv('DISABLE_TELEMETRY', '1');
    vi.stubEnv('XDG_STATE_HOME', join(base, 'state'));
    vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit called');
    }) as never);
    vi.mocked(cloneRepo).mockResolvedValue(repo);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    await rm(base, { recursive: true, force: true });
  });

  it.each(['add', 'restore'] as const)(
    'skips unchanged %s installs twice but detects a supporting-file change',
    async (command) => {
      const skillPath = 'skills/example/SKILL.md';
      const supportingPath = 'skills/example/references/guide.md';
      const files = [
        { path: 'SKILL.md', contents: SKILL_MD },
        { path: 'references/guide.md', contents: '# Guide\n' },
      ];
      for (const file of files) {
        const path = join(repo, 'skills/example', file.path);
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, file.contents, 'utf-8');
      }

      const fetchMock = vi.fn(async (input: string | URL) => {
        const url = String(input);
        if (url.includes('/git/trees/')) {
          return Response.json({
            sha: 'tree-sha',
            tree: [skillPath, supportingPath].map((path) => ({ path, type: 'blob', sha: path })),
          });
        }
        if (url.startsWith('https://raw.githubusercontent.com/')) return new Response(SKILL_MD);
        if (url.includes('/api/download/')) return Response.json({ hash: 'server-hash', files });
        throw new Error(`Unexpected request: ${url}`);
      });
      vi.stubGlobal('fetch', fetchMock);

      if (command === 'add') {
        await runAdd(['vercel-labs/hash-fixture'], {
          yes: true,
          agent: ['codex'],
          global: false,
          mode: 'copy',
        });
      } else {
        const result = await installFromSource(parseSource('vercel-labs/hash-fixture'), {
          skills: ['example'],
          agents: ['codex'],
        });
        expect(result).toEqual({ installed: ['example'], failed: [] });
      }
      expect(cloneRepo).not.toHaveBeenCalled();
      expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/api/download/'))).toBe(
        true
      );
      const lock = await readFile('skills-lock.json', 'utf-8');
      for (const file of files) {
        await expect(readFile(join('.agents/skills/example', file.path), 'utf-8')).resolves.toBe(
          file.contents
        );
      }

      for (let attempt = 0; attempt < 2; attempt++) {
        expect(await updateProjectSkills({ yes: true })).toEqual({
          successCount: 0,
          failCount: 0,
          foundCount: 1,
        });
        expect(spawnSync).not.toHaveBeenCalled();
        await expect(readFile('skills-lock.json', 'utf-8')).resolves.toBe(lock);
      }
      expect(cloneRepo).toHaveBeenCalledTimes(2);

      await writeFile(join(repo, supportingPath), '# Changed\n');
      expect(await updateProjectSkills({ yes: true })).toEqual({
        successCount: 1,
        failCount: 0,
        foundCount: 1,
      });
      // The reinstall subprocess is mocked; discovery, hashes and lock IO are real.
      expect(spawnSync).toHaveBeenCalledTimes(1);
      expect(vi.mocked(spawnSync).mock.calls[0]![1]).toEqual(
        expect.arrayContaining(['add', '--skill', 'example', '-y'])
      );
    }
  );
});
