import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const { spinnerStart, spinnerStop, spinnerMessage, logMessage } = vi.hoisted(() => ({
  spinnerStart: vi.fn(),
  spinnerStop: vi.fn(),
  spinnerMessage: vi.fn(),
  logMessage: vi.fn(),
}));

vi.mock('@clack/prompts', () => {
  const noop = () => {};
  return {
    intro: noop,
    outro: noop,
    note: noop,
    cancel: noop,
    log: {
      info: noop,
      message: logMessage,
      warn: noop,
      error: noop,
      step: noop,
      success: noop,
    },
    spinner: () => ({ start: spinnerStart, stop: spinnerStop, message: spinnerMessage }),
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

vi.mock('../src/source-parser.ts', async (importActual) => {
  const actual = await importActual<typeof import('../src/source-parser.ts')>();
  return {
    ...actual,
    isRepoPrivate: vi.fn().mockResolvedValue(false),
    lookupGitHubRepo: vi.fn().mockResolvedValue({ private: false, fullName: null }),
  };
});

vi.mock('../src/git.ts', async (importActual) => {
  const actual = await importActual<typeof import('../src/git.ts')>();
  return {
    ...actual,
    cloneRepo: vi.fn(),
    cleanupTempDir: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock('../src/blob.ts', async (importActual) => {
  const actual = await importActual<typeof import('../src/blob.ts')>();
  return {
    ...actual,
    tryBlobInstall: vi.fn().mockResolvedValue(null),
  };
});

import { runAdd } from '../src/add.ts';
import { cloneRepo } from '../src/git.ts';
import { tryBlobInstall } from '../src/blob.ts';

describe('blob clone fallback output', () => {
  let base: string;
  let fixture: string;
  let project: string;
  let originalCwd: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    base = await mkdtemp(join(tmpdir(), 'blob-fallback-'));
    fixture = join(base, 'fixture');
    project = join(base, 'project');
    await mkdir(join(fixture, 'skill'), { recursive: true });
    await mkdir(project, { recursive: true });
    await writeFile(
      join(fixture, 'skill', 'SKILL.md'),
      '---\nname: fallback-skill\ndescription: Clone fallback fixture\n---\n'
    );
    vi.mocked(cloneRepo).mockResolvedValue(fixture);
    originalCwd = process.cwd();
    process.chdir(project);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await rm(base, { recursive: true, force: true });
  });

  it('silently falls back to cloning when the blob fast path is unavailable', async () => {
    await runAdd(['remotion-dev/skills'], {
      yes: true,
      agent: ['codex'],
      global: false,
      mode: 'copy',
    });

    expect(tryBlobInstall).toHaveBeenCalled();
    expect(cloneRepo).toHaveBeenCalled();
    expect(spinnerStop).not.toHaveBeenCalledWith('Falling back to clone…');
    expect(spinnerMessage).toHaveBeenCalledWith('Cloning repository…');
    expect(spinnerStop).toHaveBeenCalledWith('Repository cloned');
  });

  describe('when the fast path reports why it failed', () => {
    const report = (reason: 'rate-limited' | 'tree-unavailable') =>
      vi.mocked(tryBlobInstall).mockImplementationOnce(async (_ownerRepo, options) => {
        options?.onFallback?.({ reason });
        return null;
      });

    const add = (extra: { json?: boolean } = {}) =>
      runAdd(['remotion-dev/skills'], {
        yes: true,
        agent: ['codex'],
        global: false,
        mode: 'copy',
        ...extra,
      });

    it('tells the user about a GitHub rate limit and still clones', async () => {
      vi.stubEnv('GITHUB_TOKEN', '');
      vi.stubEnv('GH_TOKEN', '');
      report('rate-limited');

      try {
        await add();
      } finally {
        vi.unstubAllEnvs();
      }

      expect(spinnerStop).toHaveBeenCalledWith(expect.stringContaining('rate limit'));
      expect(logMessage).toHaveBeenCalledWith(expect.stringContaining('GITHUB_TOKEN'));
      expect(spinnerStart).toHaveBeenCalledWith('Cloning repository…');
      expect(cloneRepo).toHaveBeenCalled();
      expect(spinnerStop).toHaveBeenCalledWith('Repository cloned');
    });

    it('skips the auth tip when a GitHub token is already set', async () => {
      vi.stubEnv('GITHUB_TOKEN', 'ghp_test');
      report('rate-limited');

      try {
        await add();
      } finally {
        vi.unstubAllEnvs();
      }

      expect(spinnerStop).toHaveBeenCalledWith(expect.stringContaining('rate limit'));
      expect(logMessage).not.toHaveBeenCalledWith(expect.stringContaining('GITHUB_TOKEN'));
      expect(cloneRepo).toHaveBeenCalled();
    });

    it('stays silent when the tree is unavailable for another reason', async () => {
      report('tree-unavailable');

      await add();

      expect(spinnerStop).not.toHaveBeenCalledWith(expect.stringContaining('rate limit'));
      expect(logMessage).not.toHaveBeenCalledWith(expect.stringContaining('GITHUB_TOKEN'));
      expect(spinnerMessage).toHaveBeenCalledWith('Cloning repository…');
      expect(cloneRepo).toHaveBeenCalled();
    });

    describe('--json', () => {
      let log: ReturnType<typeof vi.spyOn>;

      const installedEntry = () => {
        const printed = log.mock.calls.map((call) => String(call[0]));
        const entries = JSON.parse(printed.at(-1)!) as Array<Record<string, unknown>>;
        return entries[0]!;
      };

      beforeEach(() => {
        log = vi.spyOn(console, 'log').mockImplementation(() => {});
      });

      afterEach(() => {
        log.mockRestore();
        process.exitCode = undefined;
      });

      it('records the fallback on the installed entry', async () => {
        report('rate-limited');

        await add({ json: true });

        expect(installedEntry()).toMatchObject({
          status: 'installed',
          fallback: { reason: 'rate-limited' },
        });
      });

      it('leaves fallback out when the fast path gave no reason', async () => {
        await add({ json: true });

        const entry = installedEntry();
        expect(entry).toMatchObject({ status: 'installed' });
        expect(entry).not.toHaveProperty('fallback');
      });
    });
  });
});
