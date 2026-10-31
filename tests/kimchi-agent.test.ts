import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { homedir, tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { agents, isKimchiInstalled } from '../src/agents.ts';
import { findSkillMdPaths } from '../src/blob.ts';
import { discoverSkills } from '../src/skills.ts';

const skillFile = (name: string) => `---
name: ${name}
description: ${name} test skill
---

# ${name}
`;

describe('Kimchi agent support', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'skills-kimchi-'));
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('uses the documented project and global skill directories', () => {
    expect(agents.kimchi.name).toBe('kimchi');
    expect(agents.kimchi.displayName).toBe('Kimchi');
    expect(agents.kimchi.skillsDir).toBe('.kimchi/skills');
    expect(agents.kimchi.globalSkillsDir).toBe(
      join(homedir(), '.config', 'kimchi', 'harness', 'skills')
    );
  });

  it('detects Kimchi from its documented config directory', () => {
    const home = '/tmp/home';
    const exists = (path: string) => path === join(home, '.config', 'kimchi');

    expect(isKimchiInstalled(home, exists)).toBe(true);
  });

  it('returns false when the Kimchi config directory is absent', () => {
    expect(isKimchiInstalled('/tmp/home', () => false)).toBe(false);
  });

  it('discovers project skills from .kimchi/skills alongside other priority skills', async () => {
    const kimchiSkillDir = join(testDir, '.kimchi', 'skills', 'kimchi-skill');
    const standardSkillDir = join(testDir, 'skills', 'standard-skill');
    mkdirSync(kimchiSkillDir, { recursive: true });
    mkdirSync(standardSkillDir, { recursive: true });
    writeFileSync(join(kimchiSkillDir, 'SKILL.md'), skillFile('kimchi-skill'));
    writeFileSync(join(standardSkillDir, 'SKILL.md'), skillFile('standard-skill'));

    const discovered = await discoverSkills(testDir);

    expect(discovered.map((skill) => skill.name).sort()).toEqual([
      'kimchi-skill',
      'standard-skill',
    ]);
  });

  it('discovers .kimchi/skills through the GitHub tree fast path', () => {
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
          path: '.kimchi/skills/kimchi-skill/SKILL.md',
          type: 'blob',
          sha: 'kimchi-sha',
        },
      ],
    });

    expect(discovered).toContain('.kimchi/skills/kimchi-skill/SKILL.md');
  });
});
