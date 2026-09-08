import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { agents, getUniversalAgents, isUniversalAgent } from '../src/agents.ts';
import { getAgentBaseDir, installSkillForAgent } from '../src/installer.ts';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

describe('Manus agent', () => {
  it('uses the canonical universal paths for project and global installs', () => {
    const project = '/tmp/manus-project';

    expect(agents.manus).toMatchObject({
      name: 'manus',
      displayName: 'Manus',
      skillsDir: '.agents/skills',
      globalSkillsDir: join(homedir(), '.agents', 'skills'),
    });
    expect(isUniversalAgent('manus')).toBe(true);
    expect(getUniversalAgents()).toContain('manus');
    expect(getAgentBaseDir('manus', false, project)).toBe(join(project, '.agents', 'skills'));
    expect(getAgentBaseDir('manus', true)).toBe(join(homedir(), '.agents', 'skills'));
  });

  it('installs an explicitly selected Manus skill into one canonical project directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'manus-agent-'));
    temporaryRoots.push(root);
    const source = join(root, 'source');
    const project = join(root, 'project');
    await mkdir(source, { recursive: true });
    await mkdir(project, { recursive: true });
    await writeFile(
      join(source, 'SKILL.md'),
      '---\nname: manus-webdev\ndescription: Build web applications.\n---\n',
      'utf-8'
    );

    const result = await installSkillForAgent(
      { name: 'manus-webdev', description: 'Build web applications.', path: source },
      'manus',
      { cwd: project, global: false, mode: 'copy' }
    );

    const expected = join(project, '.agents', 'skills', 'manus-webdev');
    expect(result).toMatchObject({ success: true, path: expected });
    await expect(readFile(join(expected, 'SKILL.md'), 'utf-8')).resolves.toContain(
      'name: manus-webdev'
    );
  });
});
