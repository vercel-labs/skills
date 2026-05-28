/**
 * Tests for per-provider skill variants.
 *
 * Some repos ship a separate compiled build of the same skill per agent
 * (e.g. `.claude/skills/<name>`, `.agents/skills/<name>`, with different
 * command prefixes, model names, or script paths baked in). Discovery records
 * those as `skill.variants` (agent skillsDir -> path), and copy-mode install
 * uses the build compiled for each target agent rather than a single shared one.
 */

import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { discoverSkills } from '../src/skills.ts';
import { installSkillForAgent } from '../src/installer.ts';

async function writeVariant(
  root: string,
  skillsDir: string,
  name: string,
  body: string
): Promise<string> {
  const dir = join(root, skillsDir, name);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${name} (${skillsDir})\n---\n\n${body}\n`,
    'utf-8'
  );
  return dir;
}

describe('per-provider skill variants', () => {
  it('discovery records a variant per agent skillsDir when a repo ships several builds', async () => {
    const root = await mkdtemp(join(tmpdir(), 'variants-discover-'));
    try {
      await writeVariant(root, '.claude/skills', 'demo', 'claude build');
      await writeVariant(root, '.agents/skills', 'demo', 'agents build');

      const skills = await discoverSkills(root);
      const demo = skills.find((s) => s.name === 'demo');

      expect(demo).toBeDefined();
      expect(demo!.variants).toBeDefined();
      expect(Object.keys(demo!.variants!).sort()).toEqual(['.agents/skills', '.claude/skills']);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('does not set variants for a single-build skill', async () => {
    const root = await mkdtemp(join(tmpdir(), 'variants-single-'));
    try {
      await writeVariant(root, 'skills', 'solo', 'only build');

      const skills = await discoverSkills(root);
      const solo = skills.find((s) => s.name === 'solo');

      expect(solo).toBeDefined();
      expect(solo!.variants).toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('copy mode installs the variant compiled for each target agent', async () => {
    const root = await mkdtemp(join(tmpdir(), 'variants-install-'));
    const projectDir = join(root, 'project');
    await mkdir(projectDir, { recursive: true });
    try {
      const claudePath = await writeVariant(root, 'src/.claude/skills', 'demo', 'CLAUDE BUILD');
      const agentsPath = await writeVariant(root, 'src/.agents/skills', 'demo', 'AGENTS BUILD');
      const skill = {
        name: 'demo',
        description: 'demo',
        path: claudePath,
        variants: { '.claude/skills': claudePath, '.agents/skills': agentsPath },
      };

      // claude-code -> .claude/skills, codex -> .agents/skills
      const claudeResult = await installSkillForAgent(skill, 'claude-code', {
        cwd: projectDir,
        mode: 'copy',
      });
      const codexResult = await installSkillForAgent(skill, 'codex', {
        cwd: projectDir,
        mode: 'copy',
      });

      expect(claudeResult.success).toBe(true);
      expect(codexResult.success).toBe(true);

      const claudeInstalled = await readFile(
        join(projectDir, '.claude/skills/demo/SKILL.md'),
        'utf-8'
      );
      const agentsInstalled = await readFile(
        join(projectDir, '.agents/skills/demo/SKILL.md'),
        'utf-8'
      );
      expect(claudeInstalled).toContain('CLAUDE BUILD');
      expect(agentsInstalled).toContain('AGENTS BUILD');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('copy mode falls back to skill.path when the target agent has no variant', async () => {
    const root = await mkdtemp(join(tmpdir(), 'variants-fallback-'));
    const projectDir = join(root, 'project');
    await mkdir(projectDir, { recursive: true });
    try {
      const claudePath = await writeVariant(root, 'src/.claude/skills', 'demo', 'CLAUDE BUILD');
      const agentsPath = await writeVariant(root, 'src/.agents/skills', 'demo', 'AGENTS BUILD');
      const skill = {
        name: 'demo',
        description: 'demo',
        path: claudePath, // primary discovered build
        variants: { '.claude/skills': claudePath, '.agents/skills': agentsPath },
      };

      // roo -> .roo/skills, which is not in variants, so it uses skill.path.
      const result = await installSkillForAgent(skill, 'roo', { cwd: projectDir, mode: 'copy' });

      expect(result.success).toBe(true);
      const installed = await readFile(join(projectDir, '.roo/skills/demo/SKILL.md'), 'utf-8');
      expect(installed).toContain('CLAUDE BUILD');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
