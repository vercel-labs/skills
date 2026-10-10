import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'fs';
import { join, resolve } from 'path';
import { execFileSync } from 'child_process';
import { pathToFileURL } from 'url';
import { tmpdir } from 'os';
import { runCli } from '../src/test-utils.ts';

function skillMd(name: string, description = `${name} description`): string {
  return `---
name: ${name}
description: ${description}
---

# ${name}
Instructions.
`;
}

describe('experimental_sync command', () => {
  let testDir: string;

  /** Declare direct dependencies in the project's package.json. */
  function declareDeps(deps: string[], devDeps: string[] = []): void {
    writeFileSync(
      join(testDir, 'package.json'),
      JSON.stringify({
        name: 'test-project',
        dependencies: Object.fromEntries(deps.map((d) => [d, '*'])),
        devDependencies: Object.fromEntries(devDeps.map((d) => [d, '*'])),
      })
    );
  }

  /** Create node_modules/<pkg> with a package.json and return its path. */
  function createPackage(pkg: string, version = '1.0.0'): string {
    const pkgDir = join(testDir, 'node_modules', pkg);
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({ name: pkg, version }));
    return pkgDir;
  }

  function writeSkill(dir: string, name: string): void {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'SKILL.md'), skillMd(name));
  }

  beforeEach(() => {
    testDir = join(
      tmpdir(),
      `skills-sync-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('package discovery', () => {
    it('finds SKILL.md at the package root', () => {
      declareDeps(['my-skill-pkg']);
      writeSkill(createPackage('my-skill-pkg'), 'root-skill');

      const result = runCli(['experimental_sync', '-y', '-a', 'claude-code'], testDir);
      expect(result.stdout).toContain('root-skill');
      expect(result.stdout).toContain('my-skill-pkg');
    });

    it('finds skills in skills/ and dist/skills/', () => {
      declareDeps(['my-lib']);
      const pkgDir = createPackage('my-lib');
      writeSkill(join(pkgDir, 'skills', 'helper-skill'), 'helper-skill');
      writeSkill(join(pkgDir, 'dist', 'skills', 'built-skill'), 'built-skill');

      const result = runCli(['experimental_sync', '-y', '-a', 'claude-code'], testDir);
      expect(result.stdout).toContain('helper-skill');
      expect(result.stdout).toContain('built-skill');
      expect(result.stdout).toContain('my-lib');
    });

    it('finds skills in scoped packages', () => {
      declareDeps(['@acme/tools']);
      writeSkill(createPackage('@acme/tools'), 'acme-tool');

      const result = runCli(['experimental_sync', '-y', '-a', 'claude-code'], testDir);
      expect(result.stdout).toContain('acme-tool');
      expect(result.stdout).toContain('@acme/tools');
    });

    it('reads devDependencies too', () => {
      declareDeps([], ['dev-tool']);
      writeSkill(createPackage('dev-tool'), 'dev-skill');

      const result = runCli(['experimental_sync', '-y', '-a', 'claude-code'], testDir);
      expect(result.stdout).toContain('dev-skill');
    });

    it('reads optionalDependencies and peerDependencies', () => {
      writeFileSync(
        join(testDir, 'package.json'),
        JSON.stringify({
          optionalDependencies: { 'opt-tool': '*', 'not-installed': '*' },
          peerDependencies: { 'peer-tool': '*' },
        })
      );
      writeSkill(createPackage('opt-tool'), 'opt-skill');
      writeSkill(createPackage('peer-tool'), 'peer-skill');

      const result = runCli(['experimental_sync', '-y', '-a', 'claude-code'], testDir);

      expect(result.exitCode).toBe(0);
      expect(existsSync(join(testDir, '.agents', 'skills', 'opt-skill'))).toBe(true);
      expect(existsSync(join(testDir, '.agents', 'skills', 'peer-skill'))).toBe(true);
    });

    it('ignores packages that are not direct dependencies', () => {
      declareDeps(['direct-pkg']);
      writeSkill(createPackage('direct-pkg'), 'direct-skill');
      writeSkill(createPackage('transitive-pkg'), 'transitive-skill');

      const result = runCli(['experimental_sync', '-y', '-a', 'claude-code'], testDir);
      expect(result.stdout).toContain('direct-skill');
      expect(result.stdout).not.toContain('transitive-skill');
      expect(existsSync(join(testDir, '.agents', 'skills', 'transitive-skill'))).toBe(false);
    });

    it('ignores other folders inside a package', () => {
      declareDeps(['my-lib']);
      const pkgDir = createPackage('my-lib');
      writeSkill(join(pkgDir, 'examples', 'demo'), 'example-skill');
      writeSkill(join(pkgDir, '.agents', 'skills', 'consumed'), 'consumed-skill');

      const result = runCli(['experimental_sync', '-y', '-a', 'claude-code'], testDir);
      expect(result.stdout).toContain('No skills found');
    });

    it('follows a symlinked package directory (pnpm layout)', () => {
      declareDeps(['linked-pkg']);
      const storeDir = join(testDir, 'node_modules', '.pnpm', 'linked-pkg@1.0.0', 'node_modules');
      const realPkgDir = join(storeDir, 'linked-pkg');
      mkdirSync(realPkgDir, { recursive: true });
      writeFileSync(
        join(realPkgDir, 'package.json'),
        JSON.stringify({ name: 'linked-pkg', version: '1.0.0' })
      );
      writeSkill(join(realPkgDir, 'skills', 'linked-skill'), 'linked-skill');
      symlinkSync(realPkgDir, join(testDir, 'node_modules', 'linked-pkg'), 'dir');

      const result = runCli(['experimental_sync', '-y', '-a', 'claude-code'], testDir);
      expect(result.stdout).toContain('linked-skill');
    });

    it('shows no skills found when dependencies ship none', () => {
      declareDeps(['plain-pkg']);
      createPackage('plain-pkg');

      const result = runCli(['experimental_sync', '-y'], testDir);
      expect(result.stdout).toContain('No skills found');
    });

    it('shows no skills found when there is no package.json', () => {
      writeSkill(createPackage('orphan-pkg'), 'orphan-skill');

      const result = runCli(['experimental_sync', '-y'], testDir);
      expect(result.stdout).toContain('No skills found');
    });
  });

  describe('skills-lock.json', () => {
    it('records package, version and skill path', () => {
      declareDeps(['my-pkg']);
      const pkgDir = createPackage('my-pkg', '2.3.4');
      writeSkill(join(pkgDir, 'skills', 'lock-test-skill'), 'lock-test-skill');

      runCli(['experimental_sync', '-y', '-a', 'claude-code'], testDir);

      const lock = JSON.parse(readFileSync(join(testDir, 'skills-lock.json'), 'utf-8'));
      expect(lock.version).toBe(1);
      expect(lock.skills['lock-test-skill']).toEqual({
        source: 'my-pkg',
        sourceType: 'node_modules',
        skillPath: 'skills/lock-test-skill/SKILL.md',
        version: '2.3.4',
        computedHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      });
    });

    it('records SKILL.md as the path for a root skill', () => {
      declareDeps(['my-pkg']);
      writeSkill(createPackage('my-pkg'), 'root-skill');

      runCli(['experimental_sync', '-y', '-a', 'claude-code'], testDir);

      const lock = JSON.parse(readFileSync(join(testDir, 'skills-lock.json'), 'utf-8'));
      expect(lock.skills['root-skill'].skillPath).toBe('SKILL.md');
    });

    it('sorts skills alphabetically', () => {
      const names = ['zebra-skill', 'alpha-skill', 'mid-skill'];
      declareDeps(names);
      for (const name of names) writeSkill(createPackage(name), name);

      runCli(['experimental_sync', '-y', '-a', 'claude-code'], testDir);

      const keys = Object.keys(
        JSON.parse(readFileSync(join(testDir, 'skills-lock.json'), 'utf-8')).skills
      );
      expect(keys).toEqual(['alpha-skill', 'mid-skill', 'zebra-skill']);
    });
  });

  describe('linking', () => {
    const sync = () => runCli(['experimental_sync', '-y', '-a', 'claude-code'], testDir);
    const canonical = (name: string) => join(testDir, '.agents', 'skills', name);
    const linkTarget = (path: string) => resolve(join(path, '..'), readlinkSync(path));

    it('links the canonical dir into node_modules and agent dirs to the canonical dir', () => {
      declareDeps(['my-lib']);
      const skillDir = join(createPackage('my-lib'), 'skills', 'linked');
      writeSkill(skillDir, 'linked');
      mkdirSync(join(testDir, '.claude'));

      sync();

      expect(lstatSync(canonical('linked')).isSymbolicLink()).toBe(true);
      expect(realpathSync(canonical('linked'))).toBe(realpathSync(skillDir));
      const agentDir = join(testDir, '.claude', 'skills', 'linked');
      expect(lstatSync(agentDir).isSymbolicLink()).toBe(true);
      expect(linkTarget(agentDir)).toBe(canonical('linked'));
    });

    it('relinks on every run without changing the result', () => {
      declareDeps(['my-lib']);
      writeSkill(join(createPackage('my-lib'), 'skills', 'stable'), 'stable');

      sync();
      const result = sync();

      expect(result.stdout).toContain('Synced 1 skill');
      expect(lstatSync(canonical('stable')).isSymbolicLink()).toBe(true);
    });

    it('sees package updates through the link', () => {
      declareDeps(['my-lib']);
      const skillDir = join(createPackage('my-lib'), 'skills', 'live');
      writeSkill(skillDir, 'live');
      sync();

      writeFileSync(join(skillDir, 'SKILL.md'), skillMd('live', 'updated description'));

      expect(readFileSync(join(canonical('live'), 'SKILL.md'), 'utf-8')).toContain(
        'updated description'
      );
    });

    it('copies with --copy', () => {
      declareDeps(['my-lib']);
      writeSkill(join(createPackage('my-lib'), 'skills', 'copied'), 'copied');

      runCli(['experimental_sync', '-y', '-a', 'claude-code', '--copy'], testDir);

      const agentDir = join(testDir, '.claude', 'skills', 'copied');
      expect(lstatSync(agentDir).isDirectory()).toBe(true);
      expect(existsSync(join(agentDir, 'SKILL.md'))).toBe(true);
    });

    it('replaces a copy made by an earlier sync with a link', () => {
      declareDeps(['my-lib']);
      const skillDir = join(createPackage('my-lib'), 'skills', 'migrated');
      writeSkill(skillDir, 'migrated');
      writeSkill(canonical('migrated'), 'migrated');
      writeFileSync(
        join(testDir, 'skills-lock.json'),
        JSON.stringify({
          version: 1,
          skills: {
            migrated: { source: 'my-lib', sourceType: 'node_modules', computedHash: 'stale' },
          },
        })
      );

      sync();

      expect(lstatSync(canonical('migrated')).isSymbolicLink()).toBe(true);
      expect(realpathSync(canonical('migrated'))).toBe(realpathSync(skillDir));
    });

    it('changes nothing with --dry-run', () => {
      declareDeps(['my-lib']);
      writeSkill(join(createPackage('my-lib'), 'skills', 'planned'), 'planned');

      const result = runCli(['experimental_sync', '-y', '-a', 'claude-code', '--dry-run'], testDir);

      expect(result.stdout).toContain('planned');
      expect(result.stdout).toContain('Dry run');
      expect(existsSync(canonical('planned'))).toBe(false);
      expect(existsSync(join(testDir, 'skills-lock.json'))).toBe(false);
    });
  });

  describe('conflicts', () => {
    const sync = () => runCli(['experimental_sync', '-y', '-a', 'claude-code'], testDir);
    const canonical = (name: string) => join(testDir, '.agents', 'skills', name);

    it('never shadows a skill installed with skills add', () => {
      declareDeps(['my-lib']);
      writeSkill(join(createPackage('my-lib'), 'skills', 'shared'), 'shared');
      writeSkill(canonical('shared'), 'shared');
      writeFileSync(
        join(testDir, 'skills-lock.json'),
        JSON.stringify({
          version: 1,
          skills: { shared: { source: 'owner/repo', sourceType: 'github', computedHash: 'x' } },
        })
      );

      const result = sync();

      expect(result.stdout).toContain('Skipped');
      expect(result.stdout).toContain('skills add');
      expect(lstatSync(canonical('shared')).isDirectory()).toBe(true);
      const lock = JSON.parse(readFileSync(join(testDir, 'skills-lock.json'), 'utf-8'));
      expect(lock.skills.shared.sourceType).toBe('github');
    });

    it('never replaces a hand-written skill directory', () => {
      declareDeps(['my-lib']);
      writeSkill(join(createPackage('my-lib'), 'skills', 'mine'), 'mine');
      writeSkill(canonical('mine'), 'mine');
      writeFileSync(join(canonical('mine'), 'notes.md'), 'keep me');

      const result = sync();

      expect(result.stdout).toContain('Skipped');
      expect(result.stdout).toContain('already exists');
      expect(existsSync(join(canonical('mine'), 'notes.md'))).toBe(true);
    });

    it('never replaces a symlink that points elsewhere', () => {
      declareDeps(['my-lib']);
      writeSkill(join(createPackage('my-lib'), 'skills', 'elsewhere'), 'elsewhere');
      const other = join(testDir, 'other-skill');
      writeSkill(other, 'elsewhere');
      mkdirSync(join(testDir, '.agents', 'skills'), { recursive: true });
      symlinkSync(other, canonical('elsewhere'), 'dir');

      const result = sync();

      expect(result.stdout).toContain('Skipped');
      expect(result.stdout).toContain('is a symlink to');
      expect(realpathSync(canonical('elsewhere'))).toBe(realpathSync(other));
    });

    it('installs neither when two packages ship the same skill name', () => {
      declareDeps(['pkg-a', 'pkg-b']);
      writeSkill(join(createPackage('pkg-a'), 'skills', 'migrate'), 'migrate');
      writeSkill(join(createPackage('pkg-b'), 'skills', 'migrate'), 'migrate');

      const result = sync();

      expect(result.stdout).toContain('pkg-a');
      expect(result.stdout).toContain('pkg-b');
      expect(result.stdout).toContain('Nothing to sync');
      expect(existsSync(canonical('migrate'))).toBe(false);
    });
  });

  describe('cleanup', () => {
    const sync = (...flags: string[]) =>
      runCli(['experimental_sync', '-y', '-a', 'claude-code', ...flags], testDir);
    const canonical = (name: string) => join(testDir, '.agents', 'skills', name);
    const readLock = () => JSON.parse(readFileSync(join(testDir, 'skills-lock.json'), 'utf-8'));

    /** Install `gone` from `old-lib` and `kept` from `my-lib`, then drop `old-lib`. */
    function syncThenRemoveDependency(...firstSyncFlags: string[]): void {
      declareDeps(['old-lib', 'my-lib']);
      writeSkill(join(createPackage('old-lib'), 'skills', 'gone'), 'gone');
      writeSkill(join(createPackage('my-lib'), 'skills', 'kept'), 'kept');
      mkdirSync(join(testDir, '.claude'));
      sync(...firstSyncFlags);
      declareDeps(['my-lib']);
    }

    it('removes links and lock entries for a dependency that was removed', () => {
      syncThenRemoveDependency();

      const result = sync();

      expect(result.stdout).toContain('Removed');
      expect(existsSync(canonical('gone'))).toBe(false);
      expect(existsSync(join(testDir, '.claude', 'skills', 'gone'))).toBe(false);
      expect(readLock().skills.gone).toBeUndefined();
      expect(lstatSync(canonical('kept')).isSymbolicLink()).toBe(true);
      expect(readLock().skills.kept).toBeDefined();
    });

    it('removes skills when the last dependency is removed', () => {
      declareDeps(['old-lib']);
      writeSkill(join(createPackage('old-lib'), 'skills', 'gone'), 'gone');
      sync();
      declareDeps([]);

      const result = sync();

      expect(result.stdout).toContain('No skills found');
      expect(existsSync(canonical('gone'))).toBe(false);
      expect(readLock().skills.gone).toBeUndefined();
    });

    it('removes copies made with --copy', () => {
      syncThenRemoveDependency('--copy');
      expect(lstatSync(join(testDir, '.claude', 'skills', 'gone')).isDirectory()).toBe(true);

      sync();

      expect(existsSync(join(testDir, '.claude', 'skills', 'gone'))).toBe(false);
    });

    it('never removes skills installed with skills add or written by hand', () => {
      declareDeps([]);
      writeSkill(canonical('added'), 'added');
      writeSkill(canonical('handwritten'), 'handwritten');
      writeFileSync(
        join(testDir, 'skills-lock.json'),
        JSON.stringify({
          version: 1,
          skills: { added: { source: 'owner/repo', sourceType: 'github', computedHash: 'x' } },
        })
      );

      sync();

      expect(existsSync(join(canonical('added'), 'SKILL.md'))).toBe(true);
      expect(existsSync(join(canonical('handwritten'), 'SKILL.md'))).toBe(true);
      expect(readLock().skills.added).toBeDefined();
    });

    it('keeps everything with --no-cleanup', () => {
      syncThenRemoveDependency();

      sync('--no-cleanup');

      expect(lstatSync(canonical('gone')).isSymbolicLink()).toBe(true);
      expect(readLock().skills.gone).toBeDefined();
    });

    it('only reports with --dry-run', () => {
      syncThenRemoveDependency();

      const result = sync('--dry-run');

      expect(result.stdout).toContain('Would remove');
      expect(result.stdout).toContain('gone');
      expect(lstatSync(canonical('gone')).isSymbolicLink()).toBe(true);
      expect(readLock().skills.gone).toBeDefined();
    });
  });

  describe('filters', () => {
    const sync = (...flags: string[]) =>
      runCli(['experimental_sync', '-y', '-a', 'claude-code', ...flags], testDir);
    const installed = (name: string) => existsSync(join(testDir, '.agents', 'skills', name));

    beforeEach(() => {
      declareDeps(['@acme/tools', '@acme/docs', 'other-lib']);
      writeSkill(join(createPackage('@acme/tools'), 'skills', 'tool-a'), 'tool-a');
      const docs = createPackage('@acme/docs');
      writeSkill(join(docs, 'skills', 'docs-a'), 'docs-a');
      writeSkill(join(docs, 'skills', 'docs-b'), 'docs-b');
      writeSkill(join(createPackage('other-lib'), 'skills', 'other-a'), 'other-a');
    });

    it('--include <package> keeps only matching packages', () => {
      sync('--include', '@acme/*');

      expect(installed('tool-a')).toBe(true);
      expect(installed('docs-a')).toBe(true);
      expect(installed('other-a')).toBe(false);
    });

    it('--exclude <package> skips every skill of the package', () => {
      sync('--exclude', '@acme/docs', 'other-lib');

      expect(installed('tool-a')).toBe(true);
      expect(installed('docs-a')).toBe(false);
      expect(installed('docs-b')).toBe(false);
      expect(installed('other-a')).toBe(false);
    });

    it('--exclude <package>#<skill> skips one skill of the package', () => {
      sync('--exclude', '@acme/docs#docs-a');

      expect(installed('docs-a')).toBe(false);
      expect(installed('docs-b')).toBe(true);
    });

    it('--include <package>#<skill> accepts a glob for the skill', () => {
      sync('--include', '@acme/docs#*-b');

      expect(installed('docs-a')).toBe(false);
      expect(installed('docs-b')).toBe(true);
      expect(installed('tool-a')).toBe(false);
    });

    it('a bare pattern matches package names, not skill names', () => {
      sync('--exclude', 'docs-a');

      expect(installed('docs-a')).toBe(true);
    });

    it('--exclude wins over --include', () => {
      sync('--include', '@acme/**', '--exclude', '@acme/docs');

      expect(installed('tool-a')).toBe(true);
      expect(installed('docs-a')).toBe(false);
    });

    it('excluding a skill that was installed earlier removes it', () => {
      sync();
      expect(installed('docs-a')).toBe(true);

      sync('--exclude', '@acme/docs#docs-a');

      expect(installed('docs-a')).toBe(false);
      expect(installed('docs-b')).toBe(true);
    });

    it('resolves a name conflict by excluding one copy', () => {
      declareDeps(['pkg-a', 'pkg-b']);
      writeSkill(join(createPackage('pkg-a'), 'skills', 'migrate'), 'migrate');
      writeSkill(join(createPackage('pkg-b'), 'skills', 'migrate'), 'migrate');

      const conflicted = sync();
      expect(conflicted.stdout).toContain('--exclude pkg-b#migrate');

      sync('--exclude', 'pkg-b#migrate');

      const lock = JSON.parse(readFileSync(join(testDir, 'skills-lock.json'), 'utf-8'));
      expect(lock.skills.migrate.source).toBe('pkg-a');
    });
  });

  describe('skills field', () => {
    const sync = (...flags: string[]) =>
      runCli(['experimental_sync', '-y', '-a', 'claude-code', ...flags], testDir);
    const installed = (name: string) => existsSync(join(testDir, '.agents', 'skills', name));
    const readLock = () => JSON.parse(readFileSync(join(testDir, 'skills-lock.json'), 'utf-8'));

    function writePackageJson(dir: string, data: Record<string, unknown>): void {
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'package.json'), JSON.stringify(data));
    }

    /** The project's package.json with the given direct deps and `skills` field. */
    function declareProject(deps: string[], skills: unknown): void {
      writePackageJson(testDir, {
        name: 'test-project',
        dependencies: Object.fromEntries(deps.map((d) => [d, '*'])),
        skills,
      });
    }

    /** A package at `dir` that only declares a `skills` field (a skills pack). */
    function createPack(dir: string, name: string, skills: unknown): void {
      writePackageJson(dir, { name, version: '1.0.0', skills });
    }

    it('installs the skills of an npm: target named by the project', () => {
      declareProject([], ['npm:transitive-lib']);
      writeSkill(join(createPackage('transitive-lib'), 'skills', 'helper'), 'helper');

      sync();

      expect(installed('helper')).toBe(true);
      expect(readLock().skills.helper).toMatchObject({ source: 'transitive-lib', via: '.' });
    });

    it('resolves a pack entry from the pack itself (pnpm layout)', () => {
      declareProject(['my-pack'], undefined);
      const pack = join(testDir, 'node_modules', 'my-pack');
      createPack(pack, 'my-pack', ['npm:nested-lib']);
      const nested = join(pack, 'node_modules', 'nested-lib');
      writePackageJson(nested, { name: 'nested-lib', version: '2.0.0' });
      writeSkill(join(nested, 'skills', 'nested'), 'nested');

      sync();

      expect(installed('nested')).toBe(true);
      expect(readLock().skills.nested).toMatchObject({
        source: 'nested-lib',
        version: '2.0.0',
        via: 'my-pack',
      });
    });

    it('keeps only the skills an object entry names', () => {
      declareProject([], [{ source: 'npm:multi-lib', skills: ['wanted'] }]);
      const lib = createPackage('multi-lib');
      writeSkill(join(lib, 'skills', 'wanted'), 'wanted');
      writeSkill(join(lib, 'skills', 'unwanted'), 'unwanted');

      sync();

      expect(installed('wanted')).toBe(true);
      expect(installed('unwanted')).toBe(false);
    });

    it('follows npm: chains and stops at cycles', () => {
      declareProject(['pack-a'], undefined);
      createPack(join(testDir, 'node_modules', 'pack-a'), 'pack-a', ['npm:pack-b']);
      createPack(join(testDir, 'node_modules', 'pack-b'), 'pack-b', ['npm:pack-a', 'npm:leaf']);
      writeSkill(join(createPackage('leaf'), 'skills', 'leaf-skill'), 'leaf-skill');

      const result = sync();

      expect(result.exitCode).toBe(0);
      expect(installed('leaf-skill')).toBe(true);
      expect(readLock().skills['leaf-skill'].via).toBe('pack-b');
    });

    it('installs a skill once when two packs name the same package', () => {
      declareProject(['pack-a', 'pack-b'], undefined);
      createPack(join(testDir, 'node_modules', 'pack-a'), 'pack-a', ['npm:shared-lib']);
      createPack(join(testDir, 'node_modules', 'pack-b'), 'pack-b', ['npm:shared-lib']);
      writeSkill(join(createPackage('shared-lib'), 'skills', 'shared'), 'shared');

      sync();

      expect(installed('shared')).toBe(true);
    });

    it('prefers a direct dependency over a transitive package with the same skill', () => {
      declareProject(['direct-lib', 'my-pack'], undefined);
      writeSkill(join(createPackage('direct-lib'), 'skills', 'migrate'), 'migrate');
      createPack(join(testDir, 'node_modules', 'my-pack'), 'my-pack', ['npm:far-lib']);
      writeSkill(join(createPackage('far-lib'), 'skills', 'migrate'), 'migrate');

      const result = sync();

      expect(result.stdout).toContain('closer to the project');
      expect(readLock().skills.migrate.source).toBe('direct-lib');
    });

    it('stops when the project names a package that is not installed', () => {
      declareProject(['ok-lib'], ['npm:missing-lib']);
      writeSkill(join(createPackage('ok-lib'), 'skills', 'ok'), 'ok');

      const result = sync();

      expect(result.exitCode).toBe(1);
      expect(result.stdout).toContain('cannot resolve "npm:missing-lib"');
      expect(installed('ok')).toBe(false);
    });

    it('stops on a malformed project field', () => {
      declareProject([], [{ source: 'npm:x', ref: 'v1' }]);

      const result = sync();

      expect(result.exitCode).toBe(1);
      expect(result.stdout).toContain('"ref" cannot be used');
    });

    it('warns and continues when a dependency names a package that is not installed', () => {
      declareProject(['my-pack', 'ok-lib'], undefined);
      createPack(join(testDir, 'node_modules', 'my-pack'), 'my-pack', ['npm:missing-lib']);
      writeSkill(join(createPackage('ok-lib'), 'skills', 'ok'), 'ok');

      const result = sync();

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('my-pack: cannot resolve "npm:missing-lib"');
      expect(installed('ok')).toBe(true);
    });

    it('ignores a dependency whose "skills" key is not an array', () => {
      declareProject(['odd-lib'], undefined);
      createPack(join(testDir, 'node_modules', 'odd-lib'), 'odd-lib', { something: 'else' });

      const result = sync();

      expect(result.exitCode).toBe(0);
      expect(result.stdout).not.toContain('odd-lib:');
    });

    it('removes field skills when the pack is removed', () => {
      declareProject(['my-pack'], undefined);
      createPack(join(testDir, 'node_modules', 'my-pack'), 'my-pack', ['npm:far-lib']);
      writeSkill(join(createPackage('far-lib'), 'skills', 'far'), 'far');
      sync();
      expect(installed('far')).toBe(true);

      declareProject([], undefined);
      sync();

      expect(installed('far')).toBe(false);
    });
  });

  describe('remote skills field entries', () => {
    const sync = (...flags: string[]) =>
      runCli(['experimental_sync', '-y', '-a', 'claude-code', ...flags], testDir);
    const canonical = (name: string) => join(testDir, '.agents', 'skills', name);
    const readLock = () => JSON.parse(readFileSync(join(testDir, 'skills-lock.json'), 'utf-8'));

    /** A local git repository with one skills/<name> folder per name; returns its file:// URL. */
    function createSkillsRepo(dirName: string, names: string[]): string {
      const repo = join(testDir, '..', `${testDir.split(/[\\/]/).pop()}-${dirName}`);
      for (const name of names) writeSkill(join(repo, 'skills', name), name);
      const git = (...args: string[]) =>
        execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
          cwd: repo,
          stdio: 'ignore',
        });
      git('init', '-q');
      git('add', '.');
      git('commit', '-q', '-m', 'skills');
      return pathToFileURL(repo).href;
    }

    function declareProject(deps: string[], skills: unknown): void {
      writeFileSync(
        join(testDir, 'package.json'),
        JSON.stringify({
          name: 'test-project',
          dependencies: Object.fromEntries(deps.map((d) => [d, '*'])),
          skills,
        })
      );
    }

    afterEach(() => {
      for (const suffix of ['repo', 'other']) {
        rmSync(join(testDir, '..', `${testDir.split(/[\\/]/).pop()}-${suffix}`), {
          recursive: true,
          force: true,
        });
      }
    });

    it('installs skills from a git source and records via', () => {
      const repo = createSkillsRepo('repo', ['remote-a']);
      declareProject([], [repo]);

      const result = sync();

      expect(result.exitCode).toBe(0);
      expect(lstatSync(canonical('remote-a')).isDirectory()).toBe(true);
      expect(readLock().skills['remote-a']).toMatchObject({
        source: repo,
        sourceType: 'git',
        via: '.',
      });
    });

    it('records the pack that requested the skill', () => {
      const repo = createSkillsRepo('repo', ['remote-a']);
      declareProject(['my-pack'], undefined);
      const pack = join(testDir, 'node_modules', 'my-pack');
      mkdirSync(pack, { recursive: true });
      writeFileSync(
        join(pack, 'package.json'),
        JSON.stringify({ name: 'my-pack', skills: [repo] })
      );

      sync();

      expect(readLock().skills['remote-a'].via).toBe('my-pack');
    });

    it('keeps only the skills an object entry names', () => {
      const repo = createSkillsRepo('repo', ['remote-a', 'remote-b']);
      declareProject([], [{ source: repo, skills: ['remote-a'] }]);

      sync();

      expect(existsSync(canonical('remote-a'))).toBe(true);
      expect(existsSync(canonical('remote-b'))).toBe(false);
    });

    it('does not fetch again once installed', () => {
      const repo = createSkillsRepo('repo', ['remote-a']);
      declareProject([], [repo]);
      sync();
      rmSync(join(testDir, '..', `${testDir.split(/[\\/]/).pop()}-repo`), {
        recursive: true,
        force: true,
      });

      const result = sync();

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Nothing to sync');
      expect(existsSync(canonical('remote-a'))).toBe(true);
    });

    it('installs again when the skill folder is gone', () => {
      const repo = createSkillsRepo('repo', ['remote-a']);
      declareProject([], [repo]);
      sync();
      rmSync(canonical('remote-a'), { recursive: true, force: true });

      sync();

      expect(existsSync(join(canonical('remote-a'), 'SKILL.md'))).toBe(true);
    });

    it('removes skills that no field requests anymore', () => {
      const repo = createSkillsRepo('repo', ['remote-a']);
      declareProject([], [repo]);
      sync();

      declareProject([], []);
      sync();

      expect(existsSync(canonical('remote-a'))).toBe(false);
      expect(readLock().skills['remote-a']).toBeUndefined();
    });

    it('--no-remote neither installs nor removes remote skills', () => {
      const repo = createSkillsRepo('repo', ['remote-a', 'remote-b']);
      declareProject([], [{ source: repo, skills: ['remote-a'] }]);
      sync();

      declareProject([], [{ source: repo, skills: ['remote-b'] }]);
      sync('--no-remote');

      expect(existsSync(canonical('remote-a'))).toBe(true);
      expect(existsSync(canonical('remote-b'))).toBe(false);
    });

    it('prefers a skill shipped by a dependency', () => {
      const repo = createSkillsRepo('repo', ['shared']);
      declareProject(['my-lib'], [repo]);
      writeSkill(join(createPackage('my-lib'), 'skills', 'shared'), 'shared');

      const result = sync();

      expect(result.stdout).toContain('another source in this sync provides it');
      expect(lstatSync(canonical('shared')).isSymbolicLink()).toBe(true);
      expect(readLock().skills.shared.sourceType).toBe('node_modules');
    });

    it('never shadows a skill installed with skills add', () => {
      const repo = createSkillsRepo('repo', ['remote-a']);
      declareProject([], [repo]);
      writeSkill(canonical('remote-a'), 'remote-a');
      writeFileSync(join(canonical('remote-a'), 'mine.md'), 'keep');
      writeFileSync(
        join(testDir, 'skills-lock.json'),
        JSON.stringify({
          version: 1,
          skills: { 'remote-a': { source: 'owner/repo', sourceType: 'github', computedHash: 'x' } },
        })
      );

      const result = sync();

      expect(result.stdout).toContain('installed with `skills add`');
      expect(existsSync(join(canonical('remote-a'), 'mine.md'))).toBe(true);
    });

    it('reports a failing source and still installs the rest', () => {
      const missing = pathToFileURL(join(testDir, 'no-such-repo')).href;
      declareProject(['my-lib'], [missing]);
      writeSkill(join(createPackage('my-lib'), 'skills', 'shipped'), 'shipped');

      const result = sync();

      expect(result.exitCode).toBe(1);
      expect(result.stdout).toContain('Failed to install from');
      expect(lstatSync(canonical('shipped')).isSymbolicLink()).toBe(true);
    });

    it('stops on a project entry that is not a git source', () => {
      declareProject([], ['./local-skills']);

      const result = sync();

      expect(result.exitCode).toBe(1);
      expect(result.stdout).toContain('is not a git source');
    });
  });

  describe('--recursive', () => {
    const sync = (...flags: string[]) =>
      runCli(['experimental_sync', '-y', '-a', 'claude-code', ...flags], testDir);
    const installed = (name: string) => existsSync(join(testDir, '.agents', 'skills', name));
    const readLock = () => JSON.parse(readFileSync(join(testDir, 'skills-lock.json'), 'utf-8'));

    function writeJson(path: string, data: Record<string, unknown>): void {
      mkdirSync(join(path, '..'), { recursive: true });
      writeFileSync(path, JSON.stringify(data));
    }

    /** A package at `dir` that ships one skill. */
    function createSkillPackage(dir: string, name: string, skill: string): void {
      writeJson(join(dir, 'package.json'), { name, version: '1.0.0' });
      writeSkill(join(dir, 'skills', skill), skill);
    }

    it('reads the dependencies of npm workspace packages (hoisted)', () => {
      writeJson(join(testDir, 'package.json'), { name: 'root', workspaces: ['packages/*'] });
      writeJson(join(testDir, 'packages', 'app', 'package.json'), {
        name: '@acme/app',
        dependencies: { 'lib-a': '*' },
      });
      createSkillPackage(join(testDir, 'node_modules', 'lib-a'), 'lib-a', 'skill-a');

      sync();
      expect(installed('skill-a')).toBe(false);

      sync('--recursive');
      expect(installed('skill-a')).toBe(true);
    });

    it('reads pnpm workspace packages and their own node_modules', () => {
      writeJson(join(testDir, 'package.json'), { name: 'root' });
      writeFileSync(
        join(testDir, 'pnpm-workspace.yaml'),
        "packages:\n  - 'apps/*'\n  - '!apps/legacy'\n"
      );
      writeJson(join(testDir, 'apps', 'web', 'package.json'), {
        name: 'web',
        dependencies: { 'lib-b': '*' },
      });
      createSkillPackage(join(testDir, 'apps', 'web', 'node_modules', 'lib-b'), 'lib-b', 'skill-b');
      writeJson(join(testDir, 'apps', 'legacy', 'package.json'), {
        name: 'legacy',
        dependencies: { 'lib-c': '*' },
      });
      createSkillPackage(
        join(testDir, 'apps', 'legacy', 'node_modules', 'lib-c'),
        'lib-c',
        'skill-c'
      );

      sync('-r');

      expect(installed('skill-b')).toBe(true);
      expect(installed('skill-c')).toBe(false);
    });

    it('prefers a root dependency over a workspace dependency with the same skill', () => {
      writeJson(join(testDir, 'package.json'), {
        name: 'root',
        workspaces: ['packages/*'],
        dependencies: { 'root-lib': '*' },
      });
      createSkillPackage(join(testDir, 'node_modules', 'root-lib'), 'root-lib', 'shared');
      writeJson(join(testDir, 'packages', 'app', 'package.json'), {
        name: 'app',
        dependencies: { 'app-lib': '*' },
      });
      createSkillPackage(
        join(testDir, 'packages', 'app', 'node_modules', 'app-lib'),
        'app-lib',
        'shared'
      );

      const result = sync('-r');

      expect(result.stdout).toContain('closer to the project');
      expect(readLock().skills.shared.source).toBe('root-lib');
    });

    it('installs neither when two workspaces ship different copies of a skill', () => {
      writeJson(join(testDir, 'package.json'), { name: 'root', workspaces: ['packages/*'] });
      for (const app of ['one', 'two']) {
        writeJson(join(testDir, 'packages', app, 'package.json'), {
          name: app,
          dependencies: { 'shared-lib': '*' },
        });
        createSkillPackage(
          join(testDir, 'packages', app, 'node_modules', 'shared-lib'),
          'shared-lib',
          'shared'
        );
      }

      const result = sync('-r');

      expect(result.stdout).toContain('--exclude shared-lib#shared');
      expect(installed('shared')).toBe(false);
    });

    it('reads the skills field of a workspace package', () => {
      writeJson(join(testDir, 'package.json'), { name: 'root', workspaces: ['packages/*'] });
      writeJson(join(testDir, 'packages', 'app', 'package.json'), {
        name: 'app',
        skills: ['npm:far-lib'],
      });
      createSkillPackage(join(testDir, 'node_modules', 'far-lib'), 'far-lib', 'far');

      sync('-r');

      expect(readLock().skills.far).toMatchObject({ source: 'far-lib', via: 'app' });
    });
  });

  describe('CLI routing', () => {
    it('shows experimental_sync in help output', () => {
      const result = runCli(['--help']);
      expect(result.stdout).toContain('experimental_sync');
    });

    it('shows experimental_sync in banner', () => {
      const result = runCli([]);
      expect(result.stdout).toContain('experimental_sync');
    });
  });
});
