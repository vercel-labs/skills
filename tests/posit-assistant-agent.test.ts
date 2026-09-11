import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { homedir, tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { agents, isPositAssistantInstalled } from '../src/agents.ts';
import { findSkillMdPaths } from '../src/blob.ts';
import { discoverSkills } from '../src/skills.ts';

const skillFile = (name: string) => `---
name: ${name}
description: ${name} test skill
---

# ${name}
`;

describe('Posit Assistant agent support', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'skills-posit-assistant-'));
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('uses the documented project and global skill directories', () => {
    const agent = agents['posit-assistant'];

    expect(agent.name).toBe('posit-assistant');
    expect(agent.displayName).toBe('Posit Assistant');
    expect(agent.skillsDir).toBe('.posit/assistant/skills');
    expect(agent.globalSkillsDir).toBe(join(homedir(), '.posit', 'assistant', 'skills'));
  });

  it('detects Posit Assistant from its config directory', () => {
    const home = '/tmp/home';
    const exists = (path: string) => path === join(home, '.posit/assistant');

    expect(isPositAssistantInstalled(home, exists)).toBe(true);
  });

  it('detects Posit Assistant from the legacy config directory', () => {
    const home = '/tmp/home';
    const exists = (path: string) => path === join(home, '.positai');

    expect(isPositAssistantInstalled(home, exists)).toBe(true);
  });

  it('returns false when no known Posit Assistant path exists', () => {
    expect(isPositAssistantInstalled('/tmp/home', () => false)).toBe(false);
  });

  it('discovers project skills from .posit/assistant/skills alongside standard skills', async () => {
    const positSkillDir = join(testDir, '.posit', 'assistant', 'skills', 'posit-skill');
    const standardSkillDir = join(testDir, 'skills', 'standard-skill');
    mkdirSync(positSkillDir, { recursive: true });
    mkdirSync(standardSkillDir, { recursive: true });
    writeFileSync(join(positSkillDir, 'SKILL.md'), skillFile('posit-skill'));
    writeFileSync(join(standardSkillDir, 'SKILL.md'), skillFile('standard-skill'));

    const discovered = await discoverSkills(testDir);

    expect(discovered.map((skill) => skill.name).sort()).toEqual(['posit-skill', 'standard-skill']);
  });

  it('discovers .posit/assistant/skills through the GitHub tree fast path', () => {
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
          path: '.posit/assistant/skills/posit-skill/SKILL.md',
          type: 'blob',
          sha: 'posit-sha',
        },
      ],
    });

    expect(discovered).toContain('.posit/assistant/skills/posit-skill/SKILL.md');
  });
});
