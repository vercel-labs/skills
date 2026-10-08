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
// fixture directory.
vi.mock('../src/git.ts', () => ({
  cloneRepo: vi.fn(),
  cleanupTempDir: vi.fn().mockResolvedValue(undefined),
}));

import { runAdd } from '../src/add.ts';
import { cloneRepo } from '../src/git.ts';

async function makeRootSkill(root: string, scriptContents: string): Promise<void> {
  await mkdir(join(root, 'scripts'), { recursive: true });
  await writeFile(
    join(root, 'SKILL.md'),
    '---\nname: myrootskill\ndescription: root level skill\n---\n',
    'utf-8'
  );
  await writeFile(join(root, 'scripts', 'check-deps.mjs'), scriptContents, 'utf-8');
  await mkdir(join(root, 'references'), { recursive: true });
  await writeFile(join(root, 'references', 'guide.md'), '# guide\n', 'utf-8');
}

async function readLockHash(project: string, name: string): Promise<string> {
  const raw = await readFile(join(project, 'skills-lock.json'), 'utf-8');
  const j = JSON.parse(raw) as { skills: Record<string, { computedHash: string }> };
  return j.skills[name].computedHash;
}

describe('root-level lock hash covers the whole directory (issue #1603)', () => {
  let base: string;
  let origCwd: string;

  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), 'root-hash-'));
    origCwd = process.cwd();
    vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit called');
    }) as never);
  });

  afterEach(async () => {
    process.chdir(origCwd);
    await rm(base, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('changing a supporting file (scripts/) changes the computed lock hash', async () => {
    // Two repos that differ ONLY in a supporting file (scripts/check-deps.mjs).
    // SKILL.md and references/ are byte-identical. Before the fix, the lock hash used
    // computeSingleFileSkillHash(SKILL.md contents), so both repos hashed the same
    // and `skills update` could never detect a script change. After the fix it uses
    // computeSkillFolderHash(skill.path), which includes scripts/, so the two hashes
    // MUST differ.
    const fa = join(base, 'fa');
    await mkdir(fa, { recursive: true });
    await makeRootSkill(fa, 'console.log("v1")\n');
    const fb = join(base, 'fb');
    await mkdir(fb, { recursive: true });
    await makeRootSkill(fb, 'console.log("v2")\n');

    const pa = join(base, 'pa');
    await mkdir(pa, { recursive: true });
    const pb = join(base, 'pb');
    await mkdir(pb, { recursive: true });

    // Install repo A -> capture lock hash.
    process.chdir(pa);
    vi.mocked(cloneRepo).mockResolvedValue(fa);
    await runAdd(['owner/repo-a'], { yes: true, agent: ['codex'], global: false, mode: 'copy' });
    const hashA = await readLockHash(pa, 'myrootskill');

    // Install repo B (identical SKILL.md, different script) -> capture lock hash.
    process.chdir(pb);
    vi.mocked(cloneRepo).mockResolvedValue(fb);
    await runAdd(['owner/repo-b'], { yes: true, agent: ['codex'], global: false, mode: 'copy' });
    const hashB = await readLockHash(pb, 'myrootskill');

    // Core regression: the directory hash must change when a supporting file changes,
    // otherwise `skills update` cannot detect upstream script updates.
    expect(hashA).not.toBe(hashB);
  });
});
