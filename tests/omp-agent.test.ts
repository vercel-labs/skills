import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { mkdtemp, mkdir, rm, readFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { agents } from '../src/agents.ts';
import { findSkillMdPaths } from '../src/blob.ts';
import { installSkillForAgent } from '../src/installer.ts';
import { discoverSkills } from '../src/skills.ts';

const skillFile = (name: string) => `---
name: ${name}
description: ${name} test skill
---

# ${name}
`;

describe('Oh My Pi (omp) agent support', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'skills-omp-'));
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('uses the documented project and global skill directories', () => {
    expect(agents.omp.name).toBe('omp');
    expect(agents.omp.displayName).toBe('Oh My Pi');
    expect(agents.omp.skillsDir).toBe('.omp/skills');
    expect(agents.omp.globalSkillsDir).toBe(join(homedir(), '.omp', 'agent', 'skills'));
  });

  it('installs a skill into .omp/skills', async () => {
    const root = await mkdtemp(join(tmpdir(), 'skills-omp-install-'));
    const projectDir = join(root, 'project');
    const sourceDir = join(root, 'source-skill');
    await mkdir(projectDir, { recursive: true });
    await mkdir(sourceDir, { recursive: true });
    writeFileSync(join(sourceDir, 'SKILL.md'), skillFile('omp-skill'));

    try {
      const result = await installSkillForAgent(
        { name: 'omp-skill', description: 'test', path: sourceDir },
        'omp',
        { cwd: projectDir, mode: 'copy', global: false }
      );

      expect(result.success).toBe(true);
      await expect(
        readFile(join(projectDir, '.omp/skills', 'omp-skill', 'SKILL.md'), 'utf-8')
      ).resolves.toContain('name: omp-skill');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('discovers project skills from .omp/skills alongside standard skills', async () => {
    const ompSkillDir = join(testDir, '.omp', 'skills', 'omp-skill');
    const standardSkillDir = join(testDir, 'skills', 'standard-skill');
    mkdirSync(ompSkillDir, { recursive: true });
    mkdirSync(standardSkillDir, { recursive: true });
    writeFileSync(join(ompSkillDir, 'SKILL.md'), skillFile('omp-skill'));
    writeFileSync(join(standardSkillDir, 'SKILL.md'), skillFile('standard-skill'));

    const discovered = await discoverSkills(testDir);

    expect(discovered.map((skill) => skill.name).sort()).toEqual(['omp-skill', 'standard-skill']);
  });

  it('discovers .omp/skills through the GitHub tree fast path', () => {
    const discovered = findSkillMdPaths({
      sha: 'root-sha',
      branch: 'main',
      tree: [
        {
          path: '.claude/skills/standard-skill/SKILL.md',
          type: 'blob',
          sha: 'standard-sha',
        },
        {
          path: '.omp/skills/omp-skill/SKILL.md',
          type: 'blob',
          sha: 'omp-sha',
        },
      ],
    });

    expect(discovered).toContain('.omp/skills/omp-skill/SKILL.md');
  });
});
