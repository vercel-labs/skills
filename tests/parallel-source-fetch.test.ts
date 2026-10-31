import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

vi.mock('@clack/prompts', () => {
  const noop = () => {};
  return {
    log: { info: noop, message: noop, warn: noop, error: noop, step: noop, success: noop },
    spinner: () => ({ start: noop, stop: noop, message: noop }),
  };
});

vi.mock('../src/telemetry.ts', () => ({
  track: vi.fn(),
  setVersion: vi.fn(),
  fetchAuditData: vi.fn().mockResolvedValue(null),
}));

// Each "clone" hands back a local fixture after a short delay so overlapping
// clones are observable through the in-flight counter.
vi.mock('../src/git.ts', () => ({
  cloneRepo: vi.fn(),
  cleanupTempDir: vi.fn().mockResolvedValue(undefined),
}));

// The suite itself runs in CI, where --frozen-lockfile would otherwise default on
vi.mock('../src/ci.ts', () => ({ isCI: () => false }));

import * as p from '@clack/prompts';
import { runInstallFromLock } from '../src/install.ts';
import { cloneRepo } from '../src/git.ts';
import { wellKnownProvider, type WellKnownSkill } from '../src/providers/index.ts';

const SOURCES = {
  alpha: 'https://git.example.com/acme/alpha.git',
  beta: 'https://git.example.com/acme/beta.git',
  wellKnown: 'https://skills.example.com',
};

const wellKnownSkill: WellKnownSkill = {
  name: 'gamma',
  installName: 'gamma',
  description: 'gamma skill',
  content: '---\nname: gamma\ndescription: gamma skill\n---\n',
  sourceUrl: `${SOURCES.wellKnown}/.well-known/agent-skills/gamma/SKILL.md`,
  files: new Map([['SKILL.md', '---\nname: gamma\ndescription: gamma skill\n---\n']]),
  indexEntry: { name: 'gamma', description: 'gamma skill', files: ['SKILL.md'] },
};

describe('skills install fetches sources in parallel', () => {
  let base: string;
  let origCwd: string;

  async function writeFixtureRepo(skill: string): Promise<string> {
    const repo = join(base, `${skill}-repo`);
    await mkdir(join(repo, 'skills', skill), { recursive: true });
    await writeFile(
      join(repo, 'skills', skill, 'SKILL.md'),
      `---\nname: ${skill}\ndescription: ${skill} skill\n---\n`
    );
    return repo;
  }

  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), 'parallel-fetch-'));
    const project = join(base, 'project');
    await mkdir(project, { recursive: true });
    await writeFile(
      join(project, 'skills-lock.json'),
      JSON.stringify({
        version: 1,
        skills: {
          alpha: {
            source: 'acme/alpha',
            sourceUrl: SOURCES.alpha,
            sourceType: 'git',
            computedHash: 'x',
          },
          beta: {
            source: 'acme/beta',
            sourceUrl: SOURCES.beta,
            sourceType: 'git',
            computedHash: 'x',
          },
          gamma: {
            source: 'skills.example.com',
            sourceUrl: SOURCES.wellKnown,
            sourceType: 'well-known',
            computedHash: 'x',
            wellKnownDigest: 'stale',
          },
        },
      })
    );
    vi.spyOn(wellKnownProvider, 'fetchAllSkills').mockResolvedValue([wellKnownSkill]);
    origCwd = process.cwd();
    process.chdir(project);
  });

  afterEach(async () => {
    process.chdir(origCwd);
    await rm(base, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('overlaps clones and still installs every skill', async () => {
    const fixtures = {
      [SOURCES.alpha]: await writeFixtureRepo('alpha'),
      [SOURCES.beta]: await writeFixtureRepo('beta'),
    };
    let inFlight = 0;
    let peak = 0;
    vi.mocked(cloneRepo).mockImplementation(async (url) => {
      peak = Math.max(peak, ++inFlight);
      await new Promise((resolve) => setTimeout(resolve, 20));
      inFlight--;
      return fixtures[url]!;
    });

    await runInstallFromLock([]);

    expect(peak).toBe(2);
    for (const skill of ['alpha', 'beta', 'gamma']) {
      await expect(
        readFile(join(process.cwd(), '.agents', 'skills', skill, 'SKILL.md'), 'utf-8')
      ).resolves.toContain(`name: ${skill}`);
    }
  });

  it('records the well-known digest so `update` can track the skill', async () => {
    const fixture = await writeFixtureRepo('alpha');
    vi.mocked(cloneRepo).mockResolvedValue(fixture);

    await runInstallFromLock([]);

    const lock = JSON.parse(await readFile(join(process.cwd(), 'skills-lock.json'), 'utf-8'));
    expect(lock.skills.gamma).toMatchObject({
      source: 'skills.example.com',
      sourceUrl: SOURCES.wellKnown,
      sourceType: 'well-known',
      wellKnownDigest: expect.stringMatching(/^sha256:/),
    });
    expect(lock.skills.gamma.computedHash).not.toBe('x');
  });

  it('installs the sources that succeeded when another clone fails', async () => {
    const beta = await writeFixtureRepo('beta');
    vi.mocked(cloneRepo).mockImplementation(async (url) => {
      if (url === SOURCES.alpha) throw new Error('clone failed');
      return beta;
    });

    await runInstallFromLock([]);

    await expect(
      readFile(join(process.cwd(), '.agents', 'skills', 'beta', 'SKILL.md'), 'utf-8')
    ).resolves.toContain('name: beta');
    expect(process.exitCode).toBe(1);
    process.exitCode = undefined;
  });

  it('verifies a well-known skill against the lock under --frozen-lockfile', async () => {
    const fixture = await writeFixtureRepo('alpha');
    vi.mocked(cloneRepo).mockResolvedValue(fixture);
    const errors = vi.spyOn(p.log, 'error');
    const before = await readFile(join(process.cwd(), 'skills-lock.json'), 'utf-8');

    await runInstallFromLock(['--frozen-lockfile']);

    expect(process.exitCode).toBe(1);
    process.exitCode = undefined;
    expect(errors.mock.calls.flat().join('\n')).toContain('gamma has changed');
    await expect(readFile(join(process.cwd(), 'skills-lock.json'), 'utf-8')).resolves.toBe(before);
  });
});
