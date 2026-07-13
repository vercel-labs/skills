import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdir, writeFile, rm, symlink, realpath } from 'fs/promises';
import { join } from 'path';
import { homedir, tmpdir, platform } from 'os';
import { listInstalledSkills } from '../src/installer.ts';
import * as agentsModule from '../src/agents.ts';

describe('listInstalledSkills', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `add-skill-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  // Helper to create a skill directory with SKILL.md
  async function createSkillDir(
    basePath: string,
    skillName: string,
    skillData: { name: string; description: string }
  ): Promise<string> {
    const skillDir = join(basePath, '.agents', 'skills', skillName);
    await mkdir(skillDir, { recursive: true });
    const skillMdContent = `---
name: ${skillData.name}
description: ${skillData.description}
---

# ${skillData.name}

${skillData.description}
`;
    await writeFile(join(skillDir, 'SKILL.md'), skillMdContent);
    return skillDir;
  }

  it('should return empty array for empty directory', async () => {
    const skills = await listInstalledSkills({ global: false, cwd: testDir });
    expect(skills).toEqual([]);
  });

  it('should find single skill in project directory', async () => {
    await createSkillDir(testDir, 'test-skill', {
      name: 'test-skill',
      description: 'A test skill',
    });

    const skills = await listInstalledSkills({ global: false, cwd: testDir });
    expect(skills).toHaveLength(1);
    expect(skills[0]!.name).toBe('test-skill');
    expect(skills[0]!.description).toBe('A test skill');
    expect(skills[0]!.scope).toBe('project');
  });

  it('should find multiple skills', async () => {
    await createSkillDir(testDir, 'skill-1', {
      name: 'skill-1',
      description: 'First skill',
    });
    await createSkillDir(testDir, 'skill-2', {
      name: 'skill-2',
      description: 'Second skill',
    });

    const skills = await listInstalledSkills({ global: false, cwd: testDir });
    expect(skills).toHaveLength(2);
    const skillNames = skills.map((s) => s.name).sort();
    expect(skillNames).toEqual(['skill-1', 'skill-2']);
  });

  it('should ignore directories without SKILL.md', async () => {
    await createSkillDir(testDir, 'valid-skill', {
      name: 'valid-skill',
      description: 'Valid skill',
    });

    // Create a directory without SKILL.md
    const invalidDir = join(testDir, '.agents', 'skills', 'invalid-skill');
    await mkdir(invalidDir, { recursive: true });
    await writeFile(join(invalidDir, 'other-file.txt'), 'content');

    const skills = await listInstalledSkills({ global: false, cwd: testDir });
    expect(skills).toHaveLength(1);
    expect(skills[0]!.name).toBe('valid-skill');
  });

  it('should handle invalid SKILL.md gracefully', async () => {
    await createSkillDir(testDir, 'valid-skill', {
      name: 'valid-skill',
      description: 'Valid skill',
    });

    // Create a directory with invalid SKILL.md (missing name/description)
    const invalidDir = join(testDir, '.agents', 'skills', 'invalid-skill');
    await mkdir(invalidDir, { recursive: true });
    await writeFile(join(invalidDir, 'SKILL.md'), '# Invalid\nNo frontmatter');

    const skills = await listInstalledSkills({ global: false, cwd: testDir });
    expect(skills).toHaveLength(1);
    expect(skills[0]!.name).toBe('valid-skill');
  });

  it('should filter by scope - project only', async () => {
    await createSkillDir(testDir, 'project-skill', {
      name: 'project-skill',
      description: 'Project skill',
    });

    const skills = await listInstalledSkills({ global: false, cwd: testDir });
    expect(skills).toHaveLength(1);
    expect(skills[0]!.scope).toBe('project');
  });

  it('should handle global scope option', async () => {
    vi.spyOn(agentsModule, 'detectInstalledAgents').mockResolvedValue([]);

    try {
      // Test with global: true while avoiding environment-dependent scans of every installed agent.
      const skills = await listInstalledSkills({
        global: true,
        cwd: testDir,
        agentFilter: [],
      });
      expect(Array.isArray(skills)).toBe(true);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('attributes global canonical skills to universal agents with native global dirs', async () => {
    vi.spyOn(agentsModule, 'detectInstalledAgents').mockResolvedValue(['opencode']);

    const skillDir = join(homedir(), '.agents', 'skills', 'opencode-global-attribution-test');
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, 'SKILL.md'),
      `---
name: opencode-global-attribution-test
description: Test OpenCode global attribution
---

# opencode-global-attribution-test
`
    );

    try {
      const skills = await listInstalledSkills({
        global: true,
        agentFilter: ['opencode'],
      });

      const skill = skills.find((s) => s.name === 'opencode-global-attribution-test');
      expect(skill).toBeDefined();
      expect(skill!.agents).toContain('opencode');
    } finally {
      vi.restoreAllMocks();
      await rm(skillDir, { recursive: true, force: true });
    }
  });

  it('should apply agent filter', async () => {
    await createSkillDir(testDir, 'test-skill', {
      name: 'test-skill',
      description: 'Test skill',
    });

    // Filter by a specific agent (skill should still be returned)
    const skills = await listInstalledSkills({
      global: false,
      cwd: testDir,
      agentFilter: ['cursor'] as any,
    });
    expect(skills).toHaveLength(1);
    expect(skills[0]!.name).toBe('test-skill');
  });

  // Issue #225 part 1: Only installed agents should be attributed
  it('should only attribute skills to installed agents (issue #225)', async () => {
    // Mock: only Amp is installed (not Kimi, even though they share .agents/skills)
    vi.spyOn(agentsModule, 'detectInstalledAgents').mockResolvedValue(['amp']);

    await createSkillDir(testDir, 'test-skill', {
      name: 'test-skill',
      description: 'Test skill',
    });

    const skills = await listInstalledSkills({ global: false, cwd: testDir });

    expect(skills).toHaveLength(1);
    // Should only show amp, not kimi-code-cli
    expect(skills[0]!.agents).toContain('amp');
    expect(skills[0]!.agents).not.toContain('kimi-code-cli');

    vi.restoreAllMocks();
  });

  // Directory symlinks pointing at a real skill dir should be discovered.
  it('should find skill when the skill directory is a symlink', async () => {
    const realSkillDir = join(testDir, 'shared', 'linked-skill');
    await mkdir(realSkillDir, { recursive: true });
    await writeFile(
      join(realSkillDir, 'SKILL.md'),
      `---
name: linked-skill
description: Skill reached through a directory symlink
---

# linked-skill
`
    );

    const agentSkillsDir = join(testDir, '.agents', 'skills');
    await mkdir(agentSkillsDir, { recursive: true });
    await symlink(
      realSkillDir,
      join(agentSkillsDir, 'linked-skill'),
      platform() === 'win32' ? 'junction' : 'dir'
    );

    const skills = await listInstalledSkills({ global: false, cwd: testDir });
    expect(skills).toHaveLength(1);
    expect(skills[0]!.name).toBe('linked-skill');
  });

  it.skipIf(platform() === 'win32')(
    'should ignore dangling symlinks without a reachable SKILL.md',
    async () => {
      const agentSkillsDir = join(testDir, '.agents', 'skills');
      await mkdir(agentSkillsDir, { recursive: true });
      await symlink(join(testDir, 'does-not-exist'), join(agentSkillsDir, 'broken'), 'dir');

      const skills = await listInstalledSkills({ global: false, cwd: testDir });
      expect(skills).toEqual([]);
    }
  );

  it.skipIf(platform() === 'win32')(
    'should ignore symlinks that point to a regular file',
    async () => {
      const filePath = join(testDir, 'not-a-skill.md');
      await writeFile(filePath, '# not a skill');

      const agentSkillsDir = join(testDir, '.agents', 'skills');
      await mkdir(agentSkillsDir, { recursive: true });
      await symlink(filePath, join(agentSkillsDir, 'file-link'));

      const skills = await listInstalledSkills({ global: false, cwd: testDir });
      expect(skills).toEqual([]);
    }
  );

  it('does not repeatedly parse the same real SKILL.md reached through multiple agent links', async () => {
    const skillName = 'linked-canonical-skill';
    const canonicalSkillDir = join(testDir, '.agents', 'skills', skillName);
    const canonicalSkillMdPath = join(canonicalSkillDir, 'SKILL.md');
    await mkdir(canonicalSkillDir, { recursive: true });
    await writeFile(
      canonicalSkillMdPath,
      `---
name: ${skillName}
description: Skill shared through multiple agent links
---

# ${skillName}
`
    );

    const linkType = platform() === 'win32' ? 'junction' : 'dir';
    const claudeSkillsDir = join(testDir, '.claude', 'skills');
    const windsurfSkillsDir = join(testDir, '.windsurf', 'skills');
    await mkdir(claudeSkillsDir, { recursive: true });
    await mkdir(windsurfSkillsDir, { recursive: true });
    await symlink(canonicalSkillDir, join(claudeSkillsDir, skillName), linkType);
    await symlink(canonicalSkillDir, join(windsurfSkillsDir, skillName), linkType);

    const realCanonicalSkillMdPath = await realpath(canonicalSkillMdPath);
    const parsedSkillMdRealPaths: string[] = [];

    vi.resetModules();
    vi.doMock('../src/agents.ts', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../src/agents.ts')>();
      return {
        ...actual,
        detectInstalledAgents: vi.fn().mockResolvedValue(['claude-code', 'windsurf']),
      };
    });
    vi.doMock('../src/skills.ts', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../src/skills.ts')>();
      return {
        ...actual,
        parseSkillMd: vi.fn(async (...args: Parameters<typeof actual.parseSkillMd>) => {
          const [skillMdPath, options] = args;
          parsedSkillMdRealPaths.push(await realpath(skillMdPath).catch(() => skillMdPath));
          return actual.parseSkillMd(skillMdPath, options);
        }),
      };
    });

    try {
      const { listInstalledSkills: listInstalledSkillsWithMock } =
        await import('../src/installer.ts');

      const skills = await listInstalledSkillsWithMock({ global: false, cwd: testDir });

      expect(skills).toHaveLength(1);
      expect(skills[0]!.name).toBe(skillName);
      expect(skills[0]!.agents).toEqual(expect.arrayContaining(['claude-code', 'windsurf']));
      expect(
        parsedSkillMdRealPaths.filter((path) => path === realCanonicalSkillMdPath)
      ).toHaveLength(1);
    } finally {
      vi.doUnmock('../src/agents.ts');
      vi.doUnmock('../src/skills.ts');
      vi.resetModules();
    }
  });

  it('does not scan unrelated agent directories when an agent filter is provided', async () => {
    vi.spyOn(agentsModule, 'detectInstalledAgents').mockResolvedValue(['codex']);

    await createSkillDir(testDir, 'codex-only-skill', {
      name: 'codex-only-skill',
      description: 'Codex skill',
    });

    const unrelatedAgentSkillsDir = join(testDir, '.claude', 'skills');
    await mkdir(join(unrelatedAgentSkillsDir, 'unrelated-skill'), { recursive: true });
    await writeFile(
      join(unrelatedAgentSkillsDir, 'unrelated-skill', 'SKILL.md'),
      `---
name: unrelated-skill
description: Unrelated Claude skill
---

# unrelated-skill
`
    );

    try {
      const skills = await listInstalledSkills({
        global: false,
        cwd: testDir,
        agentFilter: ['codex'],
      });

      expect(skills.map((skill) => skill.name)).toEqual(['codex-only-skill']);
    } finally {
      vi.restoreAllMocks();
    }
  });

  // Issue #225 part 2: Skills in agent-specific directories should be found
  it('should find skills in agent-specific directories (issue #225)', async () => {
    vi.spyOn(agentsModule, 'detectInstalledAgents').mockResolvedValue(['cursor']);

    // Cursor now uses .agents/skills (universal directory)
    const cursorSkillDir = join(testDir, '.agents', 'skills', 'cursor-skill');
    await mkdir(cursorSkillDir, { recursive: true });
    await writeFile(
      join(cursorSkillDir, 'SKILL.md'),
      `---
name: cursor-skill
description: A skill in cursor directory
---

# cursor-skill
`
    );

    const skills = await listInstalledSkills({ global: false, cwd: testDir });

    expect(skills).toHaveLength(1);
    expect(skills[0]!.name).toBe('cursor-skill');
    expect(skills[0]!.agents).toContain('cursor');

    vi.restoreAllMocks();
  });
});
