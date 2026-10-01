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
