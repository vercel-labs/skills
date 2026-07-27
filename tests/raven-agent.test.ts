import { join } from 'path';
import { homedir, tmpdir } from 'os';
import { access, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { agents, isRavenInstalled } from '../src/agents.ts';
import { installSkillForAgent } from '../src/installer.ts';

describe('Raven agent support', () => {
  it('uses the Raven workspace skill directories', () => {
    expect(agents.raven.name).toBe('raven');
    expect(agents.raven.displayName).toBe('Raven');
    expect(agents.raven.skillsDir).toBe('skills');
    expect(agents.raven.globalSkillsDir).toBe(join(homedir(), '.raven', 'workspace', 'skills'));
  });

  it('detects Raven from its home directory', () => {
    const home = '/tmp/home';
    const exists = (path: string) => path === join(home, '.raven');

    expect(isRavenInstalled(home, exists)).toBe(true);
  });

  it('returns false when the Raven home directory is absent', () => {
    expect(isRavenInstalled('/tmp/home', () => false)).toBe(false);
  });

  it('copies project skills into the Raven workspace skills directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'raven-agent-'));
    const workspace = join(root, 'workspace');
    const source = join(root, 'source');
    await mkdir(workspace, { recursive: true });
    await mkdir(source, { recursive: true });
    await writeFile(
      join(source, 'SKILL.md'),
      '---\nname: example\ndescription: Raven test skill\n---\n',
      'utf-8'
    );

    try {
      const result = await installSkillForAgent(
        { name: 'example', description: 'Raven test skill', path: source },
        'raven',
        { cwd: workspace, mode: 'copy' }
      );

      expect(result).toMatchObject({
        success: true,
        path: join(workspace, 'skills', 'example'),
        mode: 'copy',
      });
      await expect(
        access(join(workspace, 'skills', 'example', 'SKILL.md'))
      ).resolves.toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
