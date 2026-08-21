/**
 * A repository whose skill container is capitalised (`Skills/`) must be
 * discovered under the path it actually has on disk.
 *
 * `discoverSkills` probed a hardcoded lowercase `skills` literal. On a
 * case-insensitive filesystem that probe resolves the real `Skills/` directory,
 * so every discovered path carried the fabricated lowercase casing and was
 * recorded as `skillPath` in the lock file — where the case-sensitive compares
 * against a git tree then fail, leaving the skill permanently untrackable and
 * reported as deleted upstream. On a case-sensitive filesystem the same probe
 * simply missed the directory and the skills were not found at all.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join, sep } from 'path';
import { discoverSkills } from '../src/skills.ts';
import { getSkillFolderHashFromTree } from '../src/blob.ts';
import { checkAndPromptForDeletions } from '../src/update.ts';

let repoDir: string;

async function writeSkill(container: string, name: string): Promise<void> {
  const dir = join(repoDir, ...container.split('/'), name);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: A skill used to verify container casing is preserved.\n---\n\nBody.\n`
  );
}

beforeEach(async () => {
  repoDir = await mkdtemp(join(tmpdir(), 'skills-casing-'));
});

afterEach(async () => {
  await rm(repoDir, { recursive: true, force: true });
});

describe('discoverSkills container casing', () => {
  it('discovers skills under a capitalised Skills/ directory', async () => {
    await writeSkill('Skills', 'capitalised-container');

    const skills = await discoverSkills(repoDir);

    expect(skills.map((skill) => skill.name)).toEqual(['capitalised-container']);
  });

  it('records the real on-disk casing, not the probed lowercase spelling', async () => {
    await writeSkill('Skills', 'capitalised-container');

    const [skill] = await discoverSkills(repoDir);

    // The path is what becomes `skillPath` in the lock file, so it has to match
    // the repository byte for byte.
    expect(skill!.path.endsWith(join('Skills', 'capitalised-container'))).toBe(true);
    expect(skill!.path).not.toContain(`${sep}skills${sep}`);
  });

  it('still finds skills under a lowercase skills/ directory', async () => {
    await writeSkill('skills', 'lowercase-container');

    const [skill] = await discoverSkills(repoDir);

    expect(skill!.name).toBe('lowercase-container');
    expect(skill!.path.endsWith(join('skills', 'lowercase-container'))).toBe(true);
  });
});

describe('getSkillFolderHashFromTree', () => {
  const tree = {
    sha: 'root-sha',
    branch: 'main',
    tree: [
      { path: 'Skills', type: 'tree', sha: 'container-sha' },
      { path: 'Skills/my-skill', type: 'tree', sha: 'skill-sha' },
      { path: 'Skills/my-skill/SKILL.md', type: 'blob', sha: 'blob-sha' },
    ],
  } as unknown as Parameters<typeof getSkillFolderHashFromTree>[0];

  it('resolves a path recorded with the wrong casing', () => {
    // Locks written before the casing fix hold the lowercase spelling; those
    // skills must stay trackable rather than being reported as deleted.
    expect(getSkillFolderHashFromTree(tree, 'skills/my-skill/SKILL.md')).toBe('skill-sha');
  });

  it('resolves an exactly-cased path', () => {
    expect(getSkillFolderHashFromTree(tree, 'Skills/my-skill/SKILL.md')).toBe('skill-sha');
  });

  it('returns null for a path that is genuinely absent', () => {
    expect(getSkillFolderHashFromTree(tree, 'Skills/gone/SKILL.md')).toBeNull();
  });
});

describe('checkAndPromptForDeletions', () => {
  const discovered = ['Skills/my-skill/SKILL.md'];

  it('does not treat a casing-only mismatch as a deletion', async () => {
    const deleted = await checkAndPromptForDeletions(
      'owner/repo',
      ['my-skill'],
      { 'my-skill': { skillPath: 'skills/my-skill/SKILL.md' } },
      true,
      { yes: true },
      discovered
    );

    expect(deleted).toEqual([]);
  });

  it('still reports a skill that is absent upstream', async () => {
    const deleted = await checkAndPromptForDeletions(
      'owner/repo',
      ['gone'],
      { gone: { skillPath: 'Skills/gone/SKILL.md' } },
      true,
      { yes: true },
      discovered
    );

    expect(deleted).toEqual(['gone']);
  });
});
