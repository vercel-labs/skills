import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile, execSync } from 'node:child_process';

vi.mock('node:child_process', async (importActual) => {
  const actual = await importActual<typeof import('node:child_process')>();
  return {
    ...actual,
    execSync: vi.fn().mockReturnValue('ghp_stored_credential\n'),
    execFile: vi.fn((...args: unknown[]) => {
      const callback = args.at(-1) as (error: Error | null, stdout: string, stderr: string) => void;
      callback(Object.assign(new Error('gh api unavailable'), { code: 1 }), '', 'unavailable');
    }),
  };
});

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
      error: noop,
      step: noop,
      success: noop,
    },
    spinner: () => ({ start: noop, stop: noop }),
  };
});

vi.mock('../src/detect-agent.ts', () => ({
  detectAgent: vi.fn().mockResolvedValue({ isAgent: false, agent: { name: 'none' } }),
  getAgentType: vi.fn(),
  ensureUniversalAgents: vi.fn((agents: string[]) => agents),
}));

vi.mock('../src/git.ts', () => ({
  cloneRepo: vi.fn(),
  cleanupTempDir: vi.fn().mockResolvedValue(undefined),
}));

import { runAdd } from '../src/add.ts';
import { cloneRepo } from '../src/git.ts';

describe('private repository installs', () => {
  let base: string;
  let fixture: string;
  let project: string;
  let originalCwd: string;
  let originalGitHubToken: string | undefined;
  let originalGhToken: string | undefined;
  let originalDisableTelemetry: string | undefined;
  let originalDoNotTrack: string | undefined;

  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), 'private-repo-add-'));
    fixture = join(base, 'fixture');
    project = join(base, 'project');
    await mkdir(fixture, { recursive: true });
    await mkdir(project, { recursive: true });
    await writeFile(
      join(fixture, 'SKILL.md'),
      '---\nname: private-skill\ndescription: Private repository skill\n---\n',
      'utf-8'
    );

    originalCwd = process.cwd();
    process.chdir(project);
    originalGitHubToken = process.env.GITHUB_TOKEN;
    originalGhToken = process.env.GH_TOKEN;
    originalDisableTelemetry = process.env.DISABLE_TELEMETRY;
    originalDoNotTrack = process.env.DO_NOT_TRACK;
    delete process.env.GITHUB_TOKEN;
    delete process.env.GH_TOKEN;
    delete process.env.DO_NOT_TRACK;
    process.env.DISABLE_TELEMETRY = '1';

    vi.mocked(execSync).mockClear();
    vi.mocked(execFile).mockClear();
    vi.mocked(cloneRepo).mockResolvedValue(fixture);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('not found', { status: 404 }));
    vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit called');
    }) as never);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    if (originalGitHubToken === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = originalGitHubToken;
    if (originalGhToken === undefined) delete process.env.GH_TOKEN;
    else process.env.GH_TOKEN = originalGhToken;
    if (originalDisableTelemetry === undefined) delete process.env.DISABLE_TELEMETRY;
    else process.env.DISABLE_TELEMETRY = originalDisableTelemetry;
    if (originalDoNotTrack === undefined) delete process.env.DO_NOT_TRACK;
    else process.env.DO_NOT_TRACK = originalDoNotTrack;
    vi.restoreAllMocks();
    await rm(base, { recursive: true, force: true });
  });

  it('falls back to normal Git authentication without reading stored gh credentials', async () => {
    await runAdd(['vercel-labs/private-skills'], {
      yes: true,
      agent: ['codex'],
      global: false,
      mode: 'copy',
    });

    await expect(
      readFile(join(project, '.agents', 'skills', 'private-skill', 'SKILL.md'), 'utf-8')
    ).resolves.toContain('private-skill');
    expect(execSync).not.toHaveBeenCalled();
    expect(execFile).toHaveBeenCalled();
    for (const [file, args] of vi.mocked(execFile).mock.calls) {
      expect(file).toBe('gh');
      expect(args).toContain('api');
      expect(args).not.toContain('auth');
      expect(args).not.toContain('token');
    }
  });

  it('does not audit repository or skill names when telemetry is disabled', async () => {
    await runAdd(['git@github.com:company/private-skills.git'], {
      yes: true,
      agent: ['codex'],
      global: false,
      mode: 'copy',
    });

    const requestedUrls = vi.mocked(globalThis.fetch).mock.calls.map(([input]) => String(input));
    expect(requestedUrls.some((url) => url.startsWith('https://add-skill.vercel.sh/'))).toBe(false);
  });

  it('does not send identifiers for repositories whose visibility is unknown', async () => {
    delete process.env.DISABLE_TELEMETRY;

    await runAdd(['git@github.com:company/private-skills.git'], {
      yes: true,
      agent: ['codex'],
      global: false,
      mode: 'copy',
    });

    const requestedUrls = vi.mocked(globalThis.fetch).mock.calls.map(([input]) => String(input));
    expect(requestedUrls.some((url) => url.startsWith('https://add-skill.vercel.sh/'))).toBe(false);
  });

  it('installs from another Git host and preserves opted-in non-GitHub telemetry', async () => {
    delete process.env.DISABLE_TELEMETRY;
    const source = 'git@gitlab.com:company/platform/private-skills.git';

    await runAdd([source], {
      yes: true,
      agent: ['codex'],
      global: false,
      mode: 'copy',
    });

    expect(cloneRepo).toHaveBeenCalledWith(source, undefined);
    await expect(
      readFile(join(project, '.agents', 'skills', 'private-skill', 'SKILL.md'), 'utf-8')
    ).resolves.toContain('private-skill');

    const requestedUrls = vi.mocked(globalThis.fetch).mock.calls.map(([input]) => String(input));
    expect(requestedUrls.some((url) => url.startsWith('https://add-skill.vercel.sh/t?'))).toBe(
      true
    );
    expect(requestedUrls.some((url) => url.startsWith('https://add-skill.vercel.sh/audit?'))).toBe(
      false
    );
  });
});
