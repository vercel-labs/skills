import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const { spinnerStart, spinnerStop, spinnerMessage } = vi.hoisted(() => ({
  spinnerStart: vi.fn(),
  spinnerStop: vi.fn(),
  spinnerMessage: vi.fn(),
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
      message: noop,
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
});
