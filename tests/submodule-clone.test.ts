import { execFile } from 'child_process';
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanupTempDir, cloneRepo } from '../src/git.ts';
import { discoverSkills } from '../src/skills.ts';

function runGit(args: string[], cwd?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd }, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

describe('cloneRepo submodule handling', () => {
  const tempDirs: string[] = [];
  const originalEnv = {
    GIT_CONFIG_COUNT: process.env.GIT_CONFIG_COUNT,
    GIT_CONFIG_KEY_0: process.env.GIT_CONFIG_KEY_0,
    GIT_CONFIG_VALUE_0: process.env.GIT_CONFIG_VALUE_0,
  };

  afterEach(async () => {
    if (originalEnv.GIT_CONFIG_COUNT === undefined) delete process.env.GIT_CONFIG_COUNT;
    else process.env.GIT_CONFIG_COUNT = originalEnv.GIT_CONFIG_COUNT;
    if (originalEnv.GIT_CONFIG_KEY_0 === undefined) delete process.env.GIT_CONFIG_KEY_0;
    else process.env.GIT_CONFIG_KEY_0 = originalEnv.GIT_CONFIG_KEY_0;
    if (originalEnv.GIT_CONFIG_VALUE_0 === undefined) delete process.env.GIT_CONFIG_VALUE_0;
    else process.env.GIT_CONFIG_VALUE_0 = originalEnv.GIT_CONFIG_VALUE_0;

    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('populates submodule contents so nested skills are discoverable', async () => {
    const root = await mkdtemp(join(tmpdir(), 'skills-submodule-test-'));
    tempDirs.push(root);
    const child = join(root, 'child');
    const parent = join(root, 'parent');

    // A standalone repo that carries a skill, later consumed as a submodule.
    await runGit(['init', '-b', 'main', child]);
    await runGit(['config', 'user.email', 'skills-test@example.com'], child);
    await runGit(['config', 'user.name', 'Skills Test'], child);
    await writeFile(
      join(child, 'SKILL.md'),
      `---
name: submoduled-skill
description: A skill that lives in a git submodule
---

# Submoduled Skill
`
    );
    await runGit(['add', '.'], child);
    await runGit(['commit', '-m', 'child fixture'], child);

    // The parent repo contains the skill only by reference.
    await runGit(['init', '-b', 'main', parent]);
    await runGit(['config', 'user.email', 'skills-test@example.com'], parent);
    await runGit(['config', 'user.name', 'Skills Test'], parent);
    // Git refuses file:// submodules by default (CVE-2022-39253); the fixture
    // opts in explicitly rather than relaxing the setting for the clone itself.
    await runGit(
      ['-c', 'protocol.file.allow=always', 'submodule', 'add', child, 'skills/child'],
      parent
    );
    await runGit(['commit', '-m', 'parent fixture'], parent);

    // Same opt-in for the recursive clone, which resolves the file:// submodule URL.
    process.env.GIT_CONFIG_COUNT = '1';
    process.env.GIT_CONFIG_KEY_0 = 'protocol.file.allow';
    process.env.GIT_CONFIG_VALUE_0 = 'always';

    const cloneDir = await cloneRepo(parent);
    tempDirs.push(cloneDir);

    // Without --recurse-submodules the directory exists but is empty, so the
    // SKILL.md read below fails and discovery returns nothing.
    const submoduledSkill = await readFile(join(cloneDir, 'skills', 'child', 'SKILL.md'), 'utf8');
    expect(submoduledSkill).toContain('name: submoduled-skill');

    const skills = await discoverSkills(cloneDir);
    expect(skills.map((skill) => skill.name)).toContain('submoduled-skill');

    await cleanupTempDir(cloneDir);
    tempDirs.splice(tempDirs.indexOf(cloneDir), 1);
  }, 30_000);
});
