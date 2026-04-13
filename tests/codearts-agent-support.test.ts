import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { agents } from '../src/agents.ts';
import { discoverSkills } from '../src/skills.ts';

describe('CodeArts Agent support', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  it('registers the expected CodeArts Agent directories', () => {
    expect(agents['codearts-agent'].displayName).toBe('CodeArts Agent');
    expect(agents['codearts-agent'].skillsDir).toBe('.codeartsdoer/skills');
    expect(agents['codearts-agent'].globalSkillsDir).toContain('.codeartsdoer/skills');
  });

  it('discovers skills from the CodeArts Agent project directory', async () => {
    const testDir = join(
      tmpdir(),
      `skills-codearts-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    tempDirs.push(testDir);

    const skillDir = join(testDir, '.codeartsdoer', 'skills', 'codearts-skill');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      `---
name: codearts-skill
description: CodeArts Agent skill
---

# CodeArts skill
`
    );

    const skills = await discoverSkills(testDir);

    expect(skills).toHaveLength(1);
    expect(skills[0]?.name).toBe('codearts-skill');
    expect(skills[0]?.path).toBe(skillDir);
  });
});
