import { describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { detectInstalledAgents } from '../src/agents.ts';
import { installBlobSkillForAgent, installSkillForAgent } from '../src/installer.ts';

async function makeEveProject(): Promise<string> {
  const projectDir = await mkdtemp(join(tmpdir(), 'skills-eve-'));
  await mkdir(join(projectDir, 'agent'), { recursive: true });
  await writeFile(
    join(projectDir, 'package.json'),
    JSON.stringify({ dependencies: { eve: '^0.11.5' } }),
    'utf-8'
  );
  return projectDir;
}

describe('Eve agent support', () => {
  it('detects an Eve project from agent/ and the eve package dependency', async () => {
    const projectDir = await makeEveProject();
    const previousCwd = process.cwd();

    try {
      process.chdir(projectDir);
      await expect(detectInstalledAgents()).resolves.toContain('eve');
    } finally {
      process.chdir(previousCwd);
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  it('installs disk skills to agent/skills without unsupported name frontmatter', async () => {
    const projectDir = await makeEveProject();
    const root = await mkdtemp(join(tmpdir(), 'skills-eve-source-'));
    const skillDir = join(root, 'source-skill');
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, 'SKILL.md'),
      '---\nname: test-skill\ndescription: Test skill\n---\n# Test\n',
      'utf-8'
    );

    try {
      const result = await installSkillForAgent(
        { name: 'test-skill', description: 'Test skill', path: skillDir },
        'eve',
        { cwd: projectDir, mode: 'symlink', global: false }
      );

      expect(result.success).toBe(true);
      expect(result.path).toBe(join(projectDir, 'agent/skills/test-skill'));
      expect(result.canonicalPath).toBe(join(projectDir, 'agent/skills/test-skill'));

      const installed = await readFile(
        join(projectDir, 'agent/skills/test-skill/SKILL.md'),
        'utf-8'
      );
      expect(installed).toContain('description: "Test skill"');
      expect(installed).not.toContain('name:');
    } finally {
      await rm(projectDir, { recursive: true, force: true });
      await rm(root, { recursive: true, force: true });
    }
  });

  it('installs blob skills without unsupported name frontmatter', async () => {
    const projectDir = await makeEveProject();

    try {
      const result = await installBlobSkillForAgent(
        {
          installName: 'blob-skill',
          files: [
            {
              path: 'SKILL.md',
              contents: '---\nname: blob-skill\ndescription: Blob skill\n---\n# Blob\n',
            },
          ],
        },
        'eve',
        { cwd: projectDir, mode: 'copy', global: false }
      );

      expect(result.success).toBe(true);
      expect(result.path).toBe(join(projectDir, 'agent/skills/blob-skill'));

      const installed = await readFile(
        join(projectDir, 'agent/skills/blob-skill/SKILL.md'),
        'utf-8'
      );
      expect(installed).toContain('description: "Blob skill"');
      expect(installed).not.toContain('name:');
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });
});
