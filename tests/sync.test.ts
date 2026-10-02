import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } from 'fs';
import { join } from 'path';
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

    it('skips unchanged skills on second sync', () => {
      declareDeps(['my-pkg']);
      writeSkill(createPackage('my-pkg'), 'cached-skill');

      runCli(['experimental_sync', '-y', '-a', 'claude-code'], testDir);
      const result = runCli(['experimental_sync', '-y', '-a', 'claude-code'], testDir);
      expect(result.stdout).toContain('up to date');
    });

    it('reinstalls when --force is used', () => {
      declareDeps(['my-pkg']);
      writeSkill(createPackage('my-pkg'), 'force-skill');

      runCli(['experimental_sync', '-y', '-a', 'claude-code'], testDir);
      const result = runCli(['experimental_sync', '-y', '-a', 'claude-code', '--force'], testDir);
      expect(result.stdout).toContain('force-skill');
      expect(result.stdout).not.toContain('All skills are up to date');
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
