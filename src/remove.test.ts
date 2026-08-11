import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, rmSync, mkdirSync, writeFileSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { runCli, runCliWithInput } from './test-utils.js';
import { buildScopedChoices, resolveRemoveScopes } from './remove.ts';

describe('remove command', { timeout: 30000 }, () => {
  let testDir: string;
  let skillsDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `skills-remove-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });

    // Create .agents/skills directory (canonical location)
    skillsDir = join(testDir, '.agents', 'skills');
    mkdirSync(skillsDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  function createTestSkill(
    name: string,
    description = `A test skill called ${name}`,
    targetSkillsDir = skillsDir
  ): string {
    const skillDir = join(targetSkillsDir, name);
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      `---
name: ${name}
description: ${description}
---

# ${name}

This is a test skill.
`
    );
    return skillDir;
  }

  function createAgentSkillsDir(agentName: string) {
    const agentSkillsDir = join(testDir, agentName, 'skills');
    mkdirSync(agentSkillsDir, { recursive: true });
    return agentSkillsDir;
  }

  function createSymlink(skillName: string, targetDir: string) {
    const skillPath = join(skillsDir, skillName);
    const linkPath = join(targetDir, skillName);
    try {
      // Create relative symlink
      const relativePath = join('..', '..', '.agents', 'skills', skillName);
      const { symlinkSync } = require('fs');
      symlinkSync(relativePath, linkPath);
    } catch {
      // Skip if symlinks aren't supported
    }
  }

  describe('with no skills installed', () => {
    it('should show message when no skills found', () => {
      const result = runCli(['remove', '-y'], testDir);
      expect(result.stdout).toContain('No skills found');
      expect(result.stdout).toContain('to remove');
      expect(result.exitCode).toBe(0);
    });

    it('should show error for non-existent skill name', () => {
      const result = runCli(['remove', 'non-existent-skill', '-y'], testDir);
      expect(result.stdout).toContain('No skills found');
      expect(result.exitCode).toBe(0);
    });

    it('should clean stale lock entry even when no skills are installed on disk', () => {
      const lockPath = join(testDir, 'skills-lock.json');
      const lockContent = {
        version: 1,
        skills: {
          'stale-skill': {
            source: 'some-source',
            sourceType: 'github',
            computedHash: 'somehash',
          },
        },
      };
      writeFileSync(lockPath, JSON.stringify(lockContent, null, 2));

      // No skills exist on disk, but stale-skill lingers in the lock file
      const result = runCli(['remove', 'stale-skill', '-y'], testDir);

      expect(result.stdout).toContain('Successfully removed');
      expect(result.exitCode).toBe(0);

      const updatedLock = JSON.parse(readFileSync(lockPath, 'utf-8'));
      expect(updatedLock.skills['stale-skill']).toBeUndefined();
    });

    it('should clean all stale lock entries with --all', () => {
      const lockPath = join(testDir, 'skills-lock.json');
      writeFileSync(
        lockPath,
        JSON.stringify(
          {
            version: 1,
            skills: {
              'stale-skill': {
                source: 'some-source',
                sourceType: 'github',
                computedHash: 'somehash',
              },
            },
          },
          null,
          2
        )
      );

      const result = runCli(['remove', '--all', '-y'], testDir);

      expect(result.stdout).toContain('Successfully removed');
      expect(result.exitCode).toBe(0);

      const updatedLock = JSON.parse(readFileSync(lockPath, 'utf-8'));
      expect(updatedLock.skills['stale-skill']).toBeUndefined();
    });
  });

  describe('with skills installed', () => {
    beforeEach(() => {
      createTestSkill('skill-one', 'First test skill');
      createTestSkill('skill-two', 'Second test skill');
      createTestSkill('skill-three', 'Third test skill');

      // Create symlinks in agent directories
      const claudeSkillsDir = createAgentSkillsDir('.claude');
      createSymlink('skill-one', claudeSkillsDir);
      createSymlink('skill-two', claudeSkillsDir);

      const clineSkillsDir = createAgentSkillsDir('.cline');
      createSymlink('skill-one', clineSkillsDir);
      createSymlink('skill-three', clineSkillsDir);
    });

    it('should remove specific skill by name with -y flag', () => {
      const result = runCli(['remove', 'skill-one', '-y'], testDir);

      expect(result.stdout).toContain('Successfully removed');
      expect(result.stdout).toContain('1 skill');

      // Verify skill was removed from canonical location
      expect(existsSync(join(skillsDir, 'skill-one'))).toBe(false);

      // Verify other skills still exist
      expect(existsSync(join(skillsDir, 'skill-two'))).toBe(true);
      expect(existsSync(join(skillsDir, 'skill-three'))).toBe(true);
    });

    it('should remove multiple skills by name', () => {
      const result = runCli(['remove', 'skill-one', 'skill-two', '-y'], testDir);

      expect(result.stdout).toContain('Successfully removed');
      expect(result.stdout).toContain('2 skill');

      expect(existsSync(join(skillsDir, 'skill-one'))).toBe(false);
      expect(existsSync(join(skillsDir, 'skill-two'))).toBe(false);
      expect(existsSync(join(skillsDir, 'skill-three'))).toBe(true);
    });

    it('should remove all skills with --all flag', () => {
      const result = runCli(['remove', '--all', '-y'], testDir);

      expect(result.stdout).toContain('Successfully removed');
      expect(result.stdout).toContain('3 skill');

      // All skills removed
      expect(existsSync(join(skillsDir, 'skill-one'))).toBe(false);
      expect(existsSync(join(skillsDir, 'skill-two'))).toBe(false);
      expect(existsSync(join(skillsDir, 'skill-three'))).toBe(false);
    });

    it('should show error for non-existent skill name when skills exist', () => {
      const result = runCli(['remove', 'non-existent', '-y'], testDir);

      expect(result.stdout).toContain('No matching skills');
      expect(result.exitCode).toBe(0);
    });

    it('should remove skill that is missing from disk but exists in local lock file', () => {
      const lockPath = join(testDir, 'skills-lock.json');
      const lockContent = {
        version: 1,
        skills: {
          'stale-skill': {
            source: 'some-source',
            sourceType: 'github',
            computedHash: 'somehash',
          },
        },
      };
      writeFileSync(lockPath, JSON.stringify(lockContent, null, 2));

      // stale-skill is missing from disk, but exists in lock file
      const result = runCli(['remove', 'stale-skill', '-y'], testDir);

      expect(result.stdout).toContain('Successfully removed');
      expect(result.stdout).toContain('1 skill');
      expect(result.exitCode).toBe(0);

      // Verify lock file has been updated to remove the skill
      const updatedLock = JSON.parse(readFileSync(lockPath, 'utf-8'));
      expect(updatedLock.skills['stale-skill']).toBeUndefined();
    });

    it('should remove a sanitized folder using its exact local lock key', () => {
      createTestSkill('ce-review');
      const lockPath = join(testDir, 'skills-lock.json');
      writeFileSync(
        lockPath,
        JSON.stringify(
          {
            version: 1,
            skills: {
              'ce:review': {
                source: 'everyinc/compound-engineering-plugin',
                sourceType: 'github',
                computedHash: 'somehash',
              },
            },
          },
          null,
          2
        )
      );

      const result = runCli(['remove', 'ce:review', '-y'], testDir);

      expect(result.stdout).toContain('Successfully removed');
      expect(existsSync(join(skillsDir, 'ce-review'))).toBe(false);

      const updatedLock = JSON.parse(readFileSync(lockPath, 'utf-8'));
      expect(updatedLock.skills['ce:review']).toBeUndefined();
    });

    it('should be case-insensitive when matching skill names', () => {
      const result = runCli(['remove', 'SKILL-ONE', '-y'], testDir);

      expect(result.stdout).toContain('Successfully removed');
      expect(existsSync(join(skillsDir, 'skill-one'))).toBe(false);
    });

    it('should remove only the specified skill and leave others', () => {
      runCli(['remove', 'skill-two', '-y'], testDir);

      // skill-two removed
      expect(existsSync(join(skillsDir, 'skill-two'))).toBe(false);

      // Others still exist
      expect(existsSync(join(skillsDir, 'skill-one'))).toBe(true);
      expect(existsSync(join(skillsDir, 'skill-three'))).toBe(true);
    });

    it('should list skills to remove before confirmation', () => {
      // Answer 'n' to cancel the confirmation prompt
      const result = runCliWithInput(['remove', 'skill-one', 'skill-two'], 'n', testDir);

      // Should show the skills that will be removed
      expect(result.stdout).toContain('Skills to remove');
      expect(result.stdout).toContain('skill-one');
      expect(result.stdout).toContain('skill-two');
      expect(result.stdout).toContain('uninstall');

      // Skills should NOT be removed since we cancelled
      expect(existsSync(join(skillsDir, 'skill-one'))).toBe(true);
      expect(existsSync(join(skillsDir, 'skill-two'))).toBe(true);
    });
  });

  describe('agent filtering', () => {
    beforeEach(() => {
      createTestSkill('test-skill');
      createAgentSkillsDir('.claude');
      createAgentSkillsDir('.cline');
    });

    it('should show error for invalid agent name', () => {
      const result = runCli(['remove', 'test-skill', '--agent', 'invalid-agent', '-y'], testDir);

      expect(result.stdout).toContain('Invalid agents');
      expect(result.stdout).toContain('invalid-agent');
      expect(result.stdout).toContain('Valid agents');
      expect(result.exitCode).toBe(1);
    });

    it('should accept valid agent names', () => {
      // This should not error on agent validation
      const result = runCli(['remove', 'test-skill', '--agent', 'claude-code', '-y'], testDir);
      expect(result.stdout).not.toContain('Invalid agents');
    });

    it('should accept multiple agent names', () => {
      const result = runCli(
        ['remove', 'test-skill', '--agent', 'claude-code', 'cursor', '-y'],
        testDir
      );
      expect(result.stdout).not.toContain('Invalid agents');
    });
  });

  describe('global flag', () => {
    it('should remove a skill from the isolated global home', () => {
      const testHome = join(testDir, 'home');
      const globalSkillDir = createTestSkill(
        'global-skill',
        'A global skill',
        join(testHome, '.agents', 'skills')
      );

      const result = runCli(['remove', 'global-skill', '--global', '-y'], testDir, {
        HOME: testHome,
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Successfully removed');
      expect(existsSync(globalSkillDir)).toBe(false);
    });

    it('should remove a sanitized folder and its exact global lock key', () => {
      const testHome = join(testDir, 'home');
      const globalSkillDir = createTestSkill(
        'ce-review',
        'A plugin skill',
        join(testHome, '.agents', 'skills')
      );
      const lockPath = join(testHome, '.local', 'state', 'skills', '.skill-lock.json');
      mkdirSync(join(testHome, '.local', 'state', 'skills'), { recursive: true });
      writeFileSync(
        lockPath,
        JSON.stringify(
          {
            version: 3,
            skills: {
              'ce:review': {
                source: 'everyinc/compound-engineering-plugin',
                sourceType: 'github',
                sourceUrl: 'https://github.com/everyinc/compound-engineering-plugin',
                skillFolderHash: 'somehash',
                installedAt: '2026-07-01T00:00:00.000Z',
                updatedAt: '2026-07-01T00:00:00.000Z',
              },
            },
          },
          null,
          2
        )
      );

      const result = runCli(['remove', 'ce-review', '--global', '-y'], testDir, {
        HOME: testHome,
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Successfully removed');
      expect(existsSync(globalSkillDir)).toBe(false);

      const updatedLock = JSON.parse(readFileSync(lockPath, 'utf-8'));
      expect(updatedLock.skills['ce:review']).toBeUndefined();
    });
  });

  describe('interactive scope grouping', () => {
    let testHome: string;

    beforeEach(() => {
      testHome = join(testDir, 'home');
      createTestSkill('project-skill', 'A project skill');
      createTestSkill('global-skill', 'A global skill', join(testHome, '.agents', 'skills'));
    });

    // Piped stdin cannot drive a clack multiselect to submit, so these assert
    // what the picker offers. Sending a carriage return ends the prompt with
    // nothing selected once the first frame has rendered.
    const showPicker = ' \r';

    it('lists project and global skills as separate groups', () => {
      const result = runCliWithInput(['remove'], showPicker, testDir, { HOME: testHome });

      expect(result.stdout).toContain('Select skills to remove');
      expect(result.stdout).toContain('Project');
      expect(result.stdout).toContain('Global');
      expect(result.stdout).toContain('project-skill');
      expect(result.stdout).toContain('global-skill');
    });

    it('restricts the picker to project skills with -p', () => {
      const result = runCliWithInput(['remove', '-p'], showPicker, testDir, { HOME: testHome });

      expect(result.stdout).toContain('project-skill');
      expect(result.stdout).not.toContain('global-skill');
    });

    it('restricts the picker to global skills with -g', () => {
      const result = runCliWithInput(['remove', '-g'], showPicker, testDir, { HOME: testHome });

      expect(result.stdout).toContain('global-skill');
      expect(result.stdout).not.toContain('project-skill');
    });

    it('removes a name from both scopes when -g and -p are combined', () => {
      createTestSkill('shared-skill', 'In both scopes');
      createTestSkill('shared-skill', 'In both scopes', join(testHome, '.agents', 'skills'));

      const result = runCli(['remove', 'shared-skill', '-g', '-p', '-y'], testDir, {
        HOME: testHome,
      });

      expect(result.stdout).toContain('Successfully removed');
      expect(result.stdout).toContain('2 skill');
      expect(existsSync(join(skillsDir, 'shared-skill'))).toBe(false);
      expect(existsSync(join(testHome, '.agents', 'skills', 'shared-skill'))).toBe(false);
      expect(existsSync(join(skillsDir, 'project-skill'))).toBe(true);
      expect(existsSync(join(testHome, '.agents', 'skills', 'global-skill'))).toBe(true);
    });

    it('leaves global skills alone when removing by name', () => {
      const result = runCli(['remove', 'global-skill', '-y'], testDir, { HOME: testHome });

      expect(result.stdout).toContain('No matching skills');
      expect(existsSync(join(testHome, '.agents', 'skills', 'global-skill'))).toBe(true);
    });
  });

  describe('command aliases', () => {
    beforeEach(() => {
      createTestSkill('alias-test-skill');
    });

    it('should support "rm" alias', () => {
      const result = runCli(['rm', 'alias-test-skill', '-y'], testDir);
      expect(result.stdout).toContain('Successfully removed');
      expect(result.exitCode).toBe(0);
    });

    it('should support "r" alias', () => {
      const result = runCli(['r', 'alias-test-skill', '-y'], testDir);
      expect(result.stdout).toContain('Successfully removed');
      expect(result.exitCode).toBe(0);
    });
  });

  describe('edge cases', () => {
    it('should handle skill names with special characters', () => {
      createTestSkill('skill-with-dashes');
      createTestSkill('skill_with_underscores');

      const result = runCli(['remove', 'skill-with-dashes', '-y'], testDir);
      expect(result.stdout).toContain('Successfully removed');
      expect(existsSync(join(skillsDir, 'skill-with-dashes'))).toBe(false);
      expect(existsSync(join(skillsDir, 'skill_with_underscores'))).toBe(true);
    });

    it('should handle removing last remaining skill', () => {
      createTestSkill('last-skill');

      const result = runCli(['remove', 'last-skill', '-y'], testDir);
      expect(result.stdout).toContain('Successfully removed');
      expect(result.stdout).toContain('1 skill');

      // Directory should be empty or removed
      const remaining = readdirSync(skillsDir);
      expect(remaining.length).toBe(0);
    });

    it('should handle directory without SKILL.md file', () => {
      // Create a directory without SKILL.md
      const invalidSkillDir = join(skillsDir, 'invalid-skill');
      mkdirSync(invalidSkillDir, { recursive: true });
      writeFileSync(join(invalidSkillDir, 'README.md'), 'Just a readme');

      createTestSkill('valid-skill');

      const result = runCli(['remove', 'valid-skill', '-y'], testDir);
      expect(result.stdout).toContain('Successfully removed');

      // Invalid directory should still be removed
      expect(existsSync(join(skillsDir, 'invalid-skill'))).toBe(true);
    });
  });

  describe('help and info', () => {
    it('should show help with --help', () => {
      const result = runCli(['remove', '--help'], testDir);
      expect(result.stdout).toContain('Usage');
      expect(result.stdout).toContain('remove');
      expect(result.stdout).toContain('--global');
      expect(result.stdout).toContain('--agent');
      expect(result.stdout).toContain('--yes');
      expect(result.exitCode).toBe(0);
    });

    it('should show help with -h', () => {
      const result = runCli(['remove', '-h'], testDir);
      expect(result.stdout).toContain('Usage');
      expect(result.exitCode).toBe(0);
    });
  });

  describe('resolveRemoveScopes', () => {
    it('browses both scopes for an interactive selection', () => {
      expect(resolveRemoveScopes({}, false)).toEqual([{ global: false }, { global: true }]);
    });

    it('stays project-scoped for named skills and --all', () => {
      expect(resolveRemoveScopes({}, true)).toEqual([{ global: false }]);
      expect(resolveRemoveScopes({ all: true }, false)).toEqual([{ global: false }]);
    });

    it('honours explicit scope flags', () => {
      expect(resolveRemoveScopes({ global: true }, false)).toEqual([{ global: true }]);
      expect(resolveRemoveScopes({ project: true }, false)).toEqual([{ global: false }]);
      expect(resolveRemoveScopes({ global: true, project: true }, true)).toEqual([
        { global: false },
        { global: true },
      ]);
    });
  });

  describe('buildScopedChoices', () => {
    it('keeps same-named skills in both scopes as distinct entries', () => {
      const groups = buildScopedChoices([
        { global: false, names: ['shared'], dir: './.agents/skills' },
        { global: true, names: ['shared'], dir: '~/.agents/skills' },
      ]);

      const [projectGroup, globalGroup] = Object.keys(groups);
      expect(projectGroup).toContain('Project');
      expect(globalGroup).toContain('Global');
      expect(groups[projectGroup!]![0]!.value).toEqual({ name: 'shared', global: false });
      expect(groups[globalGroup!]![0]!.value).toEqual({ name: 'shared', global: true });
    });

    it('omits empty scopes', () => {
      const groups = buildScopedChoices([
        { global: false, names: ['only-project'], dir: './.agents/skills' },
        { global: true, names: [], dir: '~/.agents/skills' },
      ]);

      expect(Object.keys(groups)).toHaveLength(1);
      expect(Object.keys(groups)[0]).toContain('Project');
    });
  });

  describe('option parsing', () => {
    beforeEach(() => {
      createTestSkill('parse-test-skill');
    });

    it('should parse -g as global', () => {
      const result = runCli(['remove', 'parse-test-skill', '-g', '-y'], testDir);
      expect(result.stdout).not.toContain('error');
      expect(result.stdout).not.toContain('unrecognized');
    });

    it('should parse --yes flag', () => {
      const result = runCli(['remove', 'parse-test-skill', '--yes'], testDir);
      expect(result.exitCode).toBe(0);
    });

    it('should parse -a as agent', () => {
      const result = runCli(['remove', 'parse-test-skill', '-a', 'claude-code', '-y'], testDir);
      expect(result.stdout).not.toContain('Invalid agents');
    });

    it('should handle multiple values for --agent', () => {
      const result = runCli(
        ['remove', 'parse-test-skill', '--agent', 'claude-code', 'cursor', '-y'],
        testDir
      );
      expect(result.stdout).not.toContain('Invalid agents');
    });
  });
});

describe('remove -a with a subset of agents', { timeout: 30000 }, () => {
  let testDir: string;
  let fakeHome: string;

  // Both agents are detected from directories under HOME, so the test drives
  // HOME rather than relying on whatever is installed on the host.
  beforeEach(() => {
    testDir = join(tmpdir(), `skills-remove-subset-${Date.now()}`);
    fakeHome = join(testDir, 'home');
    mkdirSync(join(fakeHome, '.claude'), { recursive: true });
    mkdirSync(join(fakeHome, '.codex'), { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('keeps the lock entry when another agent still uses the skill', () => {
    const project = join(testDir, 'project');
    const skillName = 'shared-skill';

    // Canonical copy — also codex's project skills dir.
    const canonical = join(project, '.agents', 'skills', skillName);
    mkdirSync(canonical, { recursive: true });
    writeFileSync(
      join(canonical, 'SKILL.md'),
      `---\nname: ${skillName}\ndescription: shared between two agents\n---\n`
    );

    // Claude Code's own copy, the one being removed.
    const claudeCopy = join(project, '.claude', 'skills', skillName);
    mkdirSync(claudeCopy, { recursive: true });
    writeFileSync(
      join(claudeCopy, 'SKILL.md'),
      `---\nname: ${skillName}\ndescription: shared between two agents\n---\n`
    );

    const lockPath = join(project, 'skills-lock.json');
    writeFileSync(
      lockPath,
      JSON.stringify(
        {
          version: 1,
          skills: {
            [skillName]: {
              source: 'owner/repo',
              sourceType: 'github',
              computedHash: 'somehash',
            },
          },
        },
        null,
        2
      )
    );

    const result = runCli(['remove', skillName, '-a', 'claude-code', '-y'], project, {
      HOME: fakeHome,
    });

    expect(result.exitCode).toBe(0);
    // Claude Code's copy goes, codex keeps working.
    expect(existsSync(claudeCopy)).toBe(false);
    expect(existsSync(canonical)).toBe(true);

    // The skill is still installed, so it must still be updatable.
    const updatedLock = JSON.parse(readFileSync(lockPath, 'utf-8'));
    expect(updatedLock.skills[skillName]).toBeDefined();
  });
});
