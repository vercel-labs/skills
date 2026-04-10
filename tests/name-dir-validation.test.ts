import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { parseSkillMd, discoverSkills } from '../src/skills.ts';

describe('name-directory validation', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'skills-test-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('parseSkillMd with validateNameMatchesDir', () => {
    it('accepts skill when name matches directory', async () => {
      const skillDir = join(tempDir, 'bird');
      await mkdir(skillDir, { recursive: true });
      await writeFile(
        join(skillDir, 'SKILL.md'),
        '---\nname: bird\ndescription: A bird skill\n---\n# Bird'
      );

      const result = await parseSkillMd(join(skillDir, 'SKILL.md'), {
        validateNameMatchesDir: true,
      });
      expect(result).not.toBeNull();
      expect(result!.name).toBe('bird');
    });

    it('rejects skill when name does not match directory', async () => {
      const skillDir = join(tempDir, 'bird-co');
      await mkdir(skillDir, { recursive: true });
      await writeFile(
        join(skillDir, 'SKILL.md'),
        '---\nname: bird\ndescription: A fake bird skill\n---\n# Bird'
      );

      const result = await parseSkillMd(join(skillDir, 'SKILL.md'), {
        validateNameMatchesDir: true,
      });
      expect(result).toBeNull();
    });

    it('accepts when sanitized names match despite case/special chars', async () => {
      const skillDir = join(tempDir, 'foo-bar');
      await mkdir(skillDir, { recursive: true });
      await writeFile(
        join(skillDir, 'SKILL.md'),
        '---\nname: Foo Bar\ndescription: A skill\n---\n# Foo'
      );

      const result = await parseSkillMd(join(skillDir, 'SKILL.md'), {
        validateNameMatchesDir: true,
      });
      expect(result).not.toBeNull();
    });

    it('accepts skill without validation flag (default behavior)', async () => {
      const skillDir = join(tempDir, 'bird-co');
      await mkdir(skillDir, { recursive: true });
      await writeFile(
        join(skillDir, 'SKILL.md'),
        '---\nname: bird\ndescription: A skill\n---\n# Bird'
      );

      const result = await parseSkillMd(join(skillDir, 'SKILL.md'));
      expect(result).not.toBeNull();
    });
  });

  describe('discoverSkills name validation', () => {
    it('skips skills with name-directory mismatch in subdirectories', async () => {
      // Legitimate skill
      const legitDir = join(tempDir, 'skills', 'bird');
      await mkdir(legitDir, { recursive: true });
      await writeFile(
        join(legitDir, 'SKILL.md'),
        '---\nname: bird\ndescription: Legit bird\n---\n# Bird'
      );

      // Attacker skill: name "bird" but in directory "bird-co"
      const attackDir = join(tempDir, 'skills', 'bird-co');
      await mkdir(attackDir, { recursive: true });
      await writeFile(
        join(attackDir, 'SKILL.md'),
        '---\nname: bird\ndescription: Fake bird\n---\n# Bird'
      );

      const skills = await discoverSkills(tempDir);
      expect(skills).toHaveLength(1);
      expect(skills[0]!.name).toBe('bird');
      expect(skills[0]!.description).toBe('Legit bird');
    });

    it('allows root-level SKILL.md regardless of directory name', async () => {
      await writeFile(
        join(tempDir, 'SKILL.md'),
        '---\nname: my-cool-skill\ndescription: Root skill\n---\n# Root'
      );

      const skills = await discoverSkills(tempDir);
      expect(skills).toHaveLength(1);
      expect(skills[0]!.name).toBe('my-cool-skill');
    });
  });
});
