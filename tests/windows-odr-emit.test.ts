import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { installSkillForAgent } from '../src/installer.ts';
import { emitWindowsOdrArtifacts } from '../src/windows-odr.ts';

async function makeSkillSource(root: string, name: string): Promise<string> {
  const dir = join(root, 'source-skill');
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: a test skill\n---\nBody.\n`,
    'utf-8'
  );
  return dir;
}

describe('windows-odr emitter', () => {
  it('writes the three artifact files with MS-doc-conformant fields', async () => {
    const root = await mkdtemp(join(tmpdir(), 'odr-emit-'));
    try {
      const destDir = join(root, 'dest');
      await mkdir(destDir, { recursive: true });

      const outDir = await emitWindowsOdrArtifacts(
        {
          name: 'my-skill',
          description: 'does a thing',
          path: destDir,
          metadata: { version: '2.3.4' },
        },
        destDir
      );

      const json = JSON.parse(await readFile(join(outDir, 'agentRegistration.json'), 'utf-8'));

      // Only fields defined in the MS doc are present.
      expect(Object.keys(json).sort()).toEqual(
        [
          'action_id',
          'description',
          'display_name',
          'icon',
          'manifest_version',
          'name',
          'placeholder_text',
          'version',
        ].sort()
      );
      expect(json.manifest_version).toBe('0.1.0');
      expect(json.version).toBe('2.3.4');
      expect(json.name).toBe('my-skill');
      expect(json.display_name).toBe('my-skill');
      expect(json.description).toBe('does a thing');
      expect(json.action_id).toBe('{{ACTION_ID}}');
      expect(json.icon).toBe('{{ICON_PATH}}');

      const fragment = await readFile(join(outDir, 'Package.appxmanifest.fragment.xml'), 'utf-8');
      expect(fragment).toContain('com.microsoft.windows.ai.actions');
      expect(fragment).toContain('com.microsoft.windows.ai.agentInfo');
      expect(fragment).toContain('{{ACTION_ID}}');

      const readme = await readFile(join(outDir, 'README.md'), 'utf-8');
      expect(readme).toContain('Windows ODR artifacts');
      expect(readme).toContain('odr.exe agent-info');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('is gated behind options.emitWindowsOdr when called via installSkillForAgent', async () => {
    const root = await mkdtemp(join(tmpdir(), 'odr-gate-'));
    try {
      const projectDir = join(root, 'project');
      await mkdir(projectDir, { recursive: true });

      const skillName = 'gated-skill';
      const skillDir = await makeSkillSource(root, skillName);

      // Default: no flag -> no windows-odr dir.
      const off = await installSkillForAgent(
        { name: skillName, description: 'a test skill', path: skillDir },
        'codex',
        { cwd: projectDir, mode: 'copy', global: false }
      );
      expect(off.success).toBe(true);
      const installedDir = join(projectDir, '.agents/skills', skillName);
      await expect(
        readFile(join(installedDir, 'windows-odr/agentRegistration.json'), 'utf-8')
      ).rejects.toThrow();

      // Opt-in: flag set -> artifacts present.
      const project2 = join(root, 'project2');
      await mkdir(project2, { recursive: true });
      const on = await installSkillForAgent(
        { name: skillName, description: 'a test skill', path: skillDir },
        'codex',
        { cwd: project2, mode: 'copy', global: false, emitWindowsOdr: true }
      );
      expect(on.success).toBe(true);
      const installed2 = join(project2, '.agents/skills', skillName);
      const json = JSON.parse(
        await readFile(join(installed2, 'windows-odr/agentRegistration.json'), 'utf-8')
      );
      expect(json.name).toBe(skillName);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
