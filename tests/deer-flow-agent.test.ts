import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as agentModule from '../src/agents.ts';
import { findSkillMdPaths } from '../src/blob.ts';
import { discoverSkills } from '../src/skills.ts';

type InstallationDetector = (
  homeDir?: string,
  pathExists?: (path: string) => boolean,
  cwd?: string
) => boolean;

function getDetector(): InstallationDetector | undefined {
  return Reflect.get(agentModule, 'isDeerFlowInstalled') as InstallationDetector | undefined;
}

const skillFile = (name: string) => `---
name: ${name}
description: ${name} test skill
---

# ${name}
`;

describe('DeerFlow agent support', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'skills-deer-flow-'));
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('uses the documented project and global skill directories', () => {
    const agent = Reflect.get(agentModule.agents, 'deer-flow');

    expect(agent?.name).toBe('deer-flow');
    expect(agent?.displayName).toBe('DeerFlow');
    expect(agent?.skillsDir).toBe('skills/public');
    expect(agent?.globalSkillsDir).toBeUndefined();
  });

  it('detects DeerFlow from its home directory', () => {
    const home = '/tmp/home';
    const exists = (path: string) => path === join(home, '.deer-flow');

    expect(getDetector()?.(home, exists, '/tmp/nowhere')).toBe(true);
  });

  it('detects DeerFlow from a project-local .deer-flow state directory', () => {
    const cwd = '/tmp/project';
    const exists = (path: string) => path === join(cwd, '.deer-flow');

    expect(getDetector()?.('/tmp/home', exists, cwd)).toBe(true);
  });

  it('detects DeerFlow from a project skills/public layout with harness package', () => {
    const cwd = '/tmp/project';
    const exists = (path: string) =>
      path === join(cwd, 'skills', 'public') ||
      path === join(cwd, 'backend', 'packages', 'harness', 'deerflow');

    expect(getDetector()?.('/tmp/home', exists, cwd)).toBe(true);
  });

  it('does not detect a generic skills/public taxonomy without the harness package', () => {
    const cwd = '/tmp/project';
    const exists = (path: string) => path === join(cwd, 'skills', 'public');

    expect(getDetector()?.('/tmp/home', exists, cwd)).toBe(false);
  });

  it('returns false when no known DeerFlow path exists', () => {
    expect(getDetector()?.('/tmp/home', () => false, '/tmp/nowhere')).toBe(false);
  });

  it('discovers project skills from skills/public', async () => {
    const customSkillDir = join(testDir, 'skills', 'public', 'deer-flow-custom-skill');
    const publicSkillDir = join(testDir, 'skills', 'public', 'deer-flow-public-skill');
    mkdirSync(customSkillDir, { recursive: true });
    mkdirSync(publicSkillDir, { recursive: true });
    writeFileSync(join(customSkillDir, 'SKILL.md'), skillFile('deer-flow-custom-skill'));
    writeFileSync(join(publicSkillDir, 'SKILL.md'), skillFile('deer-flow-public-skill'));

    const discovered = await discoverSkills(testDir);

    expect(discovered.map((skill) => skill.name).sort()).toEqual([
      'deer-flow-custom-skill',
      'deer-flow-public-skill',
    ]);
  });

  it('discovers skills/public through the GitHub tree fast path', () => {
    const discovered = findSkillMdPaths({
      sha: 'root-sha',
      branch: 'main',
      tree: [
        {
          path: 'skills/public/deep-research/SKILL.md',
          type: 'blob',
          sha: 'public-sha',
        },
        {
          path: 'skills/public/deer-flow-skill/SKILL.md',
          type: 'blob',
          sha: 'custom-sha',
        },
      ],
    });

    expect(discovered).toContain('skills/public/deep-research/SKILL.md');
    expect(discovered).toContain('skills/public/deer-flow-skill/SKILL.md');
  });
});
