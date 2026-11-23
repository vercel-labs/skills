import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Sandbox, entries, isSymlink, readSkill } from './sandbox.ts';

const NPM_FLAGS = ['--no-audit', '--no-fund', '--ignore-scripts'];

async function npmProject(name: string, pkg: Record<string, unknown> = {}): Promise<Sandbox> {
  const sandbox = await Sandbox.create(name);
  await sandbox.writeProjectFile(
    'package.json',
    JSON.stringify({ name: `e2e-${name}`, private: true, ...pkg }, null, 2)
  );
  return sandbox;
}

describe('npm packages (experimental_sync)', () => {
  it('links skills shipped by a registry package and cleans up after uninstall', async () => {
    const sandbox = await npmProject('npm-registry');
    // agent-browser ships skills/agent-browser/SKILL.md; its postinstall downloads
    // a native binary the CLI never needs, hence --ignore-scripts.
    await sandbox.run('npm', ['install', '-D', ...NPM_FLAGS, 'agent-browser']);
    const { version } = JSON.parse(
      readFileSync(sandbox.path('node_modules', 'agent-browser', 'package.json'), 'utf8')
    ) as { version: string };

    await sandbox.skills(['experimental_sync', '-a', 'claude-code', '-y']);

    const canonical = sandbox.path('.agents', 'skills', 'agent-browser');
    const link = sandbox.path('.claude', 'skills', 'agent-browser');
    expect(readSkill(link).name).toBe('agent-browser');
    // Linked into node_modules so it updates with the dependency.
    expect(isSymlink(canonical)).toBe(true);
    expect(realpathSync(canonical)).toBe(
      realpathSync(sandbox.path('node_modules', 'agent-browser', 'skills', 'agent-browser'))
    );
    expect(realpathSync(link)).toBe(realpathSync(canonical));
    expect(sandbox.projectLock().skills['agent-browser']).toMatchObject({
      source: 'agent-browser',
      sourceType: 'node_modules',
      version,
    });

    // Re-running with an unchanged tree is a no-op, so it passes frozen.
    await sandbox.skills(['experimental_sync', '-a', 'claude-code', '-y', '--frozen-lockfile']);

    await sandbox.run('npm', ['uninstall', ...NPM_FLAGS, 'agent-browser']);
    await sandbox.skills(['experimental_sync', '-a', 'claude-code', '-y']);
    expect(existsSync(canonical)).toBe(false);
    expect(existsSync(link)).toBe(false);
    expect(sandbox.projectLock().skills['agent-browser']).toBeUndefined();
  });

  it('syncs a tarball package with dist/skills and a remote skills pack', async () => {
    // A local package, packed and installed from its tarball like a real publish.
    const sandbox = await npmProject('npm-tarball');
    const pkgDir = join(sandbox.root, 'fixture-pkg');
    await mkdir(join(pkgDir, 'dist', 'skills', 'lib-helper'), { recursive: true });
    await writeFile(
      join(pkgDir, 'package.json'),
      JSON.stringify({
        name: '@e2e/skill-lib',
        version: '1.2.3',
        files: ['dist'],
        // Shareable pack: consumers also get this remote skill.
        skills: ['mattpocock/skills@tdd'],
      })
    );
    await writeFile(
      join(pkgDir, 'dist', 'skills', 'lib-helper', 'SKILL.md'),
      '---\nname: lib-helper\ndescription: Helper skill shipped in dist/skills\n---\n\n# lib-helper\n'
    );
    await sandbox.run('npm', ['pack', '--pack-destination', sandbox.root], { cwd: pkgDir });
    const [tgz] = (await readdir(sandbox.root)).filter((f) => f.endsWith('.tgz'));
    await sandbox.run('npm', ['install', '-D', ...NPM_FLAGS, join(sandbox.root, tgz!)]);

    const sync = (...args: string[]) =>
      sandbox.skills(['experimental_sync', '--copy', '-a', 'claude-code', '-y', ...args]);

    // --dry-run plans both skills but writes nothing.
    const dry = await sync('--dry-run');
    expect(dry.output).toContain('lib-helper');
    // Remote entries are planned by source, attributed to the declaring package.
    expect(dry.output).toMatch(/mattpocock\/skills ← @e2e\/skill-lib \(remote\)/);
    expect(entries(sandbox.path('.agents'))).toEqual([]);
    expect(existsSync(sandbox.path('skills-lock.json'))).toBe(false);

    // Remote entries are filtered by the package that declares them.
    await sync('--exclude', '@e2e/skill-lib#tdd');
    expect(entries(sandbox.path('.claude', 'skills'))).toEqual(['lib-helper']);

    await sync();
    const helper = sandbox.path('.claude', 'skills', 'lib-helper');
    expect(readSkill(helper).name).toBe('lib-helper');
    expect(readSkill(sandbox.path('.claude', 'skills', 'tdd')).name).toBe('tdd');
    // --copy: the shared copy is a real directory, not a link into node_modules.
    expect(isSymlink(sandbox.path('.agents', 'skills', 'lib-helper'))).toBe(false);

    const lock = sandbox.projectLock().skills;
    expect(lock['lib-helper']).toMatchObject({
      source: '@e2e/skill-lib',
      sourceType: 'node_modules',
      version: '1.2.3',
    });
    expect(lock['tdd']).toMatchObject({ source: 'mattpocock/skills', sourceType: 'github' });
  });

  it('does nothing in a project without skill-shipping dependencies', async () => {
    const sandbox = await npmProject('npm-empty');
    await sandbox.skills(['experimental_sync', '-a', 'claude-code', '-y']);
    expect(entries(sandbox.path('.agents', 'skills'))).toEqual([]);
    expect(entries(sandbox.path('.claude', 'skills'))).toEqual([]);
  });
});
