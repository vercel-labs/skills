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

vi.mock('picocolors', () => {
  const id = (s: string) => s;
  const colors = [
    'red',
    'green',
    'blue',
    'yellow',
    'cyan',
    'white',
    'black',
    'dim',
    'bold',
    'bgRed',
    'bgCyan',
    'bgBlack',
    'bgWhite',
    'underline',
    'inverse',
    'magenta',
    'gray',
    'reset',
  ];
  const obj: any = id;
  for (const c of colors) obj[c] = id;
  return { default: obj };
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

// NOTE: do NOT mock ../src/agents.ts. installer.installSkillForAgent relies on the
// real `agents` map (e.g. codex.skillsDir / globalSkillsDir); a stubbed map with only
// `displayName` makes getAgentBaseDir() do join(baseDir, undefined) and throws
// "The \"path\" argument must be of type string. Received undefined". We pass
// `agent: ['codex']` to runAdd so the detectInstalledAgents() branch is skipped anyway.

// Keep parseSource/getOwnerRepo real, but stub the only network call (isRepoPrivate)
// so the test runs offline.
vi.mock('../src/source-parser.ts', async (importActual) => {
  const actual = await importActual<typeof import('../src/source-parser.ts')>();
  return {
    ...actual,
    isRepoPrivate: vi.fn().mockResolvedValue(false),
  };
});

// Simulate a GitHub clone without touching the network: cloneRepo returns a local
// fixture directory. cleanupTempDir is a no-op so we control teardown ourselves.
vi.mock('../src/git.ts', () => ({
  cloneRepo: vi.fn(),
  cleanupTempDir: vi.fn().mockResolvedValue(undefined),
}));

import { runAdd } from '../src/add.ts';
import { cloneRepo } from '../src/git.ts';
import * as installer from '../src/installer.ts';

describe('root-level disk install (issue #1603)', () => {
  let base: string;
  let fixture: string; // a fake cloned repo (SKILL.md at the repo root)
  let project: string; // install target cwd
  let origCwd: string;
  let spy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), 'root-disk-'));
    fixture = join(base, 'fixture-repo');
    await mkdir(fixture, { recursive: true });
    await writeFile(
      join(fixture, 'SKILL.md'),
      '---\nname: myrootskill\ndescription: root level skill\n---\n',
      'utf-8'
    );
    await mkdir(join(fixture, 'scripts'), { recursive: true });
    await writeFile(join(fixture, 'scripts', 'check-deps.mjs'), 'console.log("x")\n', 'utf-8');
    await mkdir(join(fixture, 'references'), { recursive: true });
    await writeFile(join(fixture, 'references', 'guide.md'), '# guide\n', 'utf-8');

    project = join(base, 'project');
    await mkdir(project, { recursive: true });
    origCwd = process.cwd();
    process.chdir(project);

    // Drive the GitHub-clone code path (tempDir === skill.path) without network.
    vi.mocked(cloneRepo).mockResolvedValue(fixture);

    spy = vi.spyOn(installer, 'installSkillForAgent');
    vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit called');
    }) as never);
  });

  afterEach(async () => {
    process.chdir(origCwd);
    await rm(base, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('installs the full directory (scripts/ + references/) for a root-level SKILL.md repo', async () => {
    // A github-style source goes through cloneRepo + discoverSkills(tempDir),
    // where skill.path === tempDir. This is exactly the branch that dropped the
    // supporting files before the fix (see issue #1603).
    await runAdd(['someowner/somerepo'], {
      yes: true,
      agent: ['codex'],
      global: false,
      mode: 'copy',
    });

    // The disk-based install path must be used (not the blob single-file path).
    expect(spy).toHaveBeenCalled();

    const installed = join(project, '.agents', 'skills', 'myrootskill');
    await expect(readFile(join(installed, 'SKILL.md'), 'utf-8')).resolves.toContain('myrootskill');
    // Regression for #1603: supporting files must NOT be dropped.
    await expect(readFile(join(installed, 'scripts', 'check-deps.mjs'), 'utf-8')).resolves.toBe(
      'console.log("x")\n'
    );
    await expect(readFile(join(installed, 'references', 'guide.md'), 'utf-8')).resolves.toBe(
      '# guide\n'
    );
  });
});
