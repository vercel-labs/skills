import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { lstat, mkdir, readlink, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  getInstalledSkillSnapshot,
  getSkillEntryStatus,
  setInstalledSkillState,
} from '../src/management-filesystem.ts';

describe('management filesystem helpers', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(
      tmpdir(),
      `skills-management-fs-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  async function writeSkill(rootDir: string, skillName: string): Promise<string> {
    const skillDir = join(rootDir, skillName);
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, 'SKILL.md'),
      `---
name: ${skillName}
description: Test skill
---

# ${skillName}
`
    );
    return skillDir;
  }

  it('reports enabled when the active skill directory exists and disabled does not', async () => {
    const enabledRoot = join(testDir, '.agents', 'skills');
    const disabledRoot = join(testDir, '.agents', 'disabled_skills');

    await writeSkill(enabledRoot, 'test-skill');

    await expect(
      getSkillEntryStatus({
        enabledPath: join(enabledRoot, 'test-skill'),
        disabledPath: join(disabledRoot, 'test-skill'),
      })
    ).resolves.toBe('enabled');
  });

  it('reports disabled when the disabled skill directory exists and active does not', async () => {
    const enabledRoot = join(testDir, '.agents', 'skills');
    const disabledRoot = join(testDir, '.agents', 'disabled_skills');

    await writeSkill(disabledRoot, 'test-skill');

    await expect(
      getSkillEntryStatus({
        enabledPath: join(enabledRoot, 'test-skill'),
        disabledPath: join(disabledRoot, 'test-skill'),
      })
    ).resolves.toBe('disabled');
  });

  it('reports inconsistent when both active and disabled directories exist', async () => {
    const enabledRoot = join(testDir, '.agents', 'skills');
    const disabledRoot = join(testDir, '.agents', 'disabled_skills');

    await writeSkill(enabledRoot, 'test-skill');
    await writeSkill(disabledRoot, 'test-skill');

    await expect(
      getSkillEntryStatus({
        enabledPath: join(enabledRoot, 'test-skill'),
        disabledPath: join(disabledRoot, 'test-skill'),
      })
    ).resolves.toBe('inconsistent');
  });

  it('reports missing when neither active nor disabled directory exists', async () => {
    const enabledRoot = join(testDir, '.agents', 'skills');
    const disabledRoot = join(testDir, '.agents', 'disabled_skills');

    await expect(
      getSkillEntryStatus({
        enabledPath: join(enabledRoot, 'test-skill'),
        disabledPath: join(disabledRoot, 'test-skill'),
      })
    ).resolves.toBe('missing');
  });

  it('enumerates canonical targets separately from agent symlink alias entries', async () => {
    const canonicalRoot = join(testDir, '.agents', 'skills');
    const claudeRoot = join(testDir, '.claude', 'skills');
    const canonicalPath = await writeSkill(canonicalRoot, 'test-skill');
    const aliasPath = join(claudeRoot, 'test-skill');

    await mkdir(claudeRoot, { recursive: true });
    await symlink(canonicalPath, aliasPath, 'junction');

    const snapshot = await getInstalledSkillSnapshot('test-skill', { cwd: testDir });

    expect(snapshot.status).toBe('enabled');
    expect(snapshot.canonical).toMatchObject({
      kind: 'canonical',
      status: 'enabled',
      enabledPath: canonicalPath,
    });
    expect(snapshot.agentEntries).toHaveLength(1);
    expect(snapshot.agentEntries[0]).toMatchObject({
      kind: 'alias',
      agentType: 'claude-code',
      status: 'enabled',
      enabledPath: aliasPath,
      symlinkTargetPath: canonicalPath,
    });
  });

  it('enumerates agent copy installs when no canonical target exists', async () => {
    const claudeRoot = join(testDir, '.claude', 'skills');
    const copyPath = await writeSkill(claudeRoot, 'test-skill');

    const snapshot = await getInstalledSkillSnapshot('test-skill', { cwd: testDir });

    expect(snapshot.status).toBe('enabled');
    expect(snapshot.canonical).toBeUndefined();
    expect(snapshot.agentEntries).toEqual([
      expect.objectContaining({
        kind: 'copy',
        agentType: 'claude-code',
        status: 'enabled',
        enabledPath: copyPath,
      }),
    ]);
  });

  it('moves canonical targets and recreates alias symlinks under disabled_skills', async () => {
    const canonicalRoot = join(testDir, '.agents', 'skills');
    const disabledCanonicalRoot = join(testDir, '.agents', 'disabled_skills');
    const claudeRoot = join(testDir, '.claude', 'skills');
    const disabledClaudeRoot = join(testDir, '.claude', 'disabled_skills');
    const canonicalPath = await writeSkill(canonicalRoot, 'test-skill');
    const aliasPath = join(claudeRoot, 'test-skill');

    await mkdir(claudeRoot, { recursive: true });
    await symlink(canonicalPath, aliasPath, 'junction');

    const moved = await setInstalledSkillState('test-skill', 'disabled', { cwd: testDir });

    const movedCanonicalPath = join(disabledCanonicalRoot, 'test-skill');
    const movedAliasPath = join(disabledClaudeRoot, 'test-skill');

    expect(moved.status).toBe('disabled');
    await expect(lstat(canonicalPath)).rejects.toThrow();
    await expect(lstat(aliasPath)).rejects.toThrow();
    expect((await lstat(movedCanonicalPath)).isDirectory()).toBe(true);
    expect((await lstat(movedAliasPath)).isSymbolicLink()).toBe(true);
    expect(await readlink(movedAliasPath)).toBe('../../.agents/disabled_skills/test-skill');

    const snapshot = await getInstalledSkillSnapshot('test-skill', { cwd: testDir });
    expect(snapshot.status).toBe('disabled');
    expect(snapshot.agentEntries[0]).toMatchObject({
      kind: 'alias',
      status: 'disabled',
      disabledPath: movedAliasPath,
      symlinkTargetPath: movedCanonicalPath,
    });
  });

  it('moves copied installs into the disabled_skills sibling directory', async () => {
    const activeCopyPath = await writeSkill(join(testDir, '.claude', 'skills'), 'test-skill');
    const disabledCopyPath = join(testDir, '.claude', 'disabled_skills', 'test-skill');

    const moved = await setInstalledSkillState('test-skill', 'disabled', { cwd: testDir });

    expect(moved.status).toBe('disabled');
    await expect(lstat(activeCopyPath)).rejects.toThrow();
    expect((await lstat(disabledCopyPath)).isDirectory()).toBe(true);
  });

  it('re-enables canonical targets and alias symlinks back into the active skills tree', async () => {
    const disabledCanonicalRoot = join(testDir, '.agents', 'disabled_skills');
    const disabledClaudeRoot = join(testDir, '.claude', 'disabled_skills');
    const disabledCanonicalPath = await writeSkill(disabledCanonicalRoot, 'test-skill');
    const disabledAliasPath = join(disabledClaudeRoot, 'test-skill');

    await mkdir(disabledClaudeRoot, { recursive: true });
    await symlink(disabledCanonicalPath, disabledAliasPath, 'junction');

    const moved = await setInstalledSkillState('test-skill', 'enabled', { cwd: testDir });

    const activeCanonicalPath = join(testDir, '.agents', 'skills', 'test-skill');
    const activeAliasPath = join(testDir, '.claude', 'skills', 'test-skill');

    expect(moved.status).toBe('enabled');
    await expect(lstat(disabledCanonicalPath)).rejects.toThrow();
    await expect(lstat(disabledAliasPath)).rejects.toThrow();
    expect((await lstat(activeCanonicalPath)).isDirectory()).toBe(true);
    expect((await lstat(activeAliasPath)).isSymbolicLink()).toBe(true);
    expect(await readlink(activeAliasPath)).toBe('../../.agents/skills/test-skill');
  });

  it('rejects moves when the on-disk state is inconsistent', async () => {
    await writeSkill(join(testDir, '.agents', 'skills'), 'test-skill');
    await writeSkill(join(testDir, '.agents', 'disabled_skills'), 'test-skill');

    await expect(
      setInstalledSkillState('test-skill', 'disabled', { cwd: testDir })
    ).rejects.toThrow(/inconsistent/i);
  });
});
