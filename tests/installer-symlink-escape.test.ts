/**
 * Skill files are copied with `dereference: true`, so a symlink is written to
 * disk as a copy of its target's contents. That is correct for a link pointing
 * at a sibling file and wrong for one pointing anywhere else: a skill repo
 * containing `reference.md -> /etc/passwd` would otherwise install a readable
 * copy of that file.
 *
 * It matters more than an ordinary hostile-dependency risk because a skill
 * directory exists to be read into an agent's context — the copied bytes are
 * not merely on disk, they are content the model reads.
 *
 * `readZipArchive` already refuses link entries outright ("Archive links are
 * not supported"), so without this the git path is strictly weaker than the
 * archive path against the same threat.
 */

import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile, symlink, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { installSkillForAgent } from '../src/installer.ts';

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

describe('symlinks that escape the skill directory', () => {
  it('does not copy a file the symlink points to outside the skill', async () => {
    const root = await mkdtemp(join(tmpdir(), 'add-skill-escape-'));
    const projectDir = join(root, 'project');
    const secretDir = join(root, 'secret');
    const skillDir = join(root, 'source-skill');
    await mkdir(projectDir, { recursive: true });
    await mkdir(secretDir, { recursive: true });
    await mkdir(skillDir, { recursive: true });

    const secretPath = join(secretDir, 'id_rsa');
    await writeFile(secretPath, 'PRIVATE-KEY-DO-NOT-COPY', 'utf-8');
    await writeFile(
      join(skillDir, 'SKILL.md'),
      '---\nname: escape\ndescription: t\n---\n',
      'utf-8'
    );
    await symlink(secretPath, join(skillDir, 'reference.md'));

    const result = await installSkillForAgent(
      { name: 'escape', description: 'test', path: skillDir },
      'claude-code',
      { cwd: projectDir, mode: 'copy', global: false }
    );

    expect(result.success).toBe(true);

    const installed = join(projectDir, '.claude/skills/escape');
    expect(await exists(join(installed, 'SKILL.md'))).toBe(true);
    // The link is skipped rather than dereferenced, so no copy of the target.
    expect(await exists(join(installed, 'reference.md'))).toBe(false);
  });

  it('does not copy a directory the symlink points to outside the skill', async () => {
    const root = await mkdtemp(join(tmpdir(), 'add-skill-escape-dir-'));
    const projectDir = join(root, 'project');
    const secretDir = join(root, 'secret');
    const skillDir = join(root, 'source-skill');
    await mkdir(projectDir, { recursive: true });
    await mkdir(secretDir, { recursive: true });
    await mkdir(skillDir, { recursive: true });

    await writeFile(join(secretDir, 'id_rsa'), 'PRIVATE-KEY-DO-NOT-COPY', 'utf-8');
    await writeFile(
      join(skillDir, 'SKILL.md'),
      '---\nname: escapedir\ndescription: t\n---\n',
      'utf-8'
    );
    await symlink(secretDir, join(skillDir, 'docs'));

    await installSkillForAgent(
      { name: 'escapedir', description: 'test', path: skillDir },
      'claude-code',
      { cwd: projectDir, mode: 'copy', global: false }
    );

    const installed = join(projectDir, '.claude/skills/escapedir');
    expect(await exists(join(installed, 'docs/id_rsa'))).toBe(false);
  });

  it('still dereferences a symlink that stays inside the skill', async () => {
    // The behaviour the `dereference: true` comment exists to protect: a link
    // to a sibling would not resolve once the skill has been copied elsewhere.
    const root = await mkdtemp(join(tmpdir(), 'add-skill-inside-'));
    const projectDir = join(root, 'project');
    const skillDir = join(root, 'source-skill');
    await mkdir(projectDir, { recursive: true });
    await mkdir(join(skillDir, 'shared'), { recursive: true });

    await writeFile(
      join(skillDir, 'SKILL.md'),
      '---\nname: inside\ndescription: t\n---\n',
      'utf-8'
    );
    await writeFile(join(skillDir, 'shared/common.md'), 'shared content', 'utf-8');
    await symlink(join(skillDir, 'shared/common.md'), join(skillDir, 'alias.md'));

    await installSkillForAgent(
      { name: 'inside', description: 'test', path: skillDir },
      'claude-code',
      { cwd: projectDir, mode: 'copy', global: false }
    );

    const installed = join(projectDir, '.claude/skills/inside');
    expect(await exists(join(installed, 'alias.md'))).toBe(true);
  });
});
