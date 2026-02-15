import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { parseAgentsOptions } from './agents-md.ts';
import { runCliOutput } from './test-utils.ts';

function createProjectSkill(
  testDir: string,
  folderName: string,
  skillName: string,
  description: string
): void {
  const skillDir = join(testDir, '.agents', 'skills', folderName);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(
    join(skillDir, 'SKILL.md'),
    `---
name: ${skillName}
description: ${description}
---

# ${skillName}
`
  );
}

describe('agents command', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `skills-agents-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('parseAgentsOptions', () => {
    it('should parse --global and -g', () => {
      expect(parseAgentsOptions(['--global'])).toEqual({ global: true });
      expect(parseAgentsOptions(['-g'])).toEqual({ global: true });
      expect(parseAgentsOptions([])).toEqual({});
    });
  });

  it('should create AGENTS.md and add managed skills section', () => {
    createProjectSkill(
      testDir,
      'project-skill',
      'project-skill',
      'A project skill description for AGENTS.md'
    );

    const output = runCliOutput(['agents'], testDir);
    expect(output).toContain('Updated AGENTS.md with 1 project skill(s).');

    const agentsMdPath = join(testDir, 'AGENTS.md');
    expect(existsSync(agentsMdPath)).toBe(true);

    const content = readFileSync(agentsMdPath, 'utf-8');
    expect(content).toContain('# AGENTS.md');
    expect(content).toContain('<!-- skills:agents:start -->');
    expect(content).toContain('<!-- skills:agents:end -->');
    expect(content).toContain('| Skill | Description |');
    expect(content).toContain('| `project-skill` | A project skill description for AGENTS.md |');
  });

  it('should update an existing managed section without touching surrounding content', () => {
    createProjectSkill(testDir, 'my-skill', 'my-skill', 'Fresh description');

    const agentsMdPath = join(testDir, 'AGENTS.md');
    writeFileSync(
      agentsMdPath,
      `# AGENTS.md

Custom intro.

<!-- skills:agents:start -->
## Skills

Old managed content
<!-- skills:agents:end -->

Custom footer.
`
    );

    runCliOutput(['agents'], testDir);

    const content = readFileSync(agentsMdPath, 'utf-8');
    expect(content).toContain('Custom intro.');
    expect(content).toContain('Custom footer.');
    expect(content).not.toContain('Old managed content');
    expect(content.match(/<!-- skills:agents:start -->/g)?.length).toBe(1);
    expect(content.match(/<!-- skills:agents:end -->/g)?.length).toBe(1);
    expect(content).toContain('| `my-skill` | Fresh description |');
  });

  it('should append a managed section when AGENTS.md exists without markers', () => {
    createProjectSkill(testDir, 'app-skill', 'app-skill', 'App skill description');

    const agentsMdPath = join(testDir, 'AGENTS.md');
    writeFileSync(
      agentsMdPath,
      `# AGENTS.md

Project-specific instructions.
`
    );

    runCliOutput(['agents'], testDir);

    const content = readFileSync(agentsMdPath, 'utf-8');
    expect(content).toContain('Project-specific instructions.');
    expect(content).toContain('<!-- skills:agents:start -->');
    expect(content).toContain('<!-- skills:agents:end -->');
    expect(content).toContain('| `app-skill` | App skill description |');
  });
});
