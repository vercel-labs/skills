/**
 * Tests for the remote plugin resolution engine.
 *
 * "Remote" repositories are local git repos addressed via file:// URLs,
 * so tests exercise real git clone/fetch/checkout without any network.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { pathToFileURL } from 'url';
import {
  toCloneUrl,
  resolveRemotePlugin,
  resolveRemotePlugins,
  getRemoteSourceHost,
  createRemotePlaceholder,
} from '../src/remote-plugin.ts';
import { GitCloneError, cloneRepoSparse } from '../src/git.ts';
import type { RemotePluginEntry } from '../src/types.ts';

const CLONE_TEST_TIMEOUT = 60_000;

let dirCounter = 0;

function git(cwd: string, command: string): string {
  return execSync(`git ${command}`, { cwd, stdio: 'pipe' }).toString().trim();
}

/** Create an empty git repository with test-friendly local config */
function createRepo(dir: string): void {
  mkdirSync(dir, { recursive: true });
  git(dir, 'init -q');
  git(dir, 'config user.email test@example.com');
  git(dir, 'config user.name Test');
  git(dir, 'config commit.gpgsign false');
}

/** Write a SKILL.md inside the repo at the given relative directory */
function writeSkill(repoDir: string, skillDirPath: string, name: string): void {
  const skillDir = join(repoDir, skillDirPath);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(
    join(skillDir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: Test skill ${name}\n---\n\n# ${name}\n`
  );
}

/** Stage and commit everything; returns the commit SHA */
function commitAll(repoDir: string, message = 'commit'): string {
  git(repoDir, 'add -A');
  git(repoDir, `commit -qm "${message}"`);
  return git(repoDir, 'rev-parse HEAD');
}

function repoUrl(repoDir: string): string {
  return pathToFileURL(repoDir).href;
}

describe('toCloneUrl', () => {
  it('converts github sources to https clone URLs', () => {
    expect(toCloneUrl({ source: 'github', repo: 'owner/repo' })).toBe(
      'https://github.com/owner/repo.git'
    );
  });

  it('passes url sources through unchanged', () => {
    expect(toCloneUrl({ source: 'url', url: 'https://gitlab.com/team/plugin.git' })).toBe(
      'https://gitlab.com/team/plugin.git'
    );
    expect(toCloneUrl({ source: 'url', url: 'git@gitlab.example.com:team/plugin.git' })).toBe(
      'git@gitlab.example.com:team/plugin.git'
    );
  });

  it('passes git-subdir full URLs through unchanged', () => {
    expect(
      toCloneUrl({
        source: 'git-subdir',
        url: 'git@gitlab.example.com:org/monorepo.git',
        path: 'libs/skills',
      })
    ).toBe('git@gitlab.example.com:org/monorepo.git');
  });

  it('expands git-subdir owner/repo shorthand to https clone URLs', () => {
    expect(toCloneUrl({ source: 'git-subdir', url: 'owner/monorepo', path: 'tools/plugin' })).toBe(
      'https://github.com/owner/monorepo.git'
    );
  });
});

describe('getRemoteSourceHost', () => {
  it('returns github.com for github sources', () => {
    expect(getRemoteSourceHost({ source: 'github', repo: 'owner/repo' })).toBe('github.com');
  });

  it('extracts the host from ssh-style git URLs', () => {
    expect(
      getRemoteSourceHost({
        source: 'git-subdir',
        url: 'git@gitlab.company.com:frontend-monorepo.git',
        path: 'libs/skills',
      })
    ).toBe('gitlab.company.com');
  });

  it('extracts the host from https URLs', () => {
    expect(getRemoteSourceHost({ source: 'url', url: 'https://gitlab.com/team/plugin.git' })).toBe(
      'gitlab.com'
    );
  });

  it('returns the repo directory name for file:// URLs', () => {
    expect(getRemoteSourceHost({ source: 'url', url: 'file:///tmp/fixtures/domain-repo' })).toBe(
      'domain-repo'
    );
  });
});

describe('createRemotePlaceholder', () => {
  const entry: RemotePluginEntry = {
    name: 'ds-angular',
    description: 'Angular Design System skill',
    source: {
      source: 'git-subdir',
      url: 'git@gitlab.company.com:frontend-monorepo.git',
      path: 'libs/shared/design-system/skills',
    },
  };

  it('keeps the selection hint short: host first, then the manifest description', () => {
    const placeholder = createRemotePlaceholder(entry);
    expect(placeholder.description).toBe('gitlab.company.com · Angular Design System skill');
    // The hint must never contain the full url+path — long hints wrap in narrow
    // terminals and corrupt the prompt rendering.
    expect(placeholder.description).not.toContain('frontend-monorepo');
    expect(placeholder.description).not.toContain('libs/shared');
  });

  it('falls back to a generic label when the entry has no description', () => {
    const placeholder = createRemotePlaceholder({ ...entry, description: undefined });
    expect(placeholder.description).toBe('gitlab.company.com · remote plugin');
  });
});

describe('resolveRemotePlugin', () => {
  let testDir: string;
  const clonePaths: string[] = [];

  beforeEach(() => {
    testDir = join(tmpdir(), `remote-resolution-test-${Date.now()}-${dirCounter++}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
    for (const path of clonePaths) {
      rmSync(path, { recursive: true, force: true });
    }
    clonePaths.length = 0;
  });

  it(
    'resolves a url source and discovers skills',
    async () => {
      const repoDir = join(testDir, 'origin');
      createRepo(repoDir);
      writeSkill(repoDir, 'skills/my-skill', 'my-skill');
      commitAll(repoDir);

      const entry: RemotePluginEntry = {
        name: 'my-plugin',
        source: { source: 'url', url: repoUrl(repoDir) },
      };

      const resolved = await resolveRemotePlugin(entry);
      clonePaths.push(resolved.clonePath);

      expect(resolved.skills).toHaveLength(1);
      expect(resolved.skills[0].name).toBe('my-skill');
      expect(existsSync(join(resolved.skills[0].path, 'SKILL.md'))).toBe(true);
    },
    CLONE_TEST_TIMEOUT
  );

  it(
    'scopes git-subdir discovery to the declared path',
    async () => {
      const repoDir = join(testDir, 'monorepo');
      createRepo(repoDir);
      // Skill inside the declared subdirectory
      writeSkill(repoDir, 'libs/design-system/skills/ds-angular', 'ds-angular');
      // Decoy skill outside the declared subdirectory
      writeSkill(repoDir, 'other/skills/decoy-skill', 'decoy-skill');
      commitAll(repoDir);

      const entry: RemotePluginEntry = {
        name: 'ds-angular',
        source: {
          source: 'git-subdir',
          url: repoUrl(repoDir),
          path: 'libs/design-system',
        },
      };

      const resolved = await resolveRemotePlugin(entry);
      clonePaths.push(resolved.clonePath);

      expect(resolved.skills.map((s) => s.name)).toEqual(['ds-angular']);
    },
    CLONE_TEST_TIMEOUT
  );

  it(
    'checks out the declared ref',
    async () => {
      const repoDir = join(testDir, 'branched');
      createRepo(repoDir);
      writeSkill(repoDir, 'skills/main-skill', 'main-skill');
      commitAll(repoDir);

      // Branch with an additional skill
      git(repoDir, 'checkout -qb feature-branch');
      writeSkill(repoDir, 'skills/feature-skill', 'feature-skill');
      commitAll(repoDir);

      const entry: RemotePluginEntry = {
        name: 'feature-plugin',
        source: { source: 'url', url: repoUrl(repoDir), ref: 'feature-branch' },
      };

      const resolved = await resolveRemotePlugin(entry);
      clonePaths.push(resolved.clonePath);

      const names = resolved.skills.map((s) => s.name).sort();
      expect(names).toEqual(['feature-skill', 'main-skill']);
    },
    CLONE_TEST_TIMEOUT
  );

  it(
    'checks out the exact pinned sha (server allows sha fetch)',
    async () => {
      const repoDir = join(testDir, 'pinned-fast');
      createRepo(repoDir);
      // Allow fetching unadvertised objects so the fast path works
      git(repoDir, 'config uploadpack.allowAnySHA1InWant true');

      writeSkill(repoDir, 'skills/pinned-skill', 'pinned-skill-v1');
      const firstSha = commitAll(repoDir, 'first');

      // Second commit changes the skill name
      writeSkill(repoDir, 'skills/pinned-skill', 'pinned-skill-v2');
      commitAll(repoDir, 'second');

      const entry: RemotePluginEntry = {
        name: 'pinned-plugin',
        source: { source: 'url', url: repoUrl(repoDir), sha: firstSha },
      };

      const resolved = await resolveRemotePlugin(entry);
      clonePaths.push(resolved.clonePath);

      // Content must come from the pinned (first) commit
      expect(resolved.resolvedSha).toBe(firstSha);
      expect(resolved.skills.map((s) => s.name)).toEqual(['pinned-skill-v1']);
    },
    CLONE_TEST_TIMEOUT
  );

  it(
    'checks out the exact pinned sha (fallback to full clone)',
    async () => {
      const repoDir = join(testDir, 'pinned-fallback');
      createRepo(repoDir);
      // No allowAnySHA1InWant: the sha fetch fast path is rejected by the server,
      // forcing the full-clone fallback

      writeSkill(repoDir, 'skills/fallback-skill', 'fallback-skill-v1');
      const firstSha = commitAll(repoDir, 'first');

      writeSkill(repoDir, 'skills/fallback-skill', 'fallback-skill-v2');
      commitAll(repoDir, 'second');

      const entry: RemotePluginEntry = {
        name: 'fallback-plugin',
        source: { source: 'url', url: repoUrl(repoDir), sha: firstSha },
      };

      const resolved = await resolveRemotePlugin(entry);
      clonePaths.push(resolved.clonePath);

      expect(resolved.resolvedSha).toBe(firstSha);
      expect(resolved.skills.map((s) => s.name)).toEqual(['fallback-skill-v1']);
    },
    CLONE_TEST_TIMEOUT
  );

  it(
    'returns the resolved sha of the cloned HEAD',
    async () => {
      const repoDir = join(testDir, 'sha-check');
      createRepo(repoDir);
      writeSkill(repoDir, 'skills/sha-skill', 'sha-skill');
      const headSha = commitAll(repoDir);

      const entry: RemotePluginEntry = {
        name: 'sha-plugin',
        source: { source: 'url', url: repoUrl(repoDir) },
      };

      const resolved = await resolveRemotePlugin(entry);
      clonePaths.push(resolved.clonePath);

      expect(resolved.resolvedSha).toBe(headSha);
    },
    CLONE_TEST_TIMEOUT
  );

  it(
    'tags discovered skills with the plugin name',
    async () => {
      const repoDir = join(testDir, 'tagged');
      createRepo(repoDir);
      writeSkill(repoDir, 'skills/tagged-skill', 'tagged-skill');
      commitAll(repoDir);

      const entry: RemotePluginEntry = {
        name: 'design-system',
        source: { source: 'url', url: repoUrl(repoDir) },
      };

      const resolved = await resolveRemotePlugin(entry);
      clonePaths.push(resolved.clonePath);

      expect(resolved.skills[0].pluginName).toBe('design-system');
    },
    CLONE_TEST_TIMEOUT
  );

  it(
    'discovers skill paths explicitly declared on the entry',
    async () => {
      const repoDir = join(testDir, 'explicit');
      createRepo(repoDir);
      // Skill in a non-conventional location, only reachable via the declared path
      writeSkill(repoDir, 'custom/location/explicit-skill', 'explicit-skill');
      // Conventional skill too
      writeSkill(repoDir, 'skills/conventional-skill', 'conventional-skill');
      commitAll(repoDir);

      const entry: RemotePluginEntry = {
        name: 'explicit-plugin',
        source: { source: 'url', url: repoUrl(repoDir) },
        skills: ['./custom/location/explicit-skill'],
      };

      const resolved = await resolveRemotePlugin(entry);
      clonePaths.push(resolved.clonePath);

      const names = resolved.skills.map((s) => s.name).sort();
      expect(names).toEqual(['conventional-skill', 'explicit-skill']);
    },
    CLONE_TEST_TIMEOUT
  );

  it(
    'ignores declared skill paths that escape the plugin root',
    async () => {
      const repoDir = join(testDir, 'escaping');
      createRepo(repoDir);
      writeSkill(repoDir, 'skills/safe-skill', 'safe-skill');
      commitAll(repoDir);

      const entry: RemotePluginEntry = {
        name: 'escaping-plugin',
        source: { source: 'url', url: repoUrl(repoDir) },
        skills: ['./../../../etc'],
      };

      const resolved = await resolveRemotePlugin(entry);
      clonePaths.push(resolved.clonePath);

      // Only the conventional skill; the escaping path is ignored
      expect(resolved.skills.map((s) => s.name)).toEqual(['safe-skill']);
    },
    CLONE_TEST_TIMEOUT
  );

  it(
    'rejects git-subdir paths that traverse outside the clone',
    async () => {
      const repoDir = join(testDir, 'traversal');
      createRepo(repoDir);
      writeSkill(repoDir, 'skills/any-skill', 'any-skill');
      commitAll(repoDir);

      // Phase-1 parsing rejects such paths; this verifies resolution-level
      // defense in depth for entries constructed programmatically. The subpath
      // is rejected before it reaches git sparse-checkout.
      const entry: RemotePluginEntry = {
        name: 'traversal-plugin',
        source: { source: 'git-subdir', url: repoUrl(repoDir), path: '../../../etc' },
      };

      await expect(resolveRemotePlugin(entry)).rejects.toThrow(/Invalid subpath/);
    },
    CLONE_TEST_TIMEOUT
  );

  it(
    'throws GitCloneError for unreachable repositories',
    async () => {
      const entry: RemotePluginEntry = {
        name: 'unreachable-plugin',
        source: {
          source: 'url',
          url: pathToFileURL(join(testDir, 'does-not-exist')).href,
        },
      };

      await expect(resolveRemotePlugin(entry)).rejects.toThrow(GitCloneError);
    },
    CLONE_TEST_TIMEOUT
  );
});

describe('resolveRemotePlugins', () => {
  let testDir: string;
  const clonePaths: string[] = [];

  beforeEach(() => {
    testDir = join(tmpdir(), `remote-resolution-many-test-${Date.now()}-${dirCounter++}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
    for (const path of clonePaths) {
      rmSync(path, { recursive: true, force: true });
    }
    clonePaths.length = 0;
  });

  it(
    'resolves multiple plugins concurrently',
    async () => {
      const repoA = join(testDir, 'repo-a');
      createRepo(repoA);
      writeSkill(repoA, 'skills/skill-a', 'skill-a');
      commitAll(repoA);

      const repoB = join(testDir, 'repo-b');
      createRepo(repoB);
      writeSkill(repoB, 'skills/skill-b', 'skill-b');
      commitAll(repoB);

      const results = await resolveRemotePlugins([
        { name: 'plugin-a', source: { source: 'url', url: repoUrl(repoA) } },
        { name: 'plugin-b', source: { source: 'url', url: repoUrl(repoB) } },
      ]);

      for (const result of results) {
        if (result.ok) clonePaths.push(result.plugin.clonePath);
      }

      expect(results).toHaveLength(2);
      expect(results.every((r) => r.ok)).toBe(true);
      const names = results
        .flatMap((r) => (r.ok ? r.plugin.skills : []))
        .map((s) => s.name)
        .sort();
      expect(names).toEqual(['skill-a', 'skill-b']);
    },
    CLONE_TEST_TIMEOUT
  );

  it(
    'isolates failures per plugin',
    async () => {
      const goodRepo = join(testDir, 'good-repo');
      createRepo(goodRepo);
      writeSkill(goodRepo, 'skills/good-skill', 'good-skill');
      commitAll(goodRepo);

      const results = await resolveRemotePlugins([
        { name: 'good-plugin', source: { source: 'url', url: repoUrl(goodRepo) } },
        {
          name: 'bad-plugin',
          source: { source: 'url', url: pathToFileURL(join(testDir, 'missing')).href },
        },
      ]);

      for (const result of results) {
        if (result.ok) clonePaths.push(result.plugin.clonePath);
      }

      expect(results).toHaveLength(2);

      const good = results[0];
      expect(good.ok).toBe(true);
      if (good.ok) {
        expect(good.plugin.skills.map((s) => s.name)).toEqual(['good-skill']);
      }

      const bad = results[1];
      expect(bad.ok).toBe(false);
      if (!bad.ok) {
        expect(bad.failure.entry.name).toBe('bad-plugin');
        expect(bad.failure.error).toBeInstanceOf(Error);
      }
    },
    CLONE_TEST_TIMEOUT
  );
});

describe('cloneRepoSparse', () => {
  let testDir: string;
  const clonePaths: string[] = [];

  beforeEach(() => {
    testDir = join(tmpdir(), `sparse-clone-test-${Date.now()}-${dirCounter++}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
    for (const path of clonePaths) {
      rmSync(path, { recursive: true, force: true });
    }
    clonePaths.length = 0;
  });

  it(
    'materializes only the declared subdirectory',
    async () => {
      const repoDir = join(testDir, 'monorepo');
      createRepo(repoDir);
      writeSkill(repoDir, 'libs/design-system/skills/ds-angular', 'ds-angular');
      writeSkill(repoDir, 'apps/web/skills/web-skill', 'web-skill');
      commitAll(repoDir);

      const clonePath = await cloneRepoSparse(repoUrl(repoDir), { path: 'libs/design-system' });
      clonePaths.push(clonePath);

      // The declared subdirectory is present...
      const skillMd = join(clonePath, 'libs/design-system/skills/ds-angular/SKILL.md');
      expect(existsSync(skillMd)).toBe(true);
      // ...the sibling subtree is not checked out into the working tree
      expect(existsSync(join(clonePath, 'apps'))).toBe(false);
    },
    CLONE_TEST_TIMEOUT
  );

  it(
    'checks out the exact pinned sha (sparse, server allows sha fetch)',
    async () => {
      const repoDir = join(testDir, 'pinned-sparse-fast');
      createRepo(repoDir);
      git(repoDir, 'config uploadpack.allowAnySHA1InWant true');
      git(repoDir, 'config uploadpack.allowFilter true');

      writeSkill(repoDir, 'libs/ds/skills/pinned', 'pinned-v1');
      const firstSha = commitAll(repoDir, 'first');

      writeSkill(repoDir, 'libs/ds/skills/pinned', 'pinned-v2');
      commitAll(repoDir, 'second');

      const clonePath = await cloneRepoSparse(repoUrl(repoDir), {
        path: 'libs/ds',
        sha: firstSha,
      });
      clonePaths.push(clonePath);

      expect(git(clonePath, 'rev-parse HEAD')).toBe(firstSha);
      const skillMd = readFileSync(join(clonePath, 'libs/ds/skills/pinned/SKILL.md'), 'utf-8');
      expect(skillMd).toContain('name: pinned-v1');
    },
    CLONE_TEST_TIMEOUT
  );

  it(
    'checks out the exact pinned sha (sparse, fallback to clone)',
    async () => {
      const repoDir = join(testDir, 'pinned-sparse-fallback');
      createRepo(repoDir);
      // No allowAnySHA1InWant: the sha fetch fast path is rejected, forcing the
      // sparse-clone fallback.

      writeSkill(repoDir, 'libs/ds/skills/fallback', 'fallback-v1');
      const firstSha = commitAll(repoDir, 'first');

      writeSkill(repoDir, 'libs/ds/skills/fallback', 'fallback-v2');
      commitAll(repoDir, 'second');

      const clonePath = await cloneRepoSparse(repoUrl(repoDir), {
        path: 'libs/ds',
        sha: firstSha,
      });
      clonePaths.push(clonePath);

      expect(git(clonePath, 'rev-parse HEAD')).toBe(firstSha);
      const skillMd = readFileSync(join(clonePath, 'libs/ds/skills/fallback/SKILL.md'), 'utf-8');
      expect(skillMd).toContain('name: fallback-v1');
    },
    CLONE_TEST_TIMEOUT
  );
});

describe('resolveRemotePlugin with sparse git-subdir', () => {
  let testDir: string;
  const clonePaths: string[] = [];

  beforeEach(() => {
    testDir = join(tmpdir(), `sparse-resolve-test-${Date.now()}-${dirCounter++}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
    for (const path of clonePaths) {
      rmSync(path, { recursive: true, force: true });
    }
    clonePaths.length = 0;
  });

  it(
    'discovers only the subdir and leaves siblings off disk',
    async () => {
      const repoDir = join(testDir, 'monorepo');
      createRepo(repoDir);
      writeSkill(repoDir, 'libs/design-system/skills/ds-angular', 'ds-angular');
      writeSkill(repoDir, 'other/skills/decoy-skill', 'decoy-skill');
      commitAll(repoDir);

      const entry: RemotePluginEntry = {
        name: 'ds-angular',
        source: { source: 'git-subdir', url: repoUrl(repoDir), path: 'libs/design-system' },
      };

      const resolved = await resolveRemotePlugin(entry);
      clonePaths.push(resolved.clonePath);

      expect(resolved.skills.map((s) => s.name)).toEqual(['ds-angular']);
      // The decoy subtree was never materialized by the sparse checkout
      expect(existsSync(join(resolved.clonePath, 'other'))).toBe(false);
    },
    CLONE_TEST_TIMEOUT
  );

  it(
    'honors a sha pin on a git-subdir source',
    async () => {
      const repoDir = join(testDir, 'pinned-subdir');
      createRepo(repoDir);
      git(repoDir, 'config uploadpack.allowAnySHA1InWant true');
      git(repoDir, 'config uploadpack.allowFilter true');

      writeSkill(repoDir, 'libs/ds/skills/pinned-skill', 'pinned-skill-v1');
      const firstSha = commitAll(repoDir, 'first');

      writeSkill(repoDir, 'libs/ds/skills/pinned-skill', 'pinned-skill-v2');
      commitAll(repoDir, 'second');

      const entry: RemotePluginEntry = {
        name: 'pinned-plugin',
        source: { source: 'git-subdir', url: repoUrl(repoDir), path: 'libs/ds', sha: firstSha },
      };

      const resolved = await resolveRemotePlugin(entry);
      clonePaths.push(resolved.clonePath);

      expect(resolved.resolvedSha).toBe(firstSha);
      expect(resolved.skills.map((s) => s.name)).toEqual(['pinned-skill-v1']);
    },
    CLONE_TEST_TIMEOUT
  );
});
