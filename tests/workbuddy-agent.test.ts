import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const host = vi.hoisted(() => ({ home: '' }));
vi.mock('os', async (importOriginal) => ({
  ...(await importOriginal<typeof import('os')>()),
  homedir: () => host.home,
}));

describe('WorkBuddy agent support', () => {
  let root: string;
  let project: string;
  const content = '---\nname: review\ndescription: Review changes.\n---\n\n# Review\n';

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'skills-workbuddy-'));
    host.home = join(root, 'home');
    project = join(root, 'project');
    mkdirSync(host.home);
    mkdirSync(project);
    vi.resetModules();
  });

  afterEach(() => {
    vi.resetModules();
    rmSync(root, { recursive: true, force: true });
  });

  it('does not detect WorkBuddy from CodeBuddy directories', async () => {
    mkdirSync(join(host.home, '.codebuddy'));
    mkdirSync(join(project, '.codebuddy'));
    const { agents } = await import('../src/agents.ts');

    await expect(agents.workbuddy.detectInstalled(project)).resolves.toBe(false);
    await expect(agents.codebuddy.detectInstalled(project)).resolves.toBe(true);
  });

  it('detects WorkBuddy in the home directory', async () => {
    mkdirSync(join(host.home, '.workbuddy'));
    const { agents } = await import('../src/agents.ts');

    await expect(agents.workbuddy.detectInstalled(project)).resolves.toBe(true);
  });

  it('detects WorkBuddy in the supplied project directory', async () => {
    mkdirSync(join(project, '.workbuddy'));
    const { agents } = await import('../src/agents.ts');

    await expect(agents.workbuddy.detectInstalled(project)).resolves.toBe(true);
    await expect(agents.workbuddy.detectInstalled(join(root, 'other-project'))).resolves.toBe(
      false
    );
  });

  it('discovers skills in the hidden WorkBuddy directory', async () => {
    const skillPath = join(project, '.workbuddy', 'skills', 'review');
    mkdirSync(skillPath, { recursive: true });
    writeFileSync(join(skillPath, 'SKILL.md'), content);
    const { discoverSkills } = await import('../src/skills.ts');

    const skills = await discoverSkills(project);

    expect(skills).toEqual([expect.objectContaining({ name: 'review', path: skillPath })]);
  });

  it.each([
    { global: false, mode: 'copy' },
    { global: false, mode: 'symlink' },
    { global: true, mode: 'copy' },
    { global: true, mode: 'symlink' },
  ] as const)('installs and lists skills with global=$global and mode=$mode', async (options) => {
    const source = join(root, 'source');
    mkdirSync(source);
    writeFileSync(join(source, 'SKILL.md'), content);
    const { installSkillForAgent, listInstalledSkills } = await import('../src/installer.ts');

    const result = await installSkillForAgent(
      { name: 'review', description: 'Review changes.', path: source },
      'workbuddy',
      { ...options, cwd: project, createMissingAgentRoot: true }
    );

    expect(result.success).toBe(true);
    expect(result.skipped).not.toBe(true);
    expect(result.path).toBe(
      join(options.global ? host.home : project, '.workbuddy', 'skills', 'review')
    );
    expect(readFileSync(join(result.path, 'SKILL.md'), 'utf8')).toBe(content);
    const installed = await listInstalledSkills({
      global: options.global,
      cwd: project,
      agentFilter: ['workbuddy'],
    });
    expect(installed).toEqual([expect.objectContaining({ name: 'review', agents: ['workbuddy'] })]);
  });
});
