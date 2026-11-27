/**
 * Regression tests for repos that expose one skill tree at several paths.
 *
 * A repo that keeps skills in `.agents/skills` and symlinks `.claude` to
 * `.agents` (a common layout for supporting both conventions) reports every
 * skill at two paths. Full-depth discovery is what `skills update` uses for
 * sources whose subpath cannot be appended to the source URL, and a duplicate
 * entry there makes `resolveSkillLocations` treat the skill as an ambiguous
 * relocation: it is neither updated nor checked for deletion.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { join, relative, dirname, sep } from 'path';
import { tmpdir } from 'os';
import { discoverSkills } from '../src/skills.ts';

const isWindows = process.platform === 'win32';

function writeSkill(skillDir: string, name: string): void {
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(
    join(skillDir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${name} skill\n---\n\n# ${name}\n`
  );
}

/** Link a directory the way the CLI does: relative on POSIX, junction on Windows. */
function linkDir(targetDir: string, linkPath: string): void {
  if (isWindows) symlinkSync(targetDir, linkPath, 'junction');
  else symlinkSync(relative(dirname(linkPath), targetDir), linkPath, 'dir');
}

function toPosix(path: string): string {
  return path.split(sep).join('/');
}

describe('discoverSkills with a symlinked skill tree', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `skills-symlink-discovery-${Date.now()}-${Math.random()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('reports a skill once when .claude is symlinked to .agents', async () => {
    writeSkill(join(testDir, '.agents', 'skills', 'demo-skill'), 'demo-skill');
    linkDir(join(testDir, '.agents'), join(testDir, '.claude'));

    const skills = await discoverSkills(testDir, undefined, {
      fullDepth: true,
      includeDuplicateNames: true,
    });

    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe('demo-skill');
    // The first path found stays authoritative so locked `skillPath` values match.
    expect(toPosix(relative(testDir, skills[0].path))).toBe('.agents/skills/demo-skill');
  });

  it('still reports skills in genuinely separate directories', async () => {
    writeSkill(join(testDir, '.agents', 'skills', 'dup-skill'), 'dup-skill');
    writeSkill(join(testDir, 'skills', 'dup-skill'), 'dup-skill');

    const skills = await discoverSkills(testDir, undefined, {
      fullDepth: true,
      includeDuplicateNames: true,
    });

    expect(skills).toHaveLength(2);
    expect(skills.map((skill) => toPosix(relative(testDir, skill.path))).sort()).toEqual([
      '.agents/skills/dup-skill',
      'skills/dup-skill',
    ]);
  });
});
