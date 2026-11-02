import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { lstat, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { installSkillForAgent } from '../src/installer.ts';
import { materializeUseSkill } from '../src/use.ts';

const SECRET = 'PRIVATE-HOST-KEY-MATERIAL';
const SKILL_NAME = 'nested-symlink-skill';

/**
 * Builds a skill whose top-level links all point inside the skill, but where an
 * internal directory reached through an alias contains links to host files.
 */
async function makeFixture(root: string): Promise<string> {
  const outside = join(root, 'outside');
  await mkdir(join(outside, 'dir'), { recursive: true });
  await writeFile(join(outside, 'id_ed25519'), SECRET);
  await writeFile(join(outside, 'dir', 'config'), SECRET);

  const skill = join(root, 'skill');
  await mkdir(join(skill, 'internal'), { recursive: true });
  await mkdir(join(skill, 'docs', 'deep'), { recursive: true });
  await mkdir(join(skill, 'loop'), { recursive: true });
  await writeFile(join(skill, 'SKILL.md'), `---\nname: ${SKILL_NAME}\ndescription: test\n---\n`);

  // (a) internal dir alias whose target contains links that escape the skill
  await writeFile(join(skill, 'internal', 'readme.md'), 'internal readme');
  await symlink(join(outside, 'id_ed25519'), join(skill, 'internal', 'leak'));
  await symlink('../../outside/dir', join(skill, 'internal', 'leakdir'));
  await symlink('internal', join(skill, 'alias'));

  // (b) symlink cycles back to the skill root and to the containing directory
  await symlink('..', join(skill, 'loop', 'root'));
  await symlink('../loop', join(skill, 'loop', 'self'));

  // (c) legitimate internal directory and file links
  await writeFile(join(skill, 'docs', 'guide.md'), 'guide');
  await writeFile(join(skill, 'docs', 'deep', 'nested.md'), 'nested');
  await symlink('docs', join(skill, 'docs-link'));
  await symlink('docs/guide.md', join(skill, 'guide-link.md'));

  return skill;
}

async function listTree(dir: string, base = dir): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await listTree(full, base)));
    else out.push(relative(base, full).split(sep).join('/'));
  }
  return out.sort();
}

async function expectConfinedCopy(installedDir: string): Promise<void> {
  // The copy itself is real files only, with no links left to follow.
  expect((await lstat(installedDir)).isDirectory()).toBe(true);
  const files = await listTree(installedDir);
  for (const file of files) {
    expect((await lstat(join(installedDir, file))).isSymbolicLink()).toBe(false);
    expect(await readFile(join(installedDir, file), 'utf-8')).not.toContain(SECRET);
  }

  // Escaping links are dropped, both directly and through the alias.
  expect(files).not.toContain('internal/leak');
  expect(files).not.toContain('alias/leak');
  expect(files.some((f) => f.includes('leakdir'))).toBe(false);

  // Cycles are cut rather than expanded.
  expect(files.some((f) => f.startsWith('loop/'))).toBe(false);

  // Legitimate internal links are materialized.
  expect(files).toEqual(
    expect.arrayContaining([
      'SKILL.md',
      'alias/readme.md',
      'internal/readme.md',
      'docs/guide.md',
      'docs/deep/nested.md',
      'docs-link/guide.md',
      'docs-link/deep/nested.md',
      'guide-link.md',
    ])
  );
  expect(await readFile(join(installedDir, 'alias', 'readme.md'), 'utf-8')).toBe('internal readme');
  expect(await readFile(join(installedDir, 'guide-link.md'), 'utf-8')).toBe('guide');
}

describe('nested symlink confinement', () => {
  let root: string;
  let skillDir: string;
  let projectDir: string;
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'skills-nested-symlink-'));
    skillDir = await makeFixture(root);
    projectDir = join(root, 'project');
    await mkdir(projectDir, { recursive: true });
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(async () => {
    warn.mockRestore();
    await rm(root, { recursive: true, force: true });
  });

  function expectWarnings(): void {
    const messages = warn.mock.calls.map((c) => String(c[0]));
    expect(messages).toContainEqual(
      expect.stringMatching(/outside the skill directory: .*alias[\\/]leak$/)
    );
    expect(messages).toContainEqual(expect.stringMatching(/directory cycle/));
  }

  it('copy mode does not materialize files behind nested links', async () => {
    const result = await installSkillForAgent(
      { name: SKILL_NAME, description: 'test', path: skillDir },
      'codex',
      { cwd: projectDir, mode: 'copy', global: false }
    );
    expect(result.success).toBe(true);
    await expectConfinedCopy(join(projectDir, '.agents/skills', SKILL_NAME));
    expectWarnings();
  });

  it('symlink mode does not materialize files behind nested links in the canonical copy', async () => {
    const result = await installSkillForAgent(
      { name: SKILL_NAME, description: 'test', path: skillDir },
      'claude-code',
      { cwd: projectDir, mode: 'symlink', global: false, createMissingAgentRoot: true }
    );
    expect(result.success).toBe(true);
    await expectConfinedCopy(join(projectDir, '.agents/skills', SKILL_NAME));
    expect(
      await readFile(join(projectDir, '.claude/skills', SKILL_NAME, 'alias', 'readme.md'), 'utf-8')
    ).toBe('internal readme');
    expectWarnings();
  });

  it('skills use does not materialize files behind nested links', async () => {
    const materialized = await materializeUseSkill({
      kind: 'disk',
      name: SKILL_NAME,
      directoryName: SKILL_NAME,
      path: skillDir,
    });
    try {
      await expectConfinedCopy(materialized.skillDir);
      expectWarnings();
    } finally {
      await rm(materialized.tempRoot, { recursive: true, force: true });
    }
  });
});
