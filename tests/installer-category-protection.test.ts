/**
 * Regression tests for #1723: installing a flat skill must never delete an agent
 * category directory, e.g. Hermes `~/.hermes/skills/<category>/<skill>/SKILL.md`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createTestHomeEnvironment } from '../src/test-utils.ts';

type Installer = typeof import('../src/installer.ts');
type Mode = 'copy' | 'symlink';

let installer: Installer;
let home: string;
let root: string;

const NESTED = ['arxiv', 'polymarket', 'duckduckgo-search'];
const skillMd = (name: string) => `---\nname: ${name}\ndescription: test\n---\n`;

async function writeSkill(dir: string, name: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'SKILL.md'), skillMd(name), 'utf-8');
}

async function makeCategory(dir: string): Promise<void> {
  for (const name of NESTED) await writeSkill(join(dir, name), name);
}

function expectNestedKept(dir: string): void {
  for (const name of NESTED) expect(existsSync(join(dir, name, 'SKILL.md'))).toBe(true);
}

// One installer per install path; each installs a skill named `name` with an optional bundled `helper/SKILL.md`.
const installPaths: Record<
  string,
  (
    name: string,
    opts: { global: boolean; cwd: string; mode: Mode },
    helper?: boolean
  ) => Promise<{
    success: boolean;
    error?: string;
  }>
> = {
  local: async (name, opts, helper) => {
    const src = join(root, 'src', name);
    await writeSkill(src, name);
    if (helper) await writeSkill(join(src, 'helper'), 'helper');
    return installer.installSkillForAgent(
      { name, description: 'test', path: src },
      'hermes-agent',
      opts
    );
  },
  remote: (name, opts) =>
    installer.installRemoteSkillForAgent(
      {
        name,
        description: 'test',
        content: skillMd(name),
        installName: name,
        sourceUrl: 'https://example.com/SKILL.md',
        providerId: 'test',
      },
      'hermes-agent',
      opts
    ),
  'well-known': (name, opts) =>
    installer.installWellKnownSkillForAgent(
      {
        name,
        description: 'test',
        content: skillMd(name),
        installName: name,
        sourceUrl: 'https://example.com/.well-known/skills',
        providerId: 'well-known',
        files: new Map([['SKILL.md', skillMd(name)]]),
        indexEntry: { name, description: 'test', files: ['SKILL.md'] },
      },
      'hermes-agent',
      opts
    ),
  blob: (name, opts, helper) =>
    installer.installBlobSkillForAgent(
      {
        installName: name,
        files: [
          { path: 'SKILL.md', contents: skillMd(name) },
          ...(helper ? [{ path: 'helper/SKILL.md', contents: skillMd('helper') }] : []),
        ],
      },
      'hermes-agent',
      opts
    ),
};

describe('installer category-dir protection (#1723)', () => {
  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'skills-1723-home-'));
    root = await mkdtemp(join(tmpdir(), 'skills-1723-'));
    for (const [name, value] of Object.entries(createTestHomeEnvironment(home))) {
      vi.stubEnv(name, value);
    }
    // agents.ts reads the home directory at import time.
    vi.resetModules();
    installer = await import('../src/installer.ts');
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(home, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  });

  for (const [kind, install] of Object.entries(installPaths)) {
    for (const mode of ['copy', 'symlink'] as const) {
      it(`${kind}: refuses a global ${mode} install over a Hermes category`, async () => {
        const category = join(home, '.hermes', 'skills', 'research');
        await makeCategory(category);

        const result = await install('research', { global: true, cwd: root, mode });

        expect(result.success).toBe(false);
        expect(result.error).toContain('category directory');
        expect(result.error).toContain('arxiv');
        expectNestedKept(category);
        expect(existsSync(join(category, 'SKILL.md'))).toBe(false);
      });
    }
  }

  for (const [kind, install] of Object.entries(installPaths)) {
    it(`${kind}: a refused symlink install writes no canonical copy`, async () => {
      const category = join(home, '.hermes', 'skills', 'research');
      await makeCategory(category);
      const canonical = join(home, '.agents', 'skills', 'research');

      const result = await install('research', { global: true, cwd: root, mode: 'symlink' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('category directory');
      expect(existsSync(canonical)).toBe(false);
      expectNestedKept(category);
    });
  }

  it('refuses a project copy install over a category', async () => {
    const category = join(root, '.hermes', 'skills', 'research');
    await makeCategory(category);

    const result = await installPaths.local!('research', {
      global: false,
      cwd: root,
      mode: 'copy',
    });

    expect(result.success).toBe(false);
    expectNestedKept(category);
  });

  it('refuses when the category sits at the canonical path', async () => {
    const category = join(home, '.agents', 'skills', 'research');
    await makeCategory(category);

    const result = await installPaths.local!('research', {
      global: true,
      cwd: root,
      mode: 'symlink',
    });

    expect(result.success).toBe(false);
    expectNestedKept(category);
  });

  for (const mode of ['copy', 'symlink'] as const) {
    it(`reinstalls a flat skill in ${mode} mode`, async () => {
      const opts = { global: true, cwd: root, mode };
      expect((await installPaths.local!('flat', opts)).success).toBe(true);
      expect((await installPaths.local!('flat', opts)).success).toBe(true);
    });

    for (const kind of ['local', 'blob'] as const) {
      it(`${kind}: reinstalls a skill that bundles helper/SKILL.md in ${mode} mode`, async () => {
        const opts = { global: true, cwd: root, mode };
        expect((await installPaths[kind]!('bundle', opts, true)).success).toBe(true);
        const second = await installPaths[kind]!('bundle', opts, true);
        expect(second.error).toBeUndefined();
        expect(second.success).toBe(true);

        const dir = join(home, '.hermes', 'skills', 'bundle');
        await expect(readFile(join(dir, 'helper', 'SKILL.md'), 'utf-8')).resolves.toContain(
          'name: helper'
        );
      });
    }
  }
});
