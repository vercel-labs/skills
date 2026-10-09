import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { lstat, readFile } from 'fs/promises';
import { homedir, tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { agents, getNonUniversalAgents, isAbacusAIInstalled } from '../src/agents.ts';
import { findSkillMdPaths } from '../src/blob.ts';
import { getAgentBaseDir, installSkillForAgent, listInstalledSkills } from '../src/installer.ts';
import { discoverSkills } from '../src/skills.ts';

const skillFile = `---
name: test-skill
description: Test skill
---

# Test skill
`;

describe('Abacus.AI CLI agent support', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'skills-abacusai-'));
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('targets the native project and global directories', () => {
    expect(agents.abacusai.displayName).toBe('Abacus.AI CLI');
    expect(getAgentBaseDir('abacusai', false, testDir)).toBe(join(testDir, '.abacusai', 'skills'));
    expect(getAgentBaseDir('abacusai', true)).toBe(join(homedir(), '.abacusai', 'skills'));
    expect(getNonUniversalAgents()).toContain('abacusai');
  });

  it('detects an installation from the user config directory', () => {
    const home = join(testDir, 'home');
    expect(isAbacusAIInstalled(home)).toBe(false);
    mkdirSync(join(home, '.abacusai'), { recursive: true });
    expect(isAbacusAIInstalled(home)).toBe(true);
  });

  it('discovers native project skills alongside shared skills', async () => {
    for (const directory of ['.abacusai', '.agents']) {
      const skillDir = join(testDir, directory, 'skills', directory.slice(1));
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(
        join(skillDir, 'SKILL.md'),
        skillFile.replaceAll('test-skill', directory.slice(1))
      );
    }
    const skills = await discoverSkills(testDir);
    expect(skills.map((skill) => skill.name).sort()).toEqual(['abacusai', 'agents']);
  });

  it('includes native skills in the GitHub tree fast path', () => {
    expect(
      findSkillMdPaths({
        sha: 'root-sha',
        branch: 'main',
        tree: [
          { path: 'skills/shared/SKILL.md', type: 'blob', sha: 'shared-sha' },
          { path: '.abacusai/skills/native/SKILL.md', type: 'blob', sha: 'native-sha' },
        ],
      })
    ).toContain('.abacusai/skills/native/SKILL.md');
  });

  it.each(['symlink', 'copy'] as const)(
    'installs and lists project skills in %s mode',
    async (mode) => {
      const sourceDir = join(testDir, 'source');
      const projectDir = join(testDir, 'project');
      mkdirSync(sourceDir);
      mkdirSync(projectDir);
      writeFileSync(join(sourceDir, 'SKILL.md'), skillFile);

      const result = await installSkillForAgent(
        { name: 'test-skill', description: 'Test skill', path: sourceDir },
        'abacusai',
        { cwd: projectDir, global: false, mode, createMissingAgentRoot: true }
      );

      expect(result.success).toBe(true);
      const installedDir = join(projectDir, '.abacusai', 'skills', 'test-skill');
      expect(await readFile(join(installedDir, 'SKILL.md'), 'utf-8')).toBe(skillFile);
      expect((await lstat(installedDir)).isSymbolicLink()).toBe(mode === 'symlink');
      const installed = await listInstalledSkills({ cwd: projectDir, agentFilter: ['abacusai'] });
      expect(
        installed.some((skill) => skill.name === 'test-skill' && skill.agents.includes('abacusai'))
      ).toBe(true);
      if (mode === 'copy') {
        await expect(lstat(join(projectDir, '.agents', 'skills', 'test-skill'))).rejects.toThrow();
      }
    }
  );
});
