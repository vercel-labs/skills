/**
 * Regression tests for #1723: the installer must never recursively replace an
 * agent category directory (a directory containing nested skills) when a flat
 * skill name collides with it. Previously `skills add` wiped e.g.
 * `~/.hermes/skills/research/` — a Hermes category holding nested skills — when
 * installing a flat skill named `research`, silently deleting the nested skills
 * (accepted automatically by `-y`).
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createTestHomeEnvironment } from '../src/test-utils.ts';

let installer: typeof import('../src/installer.ts');
let testHome: string;

async function makeSkillSource(root: string, name: string): Promise<string> {
  const dir = join(root, 'source-skill');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: test\n---\n`, 'utf-8');
  return dir;
}

async function makeCategory(baseDir: string, category: string, skills: string[]): Promise<void> {
  for (const skill of skills) {
    const dir = join(baseDir, category, skill);
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, 'SKILL.md'),
      `---\nname: ${skill}\ndescription: nested\n---\n`,
      'utf-8'
    );
  }
}

describe('installer category-dir protection (#1723)', () => {
  beforeAll(async () => {
    testHome = await mkdtemp(join(tmpdir(), 'skills-1723-home-'));

    for (const [name, value] of Object.entries(createTestHomeEnvironment(testHome))) {
      vi.stubEnv(name, value);
    }

    vi.resetModules();
    installer = await import('../src/installer.ts');
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await rm(testHome, { recursive: true, force: true });
  });

  it('aborts a copy-mode global install into a Hermes category dir and preserves nested skills', async () => {
    const root = await mkdtemp(join(tmpdir(), 'skills-1723-copy-'));
    const skillDir = await makeSkillSource(root, 'research');
    const nested = ['arxiv', 'polymarket', 'duckduckgo-search', 'research-paper-writing'];
    await makeCategory(join(testHome, '.hermes', 'skills'), 'research', nested);

    try {
      const result = await installer.installSkillForAgent(
        { name: 'research', description: 'test', path: skillDir },
        'hermes-agent',
        { global: true, mode: 'copy' }
      );

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/category directory/i);
      expect(result.error).toContain('arxiv');

      // Nested skills must remain on disk untouched
      for (const skill of nested) {
        await expect(
          stat(join(testHome, '.hermes', 'skills', 'research', skill, 'SKILL.md'))
        ).resolves.toBeTruthy();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('aborts a symlink-mode global install whose link target is a Hermes category dir', async () => {
    const root = await mkdtemp(join(tmpdir(), 'skills-1723-symlink-'));
    const skillDir = await makeSkillSource(root, 'research');
    await makeCategory(join(testHome, '.hermes', 'skills'), 'research', ['arxiv']);

    try {
      const result = await installer.installSkillForAgent(
        { name: 'research', description: 'test', path: skillDir },
        'hermes-agent',
        { global: true, mode: 'symlink' }
      );

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/category directory/i);

      // Nested skill preserved
      await expect(
        stat(join(testHome, '.hermes', 'skills', 'research', 'arxiv', 'SKILL.md'))
      ).resolves.toBeTruthy();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('still overwrites an existing flat skill on reinstall (no false positive)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'skills-1723-reinstall-'));
    const skillDir = await makeSkillSource(root, 'reinstall-me');

    try {
      const first = await installer.installSkillForAgent(
        { name: 'reinstall-me', description: 'test', path: skillDir },
        'hermes-agent',
        { global: true, mode: 'copy' }
      );
      expect(first.success).toBe(true);

      const second = await installer.installSkillForAgent(
        { name: 'reinstall-me', description: 'test v2', path: skillDir },
        'hermes-agent',
        { global: true, mode: 'copy' }
      );
      expect(second.success).toBe(true);
      expect(second.path).toBe(join(testHome, '.hermes', 'skills', 'reinstall-me'));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('installs into a fresh agent dir when no category exists', async () => {
    const root = await mkdtemp(join(tmpdir(), 'skills-1723-fresh-'));
    const skillDir = await makeSkillSource(root, 'brand-new-skill');

    try {
      const result = await installer.installSkillForAgent(
        { name: 'brand-new-skill', description: 'test', path: skillDir },
        'hermes-agent',
        { global: true, mode: 'copy' }
      );

      expect(result.success).toBe(true);
      await expect(
        stat(join(testHome, '.hermes', 'skills', 'brand-new-skill', 'SKILL.md'))
      ).resolves.toBeTruthy();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('aborts a project-scoped copy install when the target contains nested skills', async () => {
    const root = await mkdtemp(join(tmpdir(), 'skills-1723-project-'));
    const skillDir = await makeSkillSource(root, 'research');
    const projectDir = join(root, 'project');
    await makeCategory(join(projectDir, '.hermes', 'skills'), 'research', ['arxiv']);

    try {
      const result = await installer.installSkillForAgent(
        { name: 'research', description: 'test', path: skillDir },
        'hermes-agent',
        { cwd: projectDir, mode: 'copy' }
      );

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/category directory/i);
      await expect(
        stat(join(projectDir, '.hermes', 'skills', 'research', 'arxiv', 'SKILL.md'))
      ).resolves.toBeTruthy();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
