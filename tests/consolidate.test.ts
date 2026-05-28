import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdir, rm, writeFile, readFile, lstat, symlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import * as agentsModule from '../src/agents.ts';

vi.mock('../src/agents.ts', async () => {
  const actual = await vi.importActual('../src/agents.ts');
  return {
    ...actual,
    detectInstalledAgents: vi.fn(),
  };
});

describe('consolidate command', () => {
  let tempDir: string;
  let canonicalDir: string;
  let claudeSkillsDir: string;
  let codexSkillsDir: string;
  let origClaudeGlobal: string | undefined;
  let origCodexGlobal: string | undefined;

  beforeEach(async () => {
    tempDir = resolve(join(tmpdir(), 'skills-consolidate-test-' + Date.now()));
    await mkdir(tempDir, { recursive: true });
    canonicalDir = join(tempDir, '.agents', 'skills');
    claudeSkillsDir = join(tempDir, '.claude', 'skills');
    codexSkillsDir = join(tempDir, '.codex', 'skills');

    await mkdir(canonicalDir, { recursive: true });
    await mkdir(claudeSkillsDir, { recursive: true });
    await mkdir(codexSkillsDir, { recursive: true });

    vi.mocked(agentsModule.detectInstalledAgents).mockResolvedValue(['claude-code', 'codex']);

    // Override agents globalSkillsDir for testing
    const agentsRecord = agentsModule.agents as Record<string, { globalSkillsDir?: string }>;
    origClaudeGlobal = agentsRecord['claude-code']!.globalSkillsDir;
    origCodexGlobal = agentsRecord['codex']!.globalSkillsDir;
    agentsRecord['claude-code']!.globalSkillsDir = claudeSkillsDir;
    agentsRecord['codex']!.globalSkillsDir = codexSkillsDir;
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
    // Restore original values
    const agentsRecord = agentsModule.agents as Record<string, { globalSkillsDir?: string }>;
    agentsRecord['claude-code']!.globalSkillsDir = origClaudeGlobal;
    agentsRecord['codex']!.globalSkillsDir = origCodexGlobal;
  });
  it('should move a skill to canonical and create symlink', async () => {
    // Create a real skill in claude dir
    const skillDir = join(claudeSkillsDir, 'my-skill');
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, 'SKILL.md'),
      '---\nname: my-skill\ndescription: test\n---\n# my-skill'
    );

    const { runConsolidate } = await import('../src/consolidate.ts');
    await runConsolidate([], { global: true, yes: true, _canonicalDir: canonicalDir });
    const stats = await lstat(skillDir);
    expect(stats.isSymbolicLink()).toBe(true);

    // Canonical should have the skill
    const canonicalSkill = join(canonicalDir, 'my-skill', 'SKILL.md');
    const canonicalStats = await lstat(canonicalSkill);
    expect(canonicalStats.isFile()).toBe(true);
  });

  it('should skip directories that are already symlinks', async () => {
    // Create canonical skill
    const canonicalSkill = join(canonicalDir, 'linked-skill');
    await mkdir(canonicalSkill, { recursive: true });
    await writeFile(
      join(canonicalSkill, 'SKILL.md'),
      '---\nname: linked-skill\ndescription: test\n---\n# linked-skill'
    );

    // Create symlink in claude dir
    const claudeSkill = join(claudeSkillsDir, 'linked-skill');
    await symlink(canonicalSkill, claudeSkill);

    const { runConsolidate } = await import('../src/consolidate.ts');
    await runConsolidate([], { global: true, yes: true, _canonicalDir: canonicalDir });

    // Should still be a symlink (unchanged)
    const stats = await lstat(claudeSkill);
    expect(stats.isSymbolicLink()).toBe(true);
  });

  it('should replace duplicate with symlink when canonical already has same content', async () => {
    // Create skill in canonical
    const canonicalSkill = join(canonicalDir, 'dup-skill');
    await mkdir(canonicalSkill, { recursive: true });
    await writeFile(
      join(canonicalSkill, 'SKILL.md'),
      '---\nname: dup-skill\ndescription: test\n---\n# dup-skill'
    );

    // Create identical skill in codex dir
    const codexSkill = join(codexSkillsDir, 'dup-skill');
    await mkdir(codexSkill, { recursive: true });
    await writeFile(
      join(codexSkill, 'SKILL.md'),
      '---\nname: dup-skill\ndescription: test\n---\n# dup-skill'
    );

    const { runConsolidate } = await import('../src/consolidate.ts');
    await runConsolidate([], { global: true, yes: true, _canonicalDir: canonicalDir });

    // Codex dir should now be a symlink
    const stats = await lstat(codexSkill);
    expect(stats.isSymbolicLink()).toBe(true);
  });

  it('should fork conflicts as agent-specific skills when content differs', async () => {
    // Create skill in canonical with different content
    const canonicalSkill = join(canonicalDir, 'conflict-skill');
    await mkdir(canonicalSkill, { recursive: true });
    await writeFile(
      join(canonicalSkill, 'SKILL.md'),
      '---\nname: conflict-skill\ndescription: canonical version\n---\n# v1'
    );

    // Create different skill in claude dir
    const claudeSkill = join(claudeSkillsDir, 'conflict-skill');
    await mkdir(claudeSkill, { recursive: true });
    await writeFile(
      join(claudeSkill, 'SKILL.md'),
      '---\nname: conflict-skill\ndescription: claude version\n---\n# v2'
    );

    const { runConsolidate } = await import('../src/consolidate.ts');
    await runConsolidate([], { global: true, yes: true, _canonicalDir: canonicalDir });

    // Claude dir should now be a symlink (pointing to forked version)
    const stats = await lstat(claudeSkill);
    expect(stats.isSymbolicLink()).toBe(true);

    // Forked version should exist in canonical as conflict-skill-claude-code
    const forkedSkill = join(canonicalDir, 'conflict-skill-claude-code', 'SKILL.md');
    const forkedStats = await lstat(forkedSkill);
    expect(forkedStats.isFile()).toBe(true);
  });

  it('should not modify filesystem in dry-run mode', async () => {
    const skillDir = join(claudeSkillsDir, 'dry-skill');
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, 'SKILL.md'),
      '---\nname: dry-skill\ndescription: test\n---\n# dry-skill'
    );

    const { runConsolidate } = await import('../src/consolidate.ts');
    await runConsolidate([], {
      global: true,
      yes: true,
      dryRun: true,
      _canonicalDir: canonicalDir,
    });

    // Should still be a real directory
    const stats = await lstat(skillDir);
    expect(stats.isSymbolicLink()).toBe(false);
    expect(stats.isDirectory()).toBe(true);

    // Canonical should NOT have the skill
    await expect(lstat(join(canonicalDir, 'dry-skill'))).rejects.toThrow();
  });

  it('should write fork manifest when conflicts are forked', async () => {
    // Create skill in canonical
    const canonicalSkill = join(canonicalDir, 'fork-test');
    await mkdir(canonicalSkill, { recursive: true });
    await writeFile(
      join(canonicalSkill, 'SKILL.md'),
      '---\nname: fork-test\ndescription: v1\n---\n# v1'
    );

    // Create different version in codex
    const codexSkill = join(codexSkillsDir, 'fork-test');
    await mkdir(codexSkill, { recursive: true });
    await writeFile(
      join(codexSkill, 'SKILL.md'),
      '---\nname: fork-test\ndescription: v2\n---\n# v2'
    );

    const { runConsolidate } = await import('../src/consolidate.ts');
    await runConsolidate([], { global: true, yes: true, _canonicalDir: canonicalDir });

    // .forks.json should exist and record the fork
    const manifest = JSON.parse(await readFile(join(canonicalDir, '.forks.json'), 'utf-8'));
    expect(manifest['fork-test-codex']).toBe('codex');
  });

  it('--sync-all should create symlinks for missing skills in agents', async () => {
    // Create a skill only in canonical
    const canonicalSkill = join(canonicalDir, 'sync-skill');
    await mkdir(canonicalSkill, { recursive: true });
    await writeFile(
      join(canonicalSkill, 'SKILL.md'),
      '---\nname: sync-skill\ndescription: test\n---\n# sync-skill'
    );

    // Neither claude nor codex has it
    const { runConsolidate } = await import('../src/consolidate.ts');
    await runConsolidate([], {
      global: true,
      yes: true,
      syncAll: true,
      _canonicalDir: canonicalDir,
    });

    // Both agents should now have a symlink
    expect((await lstat(join(claudeSkillsDir, 'sync-skill'))).isSymbolicLink()).toBe(true);
    expect((await lstat(join(codexSkillsDir, 'sync-skill'))).isSymbolicLink()).toBe(true);
  });

  it('--sync-all should only sync forked skills to their designated agent', async () => {
    // Create a forked skill in canonical with manifest
    const forkedSkill = join(canonicalDir, 'my-api-claude-code');
    await mkdir(forkedSkill, { recursive: true });
    await writeFile(
      join(forkedSkill, 'SKILL.md'),
      '---\nname: my-api\ndescription: claude version\n---\n# claude'
    );

    // Write fork manifest
    await writeFile(
      join(canonicalDir, '.forks.json'),
      JSON.stringify({ 'my-api-claude-code': 'claude-code' })
    );

    const { runConsolidate } = await import('../src/consolidate.ts');
    await runConsolidate([], {
      global: true,
      yes: true,
      syncAll: true,
      _canonicalDir: canonicalDir,
    });

    // Claude should have it (as "my-api", suffix stripped)
    expect((await lstat(join(claudeSkillsDir, 'my-api'))).isSymbolicLink()).toBe(true);

    // Codex should NOT have it
    await expect(lstat(join(codexSkillsDir, 'my-api'))).rejects.toThrow();
    await expect(lstat(join(codexSkillsDir, 'my-api-claude-code'))).rejects.toThrow();
  });
});
