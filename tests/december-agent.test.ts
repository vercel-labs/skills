import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { homedir, tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { agents, isDecemberInstalled } from '../src/agents.ts';
import { findSkillMdPaths } from '../src/blob.ts';
import { discoverSkills } from '../src/skills.ts';

const skillFile = (name: string) => `---
name: ${name}
description: ${name} test skill
---

# ${name}
`;

describe('December agent support', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'skills-december-'));
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('uses the documented project and global skill directories', () => {
    expect(agents.december.name).toBe('december');
    expect(agents.december.displayName).toBe('December');
    expect(agents.december.skillsDir).toBe('.december/skills');
    expect(agents.december.globalSkillsDir).toBe(join(homedir(), '.december', 'skills'));
  });

  it('detects December from its documented config directory in home or cwd', () => {
    const home = '/tmp/home';
    const cwd = '/tmp/project';
    const existsHome = (path: string) => path === join(home, '.december');
    const existsCwd = (path: string) => path === join(cwd, '.december');

    expect(isDecemberInstalled(home, cwd, existsHome)).toBe(true);
    expect(isDecemberInstalled(home, cwd, existsCwd)).toBe(true);
  });

  it('returns false when the December config directory is absent', () => {
    expect(isDecemberInstalled('/tmp/home', '/tmp/project', () => false)).toBe(false);
  });

  it('detects December from DECEMBER_HOME environment override', () => {
    const originalEnv = process.env.DECEMBER_HOME;
    try {
      process.env.DECEMBER_HOME = '/custom/december';
      const exists = (path: string) => path === '/custom/december';
      expect(isDecemberInstalled('/tmp/home', '/tmp/project', exists)).toBe(true);
    } finally {
      if (originalEnv !== undefined) {
        process.env.DECEMBER_HOME = originalEnv;
      } else {
        delete process.env.DECEMBER_HOME;
      }
    }
  });

  it('detects installed agent via detectInstalled', async () => {
    const isInstalled = await agents.december.detectInstalled();
    expect(typeof isInstalled).toBe('boolean');
  });

  it('discovers project skills from .december/skills alongside other priority skills', async () => {
    const decemberSkillDir = join(testDir, '.december', 'skills', 'december-skill');
    const standardSkillDir = join(testDir, 'skills', 'standard-skill');
    mkdirSync(decemberSkillDir, { recursive: true });
    mkdirSync(standardSkillDir, { recursive: true });
    writeFileSync(join(decemberSkillDir, 'SKILL.md'), skillFile('december-skill'));
    writeFileSync(join(standardSkillDir, 'SKILL.md'), skillFile('standard-skill'));

    const discovered = await discoverSkills(testDir);

    expect(discovered.map((skill) => skill.name).sort()).toEqual([
      'december-skill',
      'standard-skill',
    ]);
  });

  it('discovers .december/skills through the GitHub tree fast path', () => {
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
          path: '.december/skills/december-skill/SKILL.md',
          type: 'blob',
          sha: 'december-sha',
        },
      ],
    });

    expect(discovered).toContain('.december/skills/december-skill/SKILL.md');
  });
});
