/**
 * Tests for updating skills installed from marketplace remote plugin sources.
 *
 * Covers the warn-on-change trust model: updates re-resolve through the
 * marketplace manifest; a changed resolved source requires interactive consent
 * and is skipped (with a non-zero signal) in non-interactive mode.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  updateProjectSkills,
  getProjectSkillsForUpdate,
  checkRemotePluginEntries,
} from '../src/update.ts';
import * as git from '../src/git.ts';
import * as skills from '../src/skills.ts';
import * as localLock from '../src/local-lock.ts';
import * as pluginManifest from '../src/plugin-manifest.ts';
import * as remove from '../src/remove.ts';
import * as p from '@clack/prompts';
import { spawnSync } from 'child_process';

// Mock dependencies
vi.mock('../src/git.ts');
vi.mock('../src/skills.ts');
vi.mock('../src/blob.ts');
vi.mock('../src/local-lock.ts');
vi.mock('../src/skill-lock.ts');
vi.mock('../src/plugin-manifest.ts');
vi.mock('../src/remove.ts');
vi.mock('@clack/prompts');

// Mock fs so the CLI entrypoint and local marketplace paths "exist"
vi.mock('fs', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    existsSync: vi.fn().mockReturnValue(true),
  };
});

// Mock child_process to prevent actual command execution
vi.mock('child_process', () => ({
  spawnSync: vi.fn().mockReturnValue({ status: 0 }),
}));

const MARKETPLACE = 'company/skill-marketplace';
const DOMAIN_URL = 'git@gitlab.company.com:frontend-monorepo.git';
const DOMAIN_PATH = 'libs/design-system';
const SHA = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0';

/** Lock entry for a skill installed via a marketplace remote plugin */
function remoteLockEntry(overrides: Record<string, unknown> = {}) {
  return {
    source: MARKETPLACE,
    sourceType: 'github',
    computedHash: 'hash-1',
    resolvedFrom: {
      pluginName: 'ds-angular',
      url: DOMAIN_URL,
      path: DOMAIN_PATH,
      sha: SHA,
    },
    ...overrides,
  };
}

/** Manifest remote plugin entry matching remoteLockEntry() */
function manifestPlugin(overrides: Record<string, unknown> = {}) {
  return {
    name: 'ds-angular',
    description: 'Angular Design System skill',
    source: {
      source: 'git-subdir' as const,
      url: DOMAIN_URL,
      path: DOMAIN_PATH,
    },
    ...overrides,
  };
}

function mockManifest(remotePlugins: unknown[]) {
  vi.mocked(pluginManifest.parsePluginManifests).mockResolvedValue({
    localSearchDirs: [],
    remotePlugins: remotePlugins as never[],
    unsupportedPlugins: [],
    duplicatePluginNames: [],
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });

  // Defaults: clone succeeds, no skills discovered on disk, empty manifest
  vi.mocked(git.cloneRepo).mockResolvedValue('/tmp/marketplace-clone');
  vi.mocked(skills.discoverSkills).mockResolvedValue([]);
  mockManifest([]);
  vi.mocked(spawnSync).mockReturnValue({ status: 0 } as never);
});

describe('getProjectSkillsForUpdate with remote plugin entries', () => {
  it('includes local-sourced entries that have resolvedFrom', async () => {
    vi.mocked(localLock.readLocalLock).mockResolvedValue({
      version: 1,
      skills: {
        'ds-angular': remoteLockEntry({ source: '/path/to/marketplace', sourceType: 'local' }),
        'plain-local': {
          source: '/some/local/path',
          sourceType: 'local',
          computedHash: 'x',
        },
      },
    });

    const result = await getProjectSkillsForUpdate();
    const names = result.map((s) => s.name);

    // Marketplace remote plugin entries are updatable even from local marketplaces
    expect(names).toContain('ds-angular');
    // Plain local installs still aren't
    expect(names).not.toContain('plain-local');
  });
});

describe('checkRemotePluginEntries', () => {
  const entries = [{ name: 'ds-angular', entry: remoteLockEntry() as never }];

  it('marks entries updatable when the manifest source is unchanged', async () => {
    mockManifest([manifestPlugin()]);

    const result = await checkRemotePluginEntries(MARKETPLACE, entries, '/tmp/clone', {});

    expect(result.updatable).toEqual(['ds-angular']);
    expect(result.deleted).toEqual([]);
    expect(result.sourceChanged).toEqual([]);
  });

  it('marks entries deleted when the plugin is gone from the manifest', async () => {
    mockManifest([]);
    vi.mocked(p.confirm).mockResolvedValue(true);

    const result = await checkRemotePluginEntries(MARKETPLACE, entries, '/tmp/clone', {});

    expect(result.deleted).toEqual(['ds-angular']);
    expect(result.updatable).toEqual([]);
    // Interactive: removal offered and accepted
    expect(remove.removeCommand).toHaveBeenCalledWith(['ds-angular'], {
      yes: true,
      global: false,
    });
  });

  it('does not remove deleted skills in non-interactive mode', async () => {
    mockManifest([]);

    const result = await checkRemotePluginEntries(MARKETPLACE, entries, '/tmp/clone', {
      yes: true,
    });

    expect(result.deleted).toEqual(['ds-angular']);
    expect(remove.removeCommand).not.toHaveBeenCalled();
  });

  it('skips entries in non-interactive mode when the source url changed', async () => {
    mockManifest([
      manifestPlugin({
        source: { source: 'git-subdir', url: 'git@github.com:evil/repo.git', path: DOMAIN_PATH },
      }),
    ]);

    const result = await checkRemotePluginEntries(MARKETPLACE, entries, '/tmp/clone', {
      yes: true,
    });

    expect(result.sourceChanged).toEqual(['ds-angular']);
    expect(result.updatable).toEqual([]);
    // No consent prompt in non-interactive mode
    expect(p.confirm).not.toHaveBeenCalled();
  });

  it('treats a changed git-subdir path as a source change', async () => {
    mockManifest([
      manifestPlugin({
        source: { source: 'git-subdir', url: DOMAIN_URL, path: 'completely/other/path' },
      }),
    ]);

    const result = await checkRemotePluginEntries(MARKETPLACE, entries, '/tmp/clone', {
      yes: true,
    });

    expect(result.sourceChanged).toEqual(['ds-angular']);
  });

  it('updates after interactive consent to a source change', async () => {
    mockManifest([
      manifestPlugin({
        source: {
          source: 'git-subdir',
          url: 'git@gitlab.company.com:new-repo.git',
          path: DOMAIN_PATH,
        },
      }),
    ]);
    vi.mocked(p.confirm).mockResolvedValue(true);

    const result = await checkRemotePluginEntries(MARKETPLACE, entries, '/tmp/clone', {});

    expect(p.confirm).toHaveBeenCalled();
    expect(result.updatable).toEqual(['ds-angular']);
    expect(result.sourceChanged).toEqual([]);
  });

  it('skips after interactive decline of a source change', async () => {
    mockManifest([
      manifestPlugin({
        source: {
          source: 'git-subdir',
          url: 'git@gitlab.company.com:new-repo.git',
          path: DOMAIN_PATH,
        },
      }),
    ]);
    vi.mocked(p.confirm).mockResolvedValue(false);

    const result = await checkRemotePluginEntries(MARKETPLACE, entries, '/tmp/clone', {});

    expect(result.sourceChanged).toEqual(['ds-angular']);
    expect(result.updatable).toEqual([]);
  });

  // D1: a local skill appearing in the marketplace under the same name as an
  // installed remote-plugin skill flips the content source from the domain repo
  // to the marketplace-local skill — a remote→local source change, never silent.
  it('treats a local skill shadowing the installed remote-plugin skill as a source change', async () => {
    // The remote plugin is still declared (unchanged), but a local skill of the
    // same name has appeared in the marketplace and would now win in `add`.
    mockManifest([manifestPlugin()]);

    const result = await checkRemotePluginEntries(
      MARKETPLACE,
      entries,
      '/tmp/clone',
      { yes: true },
      ['ds-angular']
    );

    // Must be reported as a source change, not updatable. The fail-safe -y mode
    // skips it; it must never reinstall from the local skill silently.
    expect(result.sourceChanged).toEqual(['ds-angular']);
    expect(result.updatable).toEqual([]);
  });

  it('asks for consent when a local skill shadows the installed remote-plugin skill', async () => {
    mockManifest([manifestPlugin()]);
    vi.mocked(p.confirm).mockResolvedValue(false);

    const result = await checkRemotePluginEntries(MARKETPLACE, entries, '/tmp/clone', {}, [
      'ds-angular',
    ]);

    // Interactive: the remote→local switch is surfaced for consent
    expect(p.confirm).toHaveBeenCalled();
    expect(result.sourceChanged).toEqual(['ds-angular']);
    expect(result.updatable).toEqual([]);
  });

  it('does not flag a remote-plugin skill when no local skill shadows it', async () => {
    mockManifest([manifestPlugin()]);

    // Discovered local skills present, but none collides with the installed name
    const result = await checkRemotePluginEntries(MARKETPLACE, entries, '/tmp/clone', {}, [
      'some-other-local-skill',
    ]);

    expect(result.updatable).toEqual(['ds-angular']);
    expect(result.sourceChanged).toEqual([]);
  });
});

describe('updateProjectSkills with remote plugin entries', () => {
  it('reinstalls a remote-plugin skill via the marketplace when unchanged', async () => {
    vi.mocked(localLock.readLocalLock).mockResolvedValue({
      version: 1,
      skills: { 'ds-angular': remoteLockEntry() },
    });
    mockManifest([manifestPlugin()]);

    const result = await updateProjectSkills({ yes: true });

    expect(result.successCount).toBe(1);
    expect(result.sourceChangedCount).toBe(0);

    // Reinstall goes through the marketplace (source of record), not the domain repo
    const spawnCalls = vi.mocked(spawnSync).mock.calls;
    expect(spawnCalls.length).toBe(1);
    const args = spawnCalls[0]![1] as string[];
    expect(args).toContain('add');
    expect(args).toContain(MARKETPLACE);
    expect(args).toContain('--skill');
    expect(args).toContain('ds-angular');
    expect(args).not.toContain(DOMAIN_URL);
  });

  it('skips and counts source changes in non-interactive mode (fail-safe)', async () => {
    vi.mocked(localLock.readLocalLock).mockResolvedValue({
      version: 1,
      skills: { 'ds-angular': remoteLockEntry() },
    });
    mockManifest([
      manifestPlugin({
        source: { source: 'git-subdir', url: 'git@github.com:evil/repo.git', path: DOMAIN_PATH },
      }),
    ]);

    const result = await updateProjectSkills({ yes: true });

    // The redirected skill must NOT be reinstalled
    expect(vi.mocked(spawnSync)).not.toHaveBeenCalled();
    expect(result.successCount).toBe(0);
    expect(result.sourceChangedCount).toBe(1);
  });

  it('reads local marketplaces in place without cloning', async () => {
    vi.mocked(localLock.readLocalLock).mockResolvedValue({
      version: 1,
      skills: {
        'ds-angular': remoteLockEntry({ source: '/path/to/marketplace', sourceType: 'local' }),
      },
    });
    mockManifest([manifestPlugin()]);

    await updateProjectSkills({ yes: true });

    // Local marketplace: manifest read from the path, no git clone
    expect(git.cloneRepo).not.toHaveBeenCalled();
    expect(pluginManifest.parsePluginManifests).toHaveBeenCalledWith('/path/to/marketplace');
  });

  it('clones git marketplaces before checking the manifest', async () => {
    vi.mocked(localLock.readLocalLock).mockResolvedValue({
      version: 1,
      skills: { 'ds-angular': remoteLockEntry() },
    });
    mockManifest([manifestPlugin()]);

    await updateProjectSkills({ yes: true });

    expect(git.cloneRepo).toHaveBeenCalledWith(MARKETPLACE, undefined);
    expect(pluginManifest.parsePluginManifests).toHaveBeenCalledWith('/tmp/marketplace-clone');
  });

  it('leaves remote-plugin skills untouched when the manifest check fails', async () => {
    vi.mocked(localLock.readLocalLock).mockResolvedValue({
      version: 1,
      skills: { 'ds-angular': remoteLockEntry() },
    });
    vi.mocked(git.cloneRepo).mockRejectedValue(new Error('network down'));

    const result = await updateProjectSkills({ yes: true });

    // Fail-safe: no reinstall when we can't verify the manifest
    expect(vi.mocked(spawnSync)).not.toHaveBeenCalled();
    expect(result.successCount).toBe(0);
  });

  it('skips (fail-safe) when a local skill shadows the installed remote-plugin skill', async () => {
    vi.mocked(localLock.readLocalLock).mockResolvedValue({
      version: 1,
      skills: { 'ds-angular': remoteLockEntry() },
    });
    // The plugin is unchanged in the manifest, but the marketplace now also ships
    // a LOCAL skill named ds-angular which would win in `add` — a source change.
    mockManifest([manifestPlugin()]);
    vi.mocked(skills.discoverSkills).mockResolvedValue([
      {
        name: 'ds-angular',
        path: '/tmp/marketplace-clone/skills/ds-angular',
        description: 'Local override',
        rawContent: '',
      },
    ]);

    const result = await updateProjectSkills({ yes: true });

    // The redirected skill must NOT be reinstalled; it's counted as a source change
    expect(vi.mocked(spawnSync)).not.toHaveBeenCalled();
    expect(result.successCount).toBe(0);
    expect(result.sourceChangedCount).toBe(1);
  });

  it('updates regular and remote-plugin skills from the same marketplace', async () => {
    vi.mocked(localLock.readLocalLock).mockResolvedValue({
      version: 1,
      skills: {
        'ds-angular': remoteLockEntry(),
        'format-pr': {
          source: MARKETPLACE,
          sourceType: 'github',
          skillPath: 'skills/format-pr/SKILL.md',
          computedHash: 'hash-2',
        },
      },
    });
    mockManifest([manifestPlugin()]);
    // The regular skill is still present in the marketplace clone
    vi.mocked(skills.discoverSkills).mockResolvedValue([
      {
        name: 'format-pr',
        path: '/tmp/marketplace-clone/skills/format-pr',
        description: 'Format PRs',
        rawContent: '',
      },
    ]);

    const result = await updateProjectSkills({ yes: true });

    expect(result.successCount).toBe(2);
    // Both reinstalls go through the marketplace
    const spawnedSkills = vi
      .mocked(spawnSync)
      .mock.calls.map((c) => c[1] as string[])
      .map((args) => args[args.indexOf('--skill') + 1]);
    expect(spawnedSkills.sort()).toEqual(['ds-angular', 'format-pr']);
  });
});
