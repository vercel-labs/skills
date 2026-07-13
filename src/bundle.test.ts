import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { join } from 'path';
import { tmpdir } from 'os';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { runCli } from './test-utils.ts';
import { normalizeBundleManifest, runBundle } from './bundle.ts';
import { resolveSkillsByPath } from './skills.ts';
import { runAdd } from './add.ts';

// Stub only runAdd so the install flow can be driven in-process; keep the rest
// of add.ts (parseAddOptions etc.) real.
vi.mock('./add.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./add.ts')>();
  return { ...actual, runAdd: vi.fn(async () => {}) };
});

// The subprocess CLI tests shell out to `node cli.ts`; ensure TypeScript is
// stripped regardless of the local Node version.
const STRIP = { NODE_OPTIONS: '--experimental-strip-types --no-warnings' };

describe('normalizeBundleManifest', () => {
  it('parses a valid manifest', () => {
    const manifest = normalizeBundleManifest(
      {
        name: 'pbi-to-pr-loop',
        version: '0.2.0',
        description: 'desc',
        skills: ['skills/community/write-plan', 'skills/community/review-plan'],
      },
      'ref'
    );
    expect(manifest.name).toBe('pbi-to-pr-loop');
    expect(manifest.version).toBe('0.2.0');
    expect(manifest.skills).toHaveLength(2);
  });

  it('normalizes trailing slashes on skill paths', () => {
    const manifest = normalizeBundleManifest(
      { name: 'b', skills: ['skills/community/write-plan/'] },
      'ref'
    );
    expect(manifest.skills).toEqual(['skills/community/write-plan']);
  });

  it('throws when name is missing', () => {
    expect(() => normalizeBundleManifest({ skills: ['a/b'] }, 'ref')).toThrow(/name/);
  });

  it('throws when skills is empty or not a string list', () => {
    expect(() => normalizeBundleManifest({ name: 'b', skills: [] }, 'ref')).toThrow(/skills/);
    expect(() => normalizeBundleManifest({ name: 'b', skills: [1, 2] }, 'ref')).toThrow(/skills/);
    expect(() => normalizeBundleManifest({ name: 'b' }, 'ref')).toThrow(/skills/);
  });

  it('throws when the top level is not a mapping', () => {
    expect(() => normalizeBundleManifest('nope', 'ref')).toThrow(/mapping/);
  });

  // Co-location: a bundle may only point at paths inside its own repo.
  it('rejects absolute and traversing skill paths', () => {
    expect(() => normalizeBundleManifest({ name: 'b', skills: ['/etc/skills'] }, 'ref')).toThrow(
      /repo-relative/
    );
    expect(() =>
      normalizeBundleManifest({ name: 'b', skills: ['../other-repo/skills/x'] }, 'ref')
    ).toThrow(/repo-relative/);
    expect(() =>
      normalizeBundleManifest({ name: 'b', skills: ['skills/../../escape'] }, 'ref')
    ).toThrow(/repo-relative/);
  });
});

describe('resolveSkillsByPath', () => {
  const writeSkill = (root: string, rel: string, name: string) => {
    const dir = join(root, rel);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'SKILL.md'),
      `---\nname: ${name}\ndescription: test skill ${name}\n---\nBody.\n`
    );
  };

  let root: string;

  beforeEach(() => {
    root = join(tmpdir(), `skills-bundle-resolve-${process.pid}-${Date.now()}`);
    mkdirSync(root, { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('resolves skills by exact repo-relative path, not by name', async () => {
    writeSkill(root, 'skills/golden/deploy', 'deploy');
    // A same-named skill elsewhere in the repo must NOT be picked up.
    writeSkill(root, 'skills/community/deploy', 'deploy-community');

    const skills = await resolveSkillsByPath(root, ['skills/golden/deploy']);
    expect(skills).toHaveLength(1);
    expect(skills[0]!.name).toBe('deploy');
    expect(skills[0]!.path).toBe(join(root, 'skills/golden/deploy'));
  });

  it('dedupes repeated paths', async () => {
    writeSkill(root, 'skills/golden/foo', 'foo');
    const skills = await resolveSkillsByPath(root, ['skills/golden/foo', 'skills/golden/foo/']);
    expect(skills).toHaveLength(1);
  });

  it('throws with all missing paths listed (co-location enforcement)', async () => {
    writeSkill(root, 'skills/golden/foo', 'foo');
    await expect(
      resolveSkillsByPath(root, ['skills/golden/foo', 'skills/golden/nope', 'skills/gone'])
    ).rejects.toThrow(/skills\/golden\/nope, skills\/gone/);
  });

  it('throws on paths escaping the repository', async () => {
    await expect(resolveSkillsByPath(root, ['../outside'])).rejects.toThrow(/relative paths/);
    await expect(resolveSkillsByPath(root, ['/absolute'])).rejects.toThrow(/relative paths/);
  });
});

describe('bundle install wiring', () => {
  const yamlBody = [
    'name: pbi-to-pr-loop',
    'version: 0.2.0',
    'description: A test bundle',
    'skills:',
    '  - skills/community/write-plan',
    '  - skills/community/review-plan',
  ].join('\n');

  beforeEach(() => {
    vi.mocked(runAdd).mockClear();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, status: 200, text: async () => yamlBody }) as Response)
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches bundles/<name>/bundle.yaml and delegates to runAdd with exact skill paths', async () => {
    await runBundle(['install', 'vercel-labs/skills@pbi-to-pr-loop']);

    const fetchMock = vi.mocked(fetch);
    expect(String(fetchMock.mock.calls[0]![0])).toContain(
      '/contents/bundles/pbi-to-pr-loop/bundle.yaml'
    );

    expect(runAdd).toHaveBeenCalledTimes(1);
    const [sourceArg, optionsArg] = vi.mocked(runAdd).mock.calls[0]!;
    expect(sourceArg).toEqual(['vercel-labs/skills']);
    expect(optionsArg).toMatchObject({
      skillPaths: ['skills/community/write-plan', 'skills/community/review-plan'],
      bundleName: 'pbi-to-pr-loop',
    });
    // Resolution is by coordinate — no name-based skill filter may be passed.
    expect(optionsArg).not.toHaveProperty('skill');
  });
});

describe('bundle command dispatch', () => {
  it('shows help with no subcommand', () => {
    const result = runCli(['bundle'], undefined, STRIP);
    expect(result.stdout).toContain('bundle <subcommand>');
    expect(result.stdout).toContain('install');
  });

  it('errors on an unknown subcommand', () => {
    const result = runCli(['bundle', 'frobnicate'], undefined, STRIP);
    expect(result.stderr + result.stdout).toContain('Unknown bundle subcommand');
    expect(result.exitCode).toBe(1);
  });

  it('errors when install is given no source', () => {
    const result = runCli(['bundle', 'install'], undefined, STRIP);
    expect(result.stderr + result.stdout).toContain('Missing bundle source');
    expect(result.exitCode).toBe(1);
  });

  it('errors when install source has no @bundle-name', () => {
    const result = runCli(['bundle', 'install', 'org/repo'], undefined, STRIP);
    expect(result.stderr + result.stdout).toContain('bundle name');
    expect(result.exitCode).toBe(1);
  });

  it('reports no bundles installed in an empty project', () => {
    const dir = join(tmpdir(), `skills-bundle-test-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    try {
      const result = runCli(['bundle', 'list'], dir, STRIP);
      expect(result.stdout).toContain('No bundles installed');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // A bundle installed at project scope records its `bundleName` in the local
  // skills-lock.json, and `bundle list` must find it there — not only in the
  // global lock.
  it('lists a project-scoped bundle from the local lock', () => {
    const dir = join(tmpdir(), `skills-bundle-local-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    try {
      const localLock = {
        version: 1,
        skills: {
          'write-plan': {
            source: 'vercel-labs/skills',
            sourceType: 'github',
            computedHash: 'abc123',
            bundleName: 'pbi-to-pr-loop',
          },
        },
      };
      writeFileSync(join(dir, 'skills-lock.json'), JSON.stringify(localLock, null, 2));
      const result = runCli(['bundle', 'list'], dir, STRIP);
      expect(result.stdout).toContain('pbi-to-pr-loop');
      expect(result.stdout).toContain('write-plan');
      expect(result.stdout).not.toContain('No bundles installed');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
