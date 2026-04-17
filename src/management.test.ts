import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { runCli } from './test-utils.js';
import { readLocalManagementState, writeLocalManagementState } from './local-lock.ts';

describe('management commands', { timeout: 30000 }, () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `skills-management-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  function createProjectSkill(name: string) {
    const skillDir = join(testDir, '.agents', 'skills', name);
    writeSkillFile(skillDir, name);
  }

  function createDisabledProjectSkill(name: string) {
    const skillDir = join(testDir, '.agents', 'disabled_skills', name);
    writeSkillFile(skillDir, name);
  }

  function writeSkillFile(skillDir: string, name: string) {
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      `---
name: ${name}
description: Test skill
---

# ${name}
`
    );
  }

  describe('disable', () => {
    it('moves an installed project skill into disabled_skills', () => {
      createProjectSkill('test-skill');

      const result = runCli(['disable', 'test-skill'], testDir);

      expect(result.exitCode).toBe(0);
      expect(existsSync(join(testDir, '.agents', 'skills', 'test-skill'))).toBe(false);
      expect(existsSync(join(testDir, '.agents', 'disabled_skills', 'test-skill'))).toBe(true);
    });

    it('rejects mixed selector types', () => {
      const result = runCli(['disable', 'test-skill', '--group', 'ai'], testDir);

      expect(result.exitCode).toBe(1);
      expect(result.stdout).toContain('exactly one selector');
    });

    it('fails when explicitly targeting the manager skill', async () => {
      createProjectSkill('manager-skill');
      await writeLocalManagementState(
        {
          groups: {},
          managerSkill: 'manager-skill',
        },
        testDir
      );

      const result = runCli(['disable', 'manager-skill'], testDir);

      expect(result.exitCode).toBe(1);
      expect(result.stdout).toContain('protected manager skill');
      expect(existsSync(join(testDir, '.agents', 'skills', 'manager-skill'))).toBe(true);
    });

    it('skips the manager skill during --all bulk disables', async () => {
      createProjectSkill('manager-skill');
      createProjectSkill('worker-skill');
      await writeLocalManagementState(
        {
          groups: {},
          managerSkill: 'manager-skill',
        },
        testDir
      );

      const result = runCli(['disable', '--all'], testDir);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Skipped 1 item');
      expect(existsSync(join(testDir, '.agents', 'skills', 'manager-skill'))).toBe(true);
      expect(existsSync(join(testDir, '.agents', 'disabled_skills', 'worker-skill'))).toBe(true);
    });

    it('fails for missing installed skills', () => {
      const result = runCli(['disable', 'missing-skill'], testDir);

      expect(result.exitCode).toBe(1);
      expect(result.stdout).toContain('missing on disk');
    });

    it('skips the manager skill when disabling via --group', async () => {
      createProjectSkill('manager-skill');
      createProjectSkill('worker-skill');
      await writeLocalManagementState(
        {
          groups: {
            ai: ['manager-skill', 'worker-skill'],
          },
          managerSkill: 'manager-skill',
        },
        testDir
      );

      const result = runCli(['disable', '--group', 'ai'], testDir);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Skipped 1 item');
      expect(existsSync(join(testDir, '.agents', 'skills', 'manager-skill'))).toBe(true);
      expect(existsSync(join(testDir, '.agents', 'disabled_skills', 'worker-skill'))).toBe(true);
    });
  });

  describe('enable', () => {
    it('moves a disabled project skill back into skills', () => {
      createDisabledProjectSkill('test-skill');

      const result = runCli(['enable', 'test-skill'], testDir);

      expect(result.exitCode).toBe(0);
      expect(existsSync(join(testDir, '.agents', 'disabled_skills', 'test-skill'))).toBe(false);
      expect(existsSync(join(testDir, '.agents', 'skills', 'test-skill'))).toBe(true);
    });

    it('enables all disabled skills with --all', async () => {
      createDisabledProjectSkill('alpha-skill');
      createDisabledProjectSkill('beta-skill');
      createProjectSkill('already-enabled');

      const result = runCli(['enable', '--all'], testDir);

      expect(result.exitCode).toBe(0);
      expect(existsSync(join(testDir, '.agents', 'skills', 'alpha-skill'))).toBe(true);
      expect(existsSync(join(testDir, '.agents', 'skills', 'beta-skill'))).toBe(true);
      expect(existsSync(join(testDir, '.agents', 'skills', 'already-enabled'))).toBe(true);
    });

    it('expands group selectors through management metadata', async () => {
      createDisabledProjectSkill('alpha-skill');
      createDisabledProjectSkill('beta-skill');
      await writeLocalManagementState(
        {
          groups: {
            ai: ['alpha-skill', 'beta-skill'],
          },
        },
        testDir
      );

      const result = runCli(['enable', '--group', 'ai'], testDir);

      expect(result.exitCode).toBe(0);
      expect(existsSync(join(testDir, '.agents', 'skills', 'alpha-skill'))).toBe(true);
      expect(existsSync(join(testDir, '.agents', 'skills', 'beta-skill'))).toBe(true);
    });
  });

  describe('group', () => {
    it('creates and deletes groups in local management state', async () => {
      const createResult = runCli(['group', 'create', 'Architecture'], testDir);
      expect(createResult.exitCode).toBe(0);
      await expect(readLocalManagementState(testDir)).resolves.toEqual({
        groups: {
          architecture: [],
        },
      });

      const deleteResult = runCli(['group', 'delete', 'architecture'], testDir);
      expect(deleteResult.exitCode).toBe(0);
      await expect(readLocalManagementState(testDir)).resolves.toEqual({
        groups: {},
      });
    });

    it('adds installed skills to a group and can remove them again', async () => {
      createDisabledProjectSkill('test-skill');
      await writeLocalManagementState(
        {
          groups: {
            ai: [],
          },
        },
        testDir
      );

      const addResult = runCli(['group', 'add', 'ai', '--skill', 'test-skill'], testDir);
      expect(addResult.exitCode).toBe(0);
      await expect(readLocalManagementState(testDir)).resolves.toEqual({
        groups: {
          ai: ['test-skill'],
        },
      });

      const removeResult = runCli(['group', 'remove', 'ai', '--skill', 'test-skill'], testDir);
      expect(removeResult.exitCode).toBe(0);
      await expect(readLocalManagementState(testDir)).resolves.toEqual({
        groups: {
          ai: [],
        },
      });
    });

    it('rejects creating a group that already exists', async () => {
      await writeLocalManagementState(
        {
          groups: {
            ai: ['test-skill'],
          },
        },
        testDir
      );

      const result = runCli(['group', 'create', 'ai'], testDir);

      expect(result.exitCode).toBe(1);
      expect(result.stdout).toContain('already exists');
    });

    it('rejects adding a non-installed skill to a group', async () => {
      await writeLocalManagementState(
        {
          groups: {
            ai: [],
          },
        },
        testDir
      );

      const result = runCli(['group', 'add', 'ai', '--skill', 'ghost-skill'], testDir);

      expect(result.exitCode).toBe(1);
      expect(result.stdout).toContain('not installed');
    });

    it('rejects adding the manager skill to a group', async () => {
      createProjectSkill('manager-skill');
      await writeLocalManagementState(
        {
          groups: {
            ai: [],
          },
          managerSkill: 'manager-skill',
        },
        testDir
      );

      const result = runCli(['group', 'add', 'ai', '--skill', 'manager-skill'], testDir);

      expect(result.exitCode).toBe(1);
      expect(result.stdout).toContain('cannot be added to a group');
      await expect(readLocalManagementState(testDir)).resolves.toEqual({
        groups: {
          ai: [],
        },
        managerSkill: 'manager-skill',
      });
    });
  });

  describe('manager', () => {
    it('sets the manager skill, enables it, and removes it from groups', async () => {
      createDisabledProjectSkill('manager-skill');
      createProjectSkill('worker-skill');
      await writeLocalManagementState(
        {
          groups: {
            ai: ['manager-skill', 'worker-skill'],
          },
        },
        testDir
      );

      const result = runCli(['manager', 'set', 'manager-skill'], testDir);

      expect(result.exitCode).toBe(0);
      expect(existsSync(join(testDir, '.agents', 'skills', 'manager-skill'))).toBe(true);
      await expect(readLocalManagementState(testDir)).resolves.toEqual({
        groups: {
          ai: ['worker-skill'],
        },
        managerSkill: 'manager-skill',
      });
    });

    it('shows not-set message when no manager skill is configured', () => {
      const result = runCli(['manager', 'show'], testDir);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('not set');
    });

    it('shows a warning when the manager skill is missing on disk', async () => {
      await writeLocalManagementState(
        {
          groups: {},
          managerSkill: 'deleted-skill',
        },
        testDir
      );

      const result = runCli(['manager', 'show'], testDir);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('deleted-skill');
      expect(result.stdout).toContain('missing');
    });

    it('shows and clears the configured manager skill', async () => {
      createProjectSkill('manager-skill');
      await writeLocalManagementState(
        {
          groups: {
            ai: [],
          },
          managerSkill: 'manager-skill',
        },
        testDir
      );

      const showResult = runCli(['manager', 'show'], testDir);
      expect(showResult.exitCode).toBe(0);
      expect(showResult.stdout).toContain('manager-skill');

      const clearResult = runCli(['manager', 'clear'], testDir);
      expect(clearResult.exitCode).toBe(0);
      await expect(readLocalManagementState(testDir)).resolves.toEqual({
        groups: {
          ai: [],
        },
      });
    });
  });

  describe('global scope', () => {
    let homeDir: string;
    let stateDir: string;
    let globalSkillsDir: string;
    let globalEnv: Record<string, string>;

    beforeEach(() => {
      homeDir = join(testDir, 'home');
      stateDir = join(testDir, 'state');
      globalSkillsDir = join(homeDir, '.agents', 'skills');
      globalEnv = { HOME: homeDir, XDG_STATE_HOME: stateDir };
      mkdirSync(homeDir, { recursive: true });
      mkdirSync(stateDir, { recursive: true });
    });

    function createGlobalSkill(name: string) {
      const skillDir = join(globalSkillsDir, name);
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(
        join(skillDir, 'SKILL.md'),
        `---
name: ${name}
description: Test skill
---

# ${name}
`
      );
    }

    function createDisabledGlobalSkill(name: string) {
      const skillDir = join(homeDir, '.agents', 'disabled_skills', name);
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(
        join(skillDir, 'SKILL.md'),
        `---
name: ${name}
description: Test skill
---

# ${name}
`
      );
    }

    function readGlobalLock(): Record<string, unknown> {
      return JSON.parse(readFileSync(join(stateDir, 'skills', '.skill-lock.json'), 'utf-8'));
    }

    it('stores global group state in the global lockfile', () => {
      const result = runCli(['group', 'create', 'Global-AI', '-g'], testDir, globalEnv);

      expect(result.exitCode).toBe(0);

      const globalLock = readGlobalLock();
      expect(globalLock.management).toEqual({
        groups: {
          'global-ai': [],
        },
      });
    });

    it('deletes a global group', () => {
      runCli(['group', 'create', 'infra', '-g'], testDir, globalEnv);
      const deleteResult = runCli(['group', 'delete', 'infra', '-g'], testDir, globalEnv);

      expect(deleteResult.exitCode).toBe(0);
      const globalLock = readGlobalLock();
      expect((globalLock.management as Record<string, unknown>)['groups']).toEqual({});
    });

    it('adds and removes global skills from a global group', () => {
      createGlobalSkill('api-design');
      runCli(['group', 'create', 'arch', '-g'], testDir, globalEnv);

      const addResult = runCli(
        ['group', 'add', 'arch', '--skill', 'api-design', '-g'],
        testDir,
        globalEnv
      );
      expect(addResult.exitCode).toBe(0);

      let globalLock = readGlobalLock();
      expect(
        ((globalLock.management as Record<string, unknown>)['groups'] as Record<string, string[]>)[
          'arch'
        ]
      ).toEqual(['api-design']);

      const removeResult = runCli(
        ['group', 'remove', 'arch', '--skill', 'api-design', '-g'],
        testDir,
        globalEnv
      );
      expect(removeResult.exitCode).toBe(0);

      globalLock = readGlobalLock();
      expect(
        ((globalLock.management as Record<string, unknown>)['groups'] as Record<string, string[]>)[
          'arch'
        ]
      ).toEqual([]);
    });

    it('sets, shows, and clears the global manager skill', () => {
      createGlobalSkill('find-skills');

      const setResult = runCli(['manager', 'set', 'find-skills', '-g'], testDir, globalEnv);
      expect(setResult.exitCode).toBe(0);

      let globalLock = readGlobalLock();
      expect((globalLock.management as Record<string, unknown>)['managerSkill']).toBe(
        'find-skills'
      );

      const showResult = runCli(['manager', 'show', '-g'], testDir, globalEnv);
      expect(showResult.exitCode).toBe(0);
      expect(showResult.stdout).toContain('find-skills');

      const clearResult = runCli(['manager', 'clear', '-g'], testDir, globalEnv);
      expect(clearResult.exitCode).toBe(0);

      globalLock = readGlobalLock();
      expect((globalLock.management as Record<string, unknown>)['managerSkill']).toBeUndefined();
    });

    it('enables and disables global skills', () => {
      createGlobalSkill('test-skill');

      const disableResult = runCli(['disable', 'test-skill', '-g'], testDir, globalEnv);
      expect(disableResult.exitCode).toBe(0);
      expect(existsSync(join(globalSkillsDir, 'test-skill'))).toBe(false);
      expect(existsSync(join(homeDir, '.agents', 'disabled_skills', 'test-skill'))).toBe(true);

      const enableResult = runCli(['enable', 'test-skill', '-g'], testDir, globalEnv);
      expect(enableResult.exitCode).toBe(0);
      expect(existsSync(join(globalSkillsDir, 'test-skill'))).toBe(true);
      expect(existsSync(join(homeDir, '.agents', 'disabled_skills', 'test-skill'))).toBe(false);
    });

    it('sets a disabled global skill as manager and enables it', () => {
      createDisabledGlobalSkill('find-skills');

      const result = runCli(['manager', 'set', 'find-skills', '-g'], testDir, globalEnv);

      expect(result.exitCode).toBe(0);
      expect(existsSync(join(globalSkillsDir, 'find-skills'))).toBe(true);
      expect(existsSync(join(homeDir, '.agents', 'disabled_skills', 'find-skills'))).toBe(false);

      const globalLock = readGlobalLock();
      expect((globalLock.management as Record<string, unknown>)['managerSkill']).toBe(
        'find-skills'
      );
    });
  });
});
