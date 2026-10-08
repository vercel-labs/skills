import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { homedir, tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as agentModule from '../src/agents.ts';
import { findSkillMdPaths } from '../src/blob.ts';
import { discoverSkills } from '../src/skills.ts';

type InstallationDetector = (homeDir?: string, pathExists?: (path: string) => boolean) => boolean;

function getDetector(): InstallationDetector | undefined {
  return Reflect.get(agentModule, 'isMiniMaxCodeInstalled') as InstallationDetector | undefined;
}

const skillFile = (name: string) => `---
name: ${name}
description: ${name} test skill
---

# ${name}
`;

describe('MiniMax Code agent support', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'skills-minimax-code-'));
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('uses the documented project and global skill directories', () => {
    const agent = Reflect.get(agentModule.agents, 'minimax-code');

    expect(agent?.name).toBe('minimax-code');
    expect(agent?.displayName).toBe('MiniMax Code');
    expect(agent?.skillsDir).toBe('.minimax/skills');
    expect(agent?.globalSkillsDir).toBe(join(homedir(), '.minimax', 'skills'));
  });

  it('detects MiniMax Code from its home directory', () => {
    const home = '/tmp/home';
    const exists = (path: string) => path === join(home, '.minimax');

    expect(getDetector()?.(home, exists)).toBe(true);
  });

  it('detects MiniMax Code from the macOS app bundle', () => {
    const exists = (path: string) => path === '/Applications/MiniMax Code.app';

    expect(getDetector()?.('/tmp/home', exists)).toBe(true);
  });

  it('returns false when no known MiniMax Code path exists', () => {
    expect(getDetector()?.('/tmp/home', () => false)).toBe(false);
  });

  it('discovers project skills from .minimax/skills alongside standard skills', async () => {
    const minimaxSkillDir = join(testDir, '.minimax', 'skills', 'minimax-skill');
    const standardSkillDir = join(testDir, 'skills', 'standard-skill');
    mkdirSync(minimaxSkillDir, { recursive: true });
    mkdirSync(standardSkillDir, { recursive: true });
    writeFileSync(join(minimaxSkillDir, 'SKILL.md'), skillFile('minimax-skill'));
    writeFileSync(join(standardSkillDir, 'SKILL.md'), skillFile('standard-skill'));

    const discovered = await discoverSkills(testDir);

    expect(discovered.map((skill) => skill.name).sort()).toEqual([
      'minimax-skill',
      'standard-skill',
    ]);
  });

  it('discovers .minimax/skills through the GitHub tree fast path', () => {
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
          path: '.minimax/skills/minimax-skill/SKILL.md',
          type: 'blob',
          sha: 'minimax-sha',
        },
      ],
    });

    expect(discovered).toContain('.minimax/skills/minimax-skill/SKILL.md');
  });
});
