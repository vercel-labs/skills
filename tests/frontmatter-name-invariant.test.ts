/**
 * Tests for the invariant: installed skill folder name must match SKILL.md front-matter name.
 *
 * When a skill's source directory name differs from its front-matter name,
 * the installed folder should use the front-matter name.
 */

import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile, readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  installSkillForAgent,
  installRemoteSkillForAgent,
  installWellKnownSkillForAgent,
  installMintlifySkillForAgent,
} from '../src/installer.ts';

describe('front-matter name invariant: folder name matches SKILL.md name', () => {
  describe('installSkillForAgent', () => {
    it('uses front-matter name even when source directory has a different name', async () => {
      const root = await mkdtemp(join(tmpdir(), 'add-skill-'));
      const projectDir = join(root, 'project');
      await mkdir(projectDir, { recursive: true });

      // Source directory named "wrong-name" but SKILL.md has name: "correct-name"
      const sourceDir = join(root, 'wrong-name');
      await mkdir(sourceDir, { recursive: true });
      await writeFile(
        join(sourceDir, 'SKILL.md'),
        '---\nname: correct-name\ndescription: test\n---\nContent here',
        'utf-8'
      );

      try {
        const result = await installSkillForAgent(
          { name: 'correct-name', description: 'test', path: sourceDir },
          'claude-code',
          { cwd: projectDir, mode: 'symlink', global: false }
        );

        expect(result.success).toBe(true);

        // The folder should be named "correct-name", not "wrong-name"
        const correctPath = join(projectDir, '.agents/skills', 'correct-name');
        await expect(access(correctPath)).resolves.toBeUndefined();

        const content = await readFile(join(correctPath, 'SKILL.md'), 'utf-8');
        expect(content).toContain('name: correct-name');
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  });

  describe('installRemoteSkillForAgent', () => {
    it('uses front-matter name instead of installName for folder', async () => {
      const root = await mkdtemp(join(tmpdir(), 'add-skill-'));
      const projectDir = join(root, 'project');
      await mkdir(projectDir, { recursive: true });

      const skillContent =
        '---\nname: my-actual-name\ndescription: A test skill\n---\nSkill content here';

      try {
        const result = await installRemoteSkillForAgent(
          {
            name: 'my-actual-name',
            description: 'A test skill',
            content: skillContent,
            installName: 'different-install-name',
            sourceUrl: 'https://example.com/SKILL.md',
            providerId: 'test',
            sourceIdentifier: 'test/test',
          },
          'claude-code',
          { cwd: projectDir, mode: 'symlink', global: false }
        );

        expect(result.success).toBe(true);

        // Should use "my-actual-name" (front-matter), not "different-install-name"
        const correctPath = join(projectDir, '.agents/skills', 'my-actual-name');
        await expect(access(correctPath)).resolves.toBeUndefined();

        const content = await readFile(join(correctPath, 'SKILL.md'), 'utf-8');
        expect(content).toContain('name: my-actual-name');

        // The wrong folder should NOT exist
        const wrongPath = join(projectDir, '.agents/skills', 'different-install-name');
        await expect(access(wrongPath)).rejects.toThrow();
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });

    it('falls back to installName when front-matter name is empty', async () => {
      const root = await mkdtemp(join(tmpdir(), 'add-skill-'));
      const projectDir = join(root, 'project');
      await mkdir(projectDir, { recursive: true });

      try {
        const result = await installRemoteSkillForAgent(
          {
            name: '',
            description: 'A test skill',
            content: '---\nname: \ndescription: test\n---\n',
            installName: 'fallback-name',
            sourceUrl: 'https://example.com/SKILL.md',
            providerId: 'test',
            sourceIdentifier: 'test/test',
          },
          'claude-code',
          { cwd: projectDir, mode: 'symlink', global: false }
        );

        expect(result.success).toBe(true);

        const fallbackPath = join(projectDir, '.agents/skills', 'fallback-name');
        await expect(access(fallbackPath)).resolves.toBeUndefined();
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });

    it('uses front-matter name in copy mode too', async () => {
      const root = await mkdtemp(join(tmpdir(), 'add-skill-'));
      const projectDir = join(root, 'project');
      await mkdir(projectDir, { recursive: true });

      const skillContent =
        '---\nname: copy-mode-name\ndescription: A test skill\n---\nSkill content';

      try {
        const result = await installRemoteSkillForAgent(
          {
            name: 'copy-mode-name',
            description: 'A test skill',
            content: skillContent,
            installName: 'wrong-copy-name',
            sourceUrl: 'https://example.com/SKILL.md',
            providerId: 'test',
            sourceIdentifier: 'test/test',
          },
          'claude-code',
          { cwd: projectDir, mode: 'copy', global: false }
        );

        expect(result.success).toBe(true);

        // Should use front-matter name in copy mode
        const correctPath = join(projectDir, '.claude/skills', 'copy-mode-name');
        await expect(access(correctPath)).resolves.toBeUndefined();
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  });

  describe('installWellKnownSkillForAgent', () => {
    it('uses front-matter name instead of installName for folder', async () => {
      const root = await mkdtemp(join(tmpdir(), 'add-skill-'));
      const projectDir = join(root, 'project');
      await mkdir(projectDir, { recursive: true });

      const skillContent =
        '---\nname: wellknown-actual-name\ndescription: A well-known skill\n---\nContent';

      try {
        const result = await installWellKnownSkillForAgent(
          {
            name: 'wellknown-actual-name',
            description: 'A well-known skill',
            content: skillContent,
            installName: 'wellknown-different-name',
            sourceUrl: 'https://example.com/.well-known/skills/test/SKILL.md',
            providerId: 'well-known',
            sourceIdentifier: 'wellknown/example.com',
            files: new Map([['SKILL.md', skillContent]]),
            indexEntry: {
              name: 'wellknown-different-name',
              description: 'A well-known skill',
              files: ['SKILL.md'],
            },
          },
          'claude-code',
          { cwd: projectDir, mode: 'symlink', global: false }
        );

        expect(result.success).toBe(true);

        // Should use "wellknown-actual-name" (front-matter), not "wellknown-different-name"
        const correctPath = join(projectDir, '.agents/skills', 'wellknown-actual-name');
        await expect(access(correctPath)).resolves.toBeUndefined();

        const content = await readFile(join(correctPath, 'SKILL.md'), 'utf-8');
        expect(content).toContain('name: wellknown-actual-name');
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  });

  describe('installMintlifySkillForAgent', () => {
    it('uses front-matter name instead of mintlifySite for folder', async () => {
      const root = await mkdtemp(join(tmpdir(), 'add-skill-'));
      const projectDir = join(root, 'project');
      await mkdir(projectDir, { recursive: true });

      const skillContent =
        '---\nname: mintlify-actual-name\ndescription: A mintlify skill\n---\nContent';

      try {
        const result = await installMintlifySkillForAgent(
          {
            name: 'mintlify-actual-name',
            description: 'A mintlify skill',
            content: skillContent,
            mintlifySite: 'bun.com',
            sourceUrl: 'https://mintlify.com/bun.com/SKILL.md',
          },
          'claude-code',
          { cwd: projectDir, mode: 'symlink', global: false }
        );

        expect(result.success).toBe(true);

        // Should use "mintlify-actual-name" (front-matter), not "bun-com" (sanitized mintlifySite)
        const correctPath = join(projectDir, '.agents/skills', 'mintlify-actual-name');
        await expect(access(correctPath)).resolves.toBeUndefined();

        const content = await readFile(join(correctPath, 'SKILL.md'), 'utf-8');
        expect(content).toContain('name: mintlify-actual-name');
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  });
});
