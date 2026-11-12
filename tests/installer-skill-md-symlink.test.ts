import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { installSkillForAgent } from '../src/installer.ts';

const SKILL_MD = '---\nname: alpha\ndescription: test\n---\n# alpha\n';

/**
 * A repo whose agent-facing skill folder is made of links into the real skill
 * folder beside it, the way getsentry/toolkit publishes sentry-cli.
 */
async function makeFixture(repo: string): Promise<{ real: string; alias: string }> {
  const real = join(repo, 'plugins', 'alpha', 'skills', 'alpha');
  const alias = join(repo, '.cursor', 'skills', 'alpha');
  await mkdir(join(real, 'references'), { recursive: true });
  await mkdir(alias, { recursive: true });
  await writeFile(join(real, 'SKILL.md'), SKILL_MD);
  await writeFile(join(real, 'references', 'a.md'), 'a');
  await symlink('../../../plugins/alpha/skills/alpha/SKILL.md', join(alias, 'SKILL.md'));
  await symlink('../../../plugins/alpha/skills/alpha/references', join(alias, 'references'));
  return { real, alias };
}

describe('a skill whose SKILL.md is a symlink outside the skill directory', () => {
  let root: string;
  let project: string;
  let real: string;
  let alias: string;
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'skills-skill-md-symlink-'));
    ({ real, alias } = await makeFixture(join(root, 'repo')));
    project = join(root, 'project');
    await mkdir(project, { recursive: true });
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(async () => {
    warn.mockRestore();
    await rm(root, { recursive: true, force: true });
  });

  const skill = (path: string) => ({ name: 'alpha', description: 'test', path });

  it('is refused in copy mode, keeping the files already installed', async () => {
    const installed = join(project, '.agents', 'skills', 'alpha');
    await mkdir(installed, { recursive: true });
    await writeFile(join(installed, 'SKILL.md'), 'previous install');

    const result = await installSkillForAgent(skill(alias), 'codex', {
      cwd: project,
      mode: 'copy',
      global: false,
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/SKILL\.md is a symlink to \S+ outside the skill directory/);
    expect(await readFile(join(installed, 'SKILL.md'), 'utf-8')).toBe('previous install');
  });

  it('is refused in symlink mode, keeping the canonical copy', async () => {
    const canonical = join(project, '.agents', 'skills', 'alpha');
    await mkdir(canonical, { recursive: true });
    await writeFile(join(canonical, 'SKILL.md'), 'previous install');

    const result = await installSkillForAgent(skill(alias), 'claude-code', {
      cwd: project,
      mode: 'symlink',
      global: false,
      createMissingAgentRoot: true,
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/SKILL\.md is a symlink to \S+ outside the skill directory/);
    expect(await readFile(join(canonical, 'SKILL.md'), 'utf-8')).toBe('previous install');
    expect(existsSync(join(project, '.claude', 'skills', 'alpha'))).toBe(false);
  });

  it('still installs when only a supporting entry links outside', async () => {
    const mixed = join(root, 'repo', 'mixed');
    await mkdir(mixed, { recursive: true });
    await writeFile(join(mixed, 'SKILL.md'), SKILL_MD);
    await symlink(join(real, 'references'), join(mixed, 'references'));

    const result = await installSkillForAgent(skill(mixed), 'codex', {
      cwd: project,
      mode: 'copy',
      global: false,
    });

    expect(result.success).toBe(true);
    const installed = join(project, '.agents', 'skills', 'alpha');
    expect(await readFile(join(installed, 'SKILL.md'), 'utf-8')).toBe(SKILL_MD);
    expect(existsSync(join(installed, 'references'))).toBe(false);
    expect(warn.mock.calls.map((c) => String(c[0]))).toContainEqual(
      expect.stringMatching(/outside the skill directory: .*references$/)
    );
  });
});
