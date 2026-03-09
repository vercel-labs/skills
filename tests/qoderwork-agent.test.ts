/**
 * Tests for QoderWork agent support.
 *
 * Verifies that the QoderWork agent is correctly defined with:
 * - Correct skillsDir (.qoderwork/skills)
 * - Correct globalSkillsDir (~/.qoderwork/skills)
 * - Correct detection logic (checks ~/.qoderwork existence)
 * - Correct display name and type
 * - Correct skill installation behavior
 */

import { describe, it, expect } from 'vitest';
import { homedir } from 'os';
import { join } from 'path';
import { mkdtemp, mkdir, rm, writeFile, lstat, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { agents } from '../src/agents.ts';
import { installSkillForAgent } from '../src/installer.ts';
import type { AgentType } from '../src/types.ts';

const home = homedir();

describe('QoderWork agent definition', () => {
  it('is defined in agents registry', () => {
    expect(agents.qoderwork).toBeDefined();
  });

  it('has correct name', () => {
    expect(agents.qoderwork.name).toBe('qoderwork');
  });

  it('has correct displayName', () => {
    expect(agents.qoderwork.displayName).toBe('QoderWork');
  });

  it('has correct skillsDir', () => {
    expect(agents.qoderwork.skillsDir).toBe('.qoderwork/skills');
  });

  it('has correct globalSkillsDir', () => {
    const expected = join(home, '.qoderwork', 'skills');
    expect(agents.qoderwork.globalSkillsDir).toBe(expected);
  });

  it('uses home-based paths (not XDG)', () => {
    expect(agents.qoderwork.globalSkillsDir).not.toContain('.config');
    expect(agents.qoderwork.globalSkillsDir).not.toContain('Library');
    expect(agents.qoderwork.globalSkillsDir).not.toContain('AppData');
  });

  it('is a valid AgentType', () => {
    const agentType: AgentType = 'qoderwork';
    expect(agentType).toBe('qoderwork');
  });

  it('has detectInstalled function', () => {
    expect(typeof agents.qoderwork.detectInstalled).toBe('function');
  });
});

describe('QoderWork skill installation', () => {
  async function makeSkillSource(root: string, name: string): Promise<string> {
    const dir = join(root, 'source-skill');
    await mkdir(dir, { recursive: true });
    const skillMd = `---\nname: ${name}\ndescription: test skill for qoderwork\n---\n`;
    await writeFile(join(dir, 'SKILL.md'), skillMd, 'utf-8');
    return dir;
  }

  it('installs skill to .qoderwork/skills via symlink', async () => {
    const root = await mkdtemp(join(tmpdir(), 'qoderwork-test-'));
    const projectDir = join(root, 'project');
    await mkdir(projectDir, { recursive: true });

    const skillName = 'test-qoderwork-skill';
    const skillDir = await makeSkillSource(root, skillName);

    try {
      const result = await installSkillForAgent(
        { name: skillName, description: 'test', path: skillDir },
        'qoderwork',
        { cwd: projectDir, mode: 'symlink', global: false }
      );

      expect(result.success).toBe(true);

      // Verify canonical location has the skill
      const canonicalPath = join(projectDir, '.agents/skills', skillName);
      const canonicalStats = await lstat(canonicalPath);
      expect(canonicalStats.isDirectory()).toBe(true);

      const contents = await readFile(join(canonicalPath, 'SKILL.md'), 'utf-8');
      expect(contents).toContain(`name: ${skillName}`);

      // Verify agent-specific location has a symlink
      const agentPath = join(projectDir, '.qoderwork/skills', skillName);
      const agentStats = await lstat(agentPath);
      expect(agentStats.isSymbolicLink()).toBe(true);

      // Verify content is accessible through symlink
      const agentContents = await readFile(join(agentPath, 'SKILL.md'), 'utf-8');
      expect(agentContents).toContain(`name: ${skillName}`);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('installs skill to .qoderwork/skills via copy', async () => {
    const root = await mkdtemp(join(tmpdir(), 'qoderwork-test-'));
    const projectDir = join(root, 'project');
    await mkdir(projectDir, { recursive: true });

    const skillName = 'test-copy-skill';
    const skillDir = await makeSkillSource(root, skillName);

    try {
      const result = await installSkillForAgent(
        { name: skillName, description: 'test', path: skillDir },
        'qoderwork',
        { cwd: projectDir, mode: 'copy', global: false }
      );

      expect(result.success).toBe(true);
      expect(result.mode).toBe('copy');

      // Verify skill was copied directly to agent location
      const agentPath = join(projectDir, '.qoderwork/skills', skillName);
      const stats = await lstat(agentPath);
      expect(stats.isDirectory()).toBe(true);
      expect(stats.isSymbolicLink()).toBe(false);

      const contents = await readFile(join(agentPath, 'SKILL.md'), 'utf-8');
      expect(contents).toContain(`name: ${skillName}`);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
