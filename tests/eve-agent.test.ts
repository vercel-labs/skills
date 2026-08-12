import { describe, expect, it } from 'vitest';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { detectInstalledAgents, getEveSubagents } from '../src/agents.ts';
import {
  getAgentBaseDir,
  getEveSubagentSkillsDir,
  installBlobSkillForAgent,
  installSkillForAgent,
  isSkillInstalled,
  listInstalledSkills,
} from '../src/installer.ts';

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

async function addEveSubagent(projectDir: string, name: string): Promise<void> {
  await mkdir(join(projectDir, 'agent', 'subagents', name), { recursive: true });
}

async function makeSourceSkill(name: string): Promise<{ root: string; skillDir: string }> {
  const root = await mkdtemp(join(tmpdir(), 'skills-eve-source-'));
  const skillDir = join(root, name);
  await mkdir(skillDir, { recursive: true });
  await writeFile(
    join(skillDir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${name} skill\n---\n# ${name}\n`,
    'utf-8'
  );
  return { root, skillDir };
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

describe('Eve subagents', () => {
  it('discovers subagent directories under agent/subagents, sorted', async () => {
    const projectDir = await makeEveProject();
    try {
      await addEveSubagent(projectDir, 'writer');
      await addEveSubagent(projectDir, 'research');
      // A stray file should be ignored — only directories are subagents.
      await writeFile(join(projectDir, 'agent', 'subagents', 'notes.txt'), 'x', 'utf-8');

      expect(getEveSubagents(projectDir)).toEqual(['research', 'writer']);
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  it('returns no subagents when agent/subagents is absent', async () => {
    const projectDir = await makeEveProject();
    try {
      expect(getEveSubagents(projectDir)).toEqual([]);
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  it('resolves the base dir to the subagent skills directory', () => {
    const cwd = '/tmp/eve-project';
    expect(getAgentBaseDir('eve', false, cwd, 'research')).toBe(
      join(cwd, 'agent', 'subagents', 'research', 'skills')
    );
    // No subagent → root agent skills dir.
    expect(getAgentBaseDir('eve', false, cwd)).toBe(join(cwd, 'agent', 'skills'));
  });

  it('sanitizes subagent names to prevent path traversal', () => {
    const cwd = '/tmp/eve-project';
    const resolved = getEveSubagentSkillsDir('../../etc', cwd);
    expect(resolved.startsWith(join(cwd, 'agent', 'subagents'))).toBe(true);
    expect(resolved).not.toContain('..');
  });

  it('installs a disk skill into a subagent skills directory', async () => {
    const projectDir = await makeEveProject();
    await addEveSubagent(projectDir, 'research');
    const { root, skillDir } = await makeSourceSkill('subagent-skill');

    try {
      const result = await installSkillForAgent(
        { name: 'subagent-skill', description: 'subagent-skill skill', path: skillDir },
        'eve',
        { cwd: projectDir, mode: 'copy', global: false, eveSubagent: 'research' }
      );

      expect(result.success).toBe(true);
      expect(result.path).toBe(join(projectDir, 'agent/subagents/research/skills/subagent-skill'));

      const installed = await readFile(
        join(projectDir, 'agent/subagents/research/skills/subagent-skill/SKILL.md'),
        'utf-8'
      );
      expect(installed).toContain('description: "subagent-skill skill"');

      // The root agent dir should be untouched.
      await expect(access(join(projectDir, 'agent/skills/subagent-skill'))).rejects.toBeTruthy();
    } finally {
      await rm(projectDir, { recursive: true, force: true });
      await rm(root, { recursive: true, force: true });
    }
  });

  it('installs a blob skill into a subagent skills directory', async () => {
    const projectDir = await makeEveProject();
    await addEveSubagent(projectDir, 'research');

    try {
      const result = await installBlobSkillForAgent(
        {
          installName: 'blob-subagent',
          files: [
            {
              path: 'SKILL.md',
              contents: '---\nname: blob-subagent\ndescription: Blob subagent\n---\n# Blob\n',
            },
          ],
        },
        'eve',
        { cwd: projectDir, mode: 'copy', global: false, eveSubagent: 'research' }
      );

      expect(result.success).toBe(true);
      expect(result.path).toBe(join(projectDir, 'agent/subagents/research/skills/blob-subagent'));
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  it('reports skills as installed per subagent via isSkillInstalled', async () => {
    const projectDir = await makeEveProject();
    await addEveSubagent(projectDir, 'research');
    const { root, skillDir } = await makeSourceSkill('present');

    try {
      await installSkillForAgent(
        { name: 'present', description: 'present skill', path: skillDir },
        'eve',
        { cwd: projectDir, mode: 'copy', global: false, eveSubagent: 'research' }
      );

      await expect(
        isSkillInstalled('present', 'eve', { cwd: projectDir, eveSubagent: 'research' })
      ).resolves.toBe(true);
      // Not installed at the root agent.
      await expect(isSkillInstalled('present', 'eve', { cwd: projectDir })).resolves.toBe(false);
    } finally {
      await rm(projectDir, { recursive: true, force: true });
      await rm(root, { recursive: true, force: true });
    }
  });

  it('scans subagent directories when listing installed skills', async () => {
    const previousCwd = process.cwd();
    const projectDir = await makeEveProject();
    await addEveSubagent(projectDir, 'research');

    // Place a packaged skill (with a parseable SKILL.md) directly in the
    // subagent skills dir. We write it directly rather than via the eve
    // installer because eve strips the `name:` field, which parseSkillMd
    // requires — that is a separate, pre-existing eve quirk.
    const subagentSkillDir = join(getEveSubagentSkillsDir('research', projectDir), 'listed-skill');
    await mkdir(subagentSkillDir, { recursive: true });
    await writeFile(
      join(subagentSkillDir, 'SKILL.md'),
      '---\nname: listed-skill\ndescription: Listed skill\n---\n# Listed\n',
      'utf-8'
    );

    try {
      process.chdir(projectDir);
      const listed = await listInstalledSkills({ cwd: projectDir, global: false });
      const names = listed.map((s) => s.name);
      expect(names).toContain('listed-skill');
    } finally {
      process.chdir(previousCwd);
      await rm(projectDir, { recursive: true, force: true });
    }
  });
});
