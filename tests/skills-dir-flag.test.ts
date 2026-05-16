/**
 * Tests for the `--skills-dir <path>` flag.
 *
 * The flag tells `skills add` to install directly to a caller-supplied directory
 * (e.g. ~/my-app/skills) instead of routing through the canonical
 * .agents/skills + agent-symlink scheme. Mutually exclusive with --global;
 * forces copy-mode internally.
 */

import { describe, expect, it } from 'vitest';
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { expandPath, parseAddOptions } from '../src/add.ts';
import { installSkillForAgent } from '../src/installer.ts';
import { runCli } from '../src/test-utils.ts';

async function makeSkillSource(root: string, name: string): Promise<string> {
  const dir = join(root, 'source-skill');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: test\n---\n`, 'utf-8');
  return dir;
}

describe('--skills-dir flag', () => {
  describe('parseAddOptions', () => {
    it('recognizes --skills-dir <path> and stores it on options', () => {
      const { source, options } = parseAddOptions([
        'owner/repo',
        '--skills-dir',
        '/tmp/my-skills',
        '-y',
      ]);
      expect(source).toEqual(['owner/repo']);
      expect(options.skillsDir).toBe('/tmp/my-skills');
      expect(options.yes).toBe(true);
    });

    it('marks --skills-dir as the empty-string sentinel when no argument follows', () => {
      // parseAddOptions delegates the user-facing error to runAdd; it just
      // marks the flag as present-but-empty.
      const { options } = parseAddOptions(['owner/repo', '--skills-dir']);
      expect(options.skillsDir).toBe('');
    });

    it('treats next-arg-as-flag (-y) as missing argument for --skills-dir', () => {
      const { options } = parseAddOptions(['owner/repo', '--skills-dir', '-y']);
      expect(options.skillsDir).toBe('');
      // -y should still be parsed normally because we did not consume it.
      expect(options.yes).toBe(true);
    });

    it('keeps source positional and other flags intact alongside --skills-dir', () => {
      const { source, options } = parseAddOptions([
        '--skills-dir',
        '~/foo',
        'owner/repo',
        '--skill',
        'one',
        'two',
      ]);
      expect(source).toEqual(['owner/repo']);
      expect(options.skillsDir).toBe('~/foo');
      expect(options.skill).toEqual(['one', 'two']);
    });
  });

  describe('expandPath', () => {
    it('expands a leading ~ to the user home directory', () => {
      expect(expandPath('~/foo/bar')).toBe(join(homedir(), 'foo', 'bar'));
      expect(expandPath('~')).toBe(homedir());
    });

    it('expands a leading $HOME / ${HOME} token', () => {
      expect(expandPath('$HOME/foo')).toBe(join(homedir(), 'foo'));
      expect(expandPath('${HOME}/foo')).toBe(join(homedir(), 'foo'));
      expect(expandPath('$HOME')).toBe(homedir());
    });

    it('resolves relative paths against process.cwd()', () => {
      const result = expandPath('./somewhere');
      expect(result.startsWith('/')).toBe(true);
      expect(result.endsWith('somewhere')).toBe(true);
    });

    it('returns absolute paths unchanged (after normalization)', () => {
      expect(expandPath('/tmp/already-absolute')).toBe('/tmp/already-absolute');
    });

    it('does not mangle a path that merely contains ~ in the middle', () => {
      // We only expand a leading ~, not embedded ones.
      expect(expandPath('/tmp/ab~cd')).toBe('/tmp/ab~cd');
    });
  });

  describe('installSkillForAgent (skillsDir option)', () => {
    it('writes to <skillsDir>/<skill-name> and skips canonical .agents/skills', async () => {
      const root = await mkdtemp(join(tmpdir(), 'skills-dir-flag-'));
      const projectDir = join(root, 'project');
      const customDir = join(root, 'custom-skills');
      await mkdir(projectDir, { recursive: true });

      const skillName = 'my-custom-skill';
      const skillSrc = await makeSkillSource(root, skillName);

      try {
        const result = await installSkillForAgent(
          { name: skillName, description: 'test', path: skillSrc },
          'universal',
          { cwd: projectDir, skillsDir: customDir }
        );

        expect(result.success).toBe(true);
        expect(result.mode).toBe('copy');
        expect(result.path).toBe(join(customDir, skillName));

        // Verify SKILL.md landed in the custom dir
        await expect(readFile(join(customDir, skillName, 'SKILL.md'), 'utf-8')).resolves.toContain(
          skillName
        );

        // Verify the canonical .agents/skills tree was NOT created
        await expect(access(join(projectDir, '.agents', 'skills'))).rejects.toThrow();
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });

    it('auto-creates the parent skillsDir if it does not exist', async () => {
      const root = await mkdtemp(join(tmpdir(), 'skills-dir-flag-mkdir-'));
      // Note: customDir nested 3 levels deep, none of which exist yet.
      const customDir = join(root, 'a', 'b', 'c');

      const skillName = 'auto-mkdir-skill';
      const skillSrc = await makeSkillSource(root, skillName);

      try {
        const result = await installSkillForAgent(
          { name: skillName, description: 'test', path: skillSrc },
          'universal',
          { skillsDir: customDir }
        );

        expect(result.success).toBe(true);
        await expect(access(join(customDir, skillName, 'SKILL.md'))).resolves.toBeUndefined();
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });

    it('rejects skill names that would escape skillsDir (path traversal)', async () => {
      const root = await mkdtemp(join(tmpdir(), 'skills-dir-flag-traversal-'));
      const customDir = join(root, 'safe-zone');
      await mkdir(customDir, { recursive: true });

      const skillSrc = await makeSkillSource(root, 'whatever');

      try {
        const result = await installSkillForAgent(
          { name: '../../../../etc/evil', description: 'malicious', path: skillSrc },
          'universal',
          { skillsDir: customDir }
        );

        // sanitizeName strips leading dots/slashes, so this shouldn't actually
        // escape — but the result must still land inside customDir, never above it.
        if (result.success) {
          const resolved = result.path;
          expect(resolved.startsWith(customDir)).toBe(true);
        }
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });

    it('overwrites existing skill content when re-installing to the same skillsDir', async () => {
      const root = await mkdtemp(join(tmpdir(), 'skills-dir-flag-overwrite-'));
      const customDir = join(root, 'custom-skills');
      const skillName = 'reinstall-skill';
      const skillSrc = await makeSkillSource(root, skillName);

      try {
        // First install
        await installSkillForAgent(
          { name: skillName, description: 'v1', path: skillSrc },
          'universal',
          { skillsDir: customDir }
        );

        // Stale file from a previous install that should be wiped out.
        await writeFile(join(customDir, skillName, 'STALE.txt'), 'old', 'utf-8');

        // Update skill source and reinstall
        await writeFile(
          join(skillSrc, 'SKILL.md'),
          `---\nname: ${skillName}\ndescription: v2\n---\n`,
          'utf-8'
        );

        const result = await installSkillForAgent(
          { name: skillName, description: 'v2', path: skillSrc },
          'universal',
          { skillsDir: customDir }
        );

        expect(result.success).toBe(true);
        const content = await readFile(join(customDir, skillName, 'SKILL.md'), 'utf-8');
        expect(content).toContain('description: v2');
        // Stale file is gone
        await expect(access(join(customDir, skillName, 'STALE.txt'))).rejects.toThrow();
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  });

  describe('CLI integration', () => {
    it('errors when --skills-dir is given without an argument', () => {
      const root = tmpdir();
      const result = runCli(['add', 'owner/repo', '--skills-dir', '-y'], root);
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toContain('--skills-dir requires a path argument');
    });

    it('errors when --skills-dir is combined with --global', () => {
      const result = runCli(
        ['add', 'owner/repo', '--skills-dir', '/tmp/x', '--global', '-y'],
        tmpdir()
      );
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toContain('--skills-dir cannot be combined with --global');
    });

    it('installs a local skill into a custom dir without prompting for an agent', async () => {
      const root = await mkdtemp(join(tmpdir(), 'skills-dir-flag-cli-'));
      const sourceDir = join(root, 'source');
      const customDir = join(root, 'target');
      await mkdir(sourceDir, { recursive: true });

      // Create a self-contained local skill source
      const skillName = 'cli-skill';
      const skillDir = join(sourceDir, skillName);
      await mkdir(skillDir, { recursive: true });
      await writeFile(
        join(skillDir, 'SKILL.md'),
        `---\nname: ${skillName}\ndescription: test\n---\n`,
        'utf-8'
      );

      try {
        const result = runCli(['add', sourceDir, '--skills-dir', customDir, '-y'], root);

        expect(result.exitCode).toBe(0);
        await expect(readFile(join(customDir, skillName, 'SKILL.md'), 'utf-8')).resolves.toContain(
          skillName
        );

        // Confirm we did NOT also write to the canonical project location
        // or to any agent-specific dir under cwd.
        await expect(access(join(root, '.agents', 'skills'))).rejects.toThrow();
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  });
});
