import { describe, it, expect } from 'vitest';
import {
  buildLocalUpdateSource,
  buildUpdateInstallSource,
  formatSourceInput,
} from './update-source.ts';

describe('update-source', () => {
  describe('formatSourceInput', () => {
    it('appends ref fragment when provided', () => {
      expect(formatSourceInput('https://github.com/owner/repo.git', 'feature/install')).toBe(
        'https://github.com/owner/repo.git#feature/install'
      );
    });

    it('returns source unchanged when ref is missing', () => {
      expect(formatSourceInput('https://github.com/owner/repo.git')).toBe(
        'https://github.com/owner/repo.git'
      );
    });
  });

  describe('buildUpdateInstallSource', () => {
    it('builds root-level install source without trailing slash', () => {
      const result = buildUpdateInstallSource({
        source: 'owner/repo',
        sourceUrl: 'https://github.com/owner/repo.git',
        ref: 'feature/install',
        skillPath: 'SKILL.md',
      });
      expect(result).toBe('owner/repo#feature/install');
    });

    it('builds nested skill install source with ref', () => {
      const result = buildUpdateInstallSource({
        source: 'owner/repo',
        sourceUrl: 'https://github.com/owner/repo.git',
        ref: 'feature/install',
        skillPath: 'skills/my-skill/SKILL.md',
      });
      expect(result).toBe('owner/repo/skills/my-skill#feature/install');
    });

    it('falls back to sourceUrl when skillPath is missing', () => {
      const result = buildUpdateInstallSource({
        source: 'owner/repo',
        sourceUrl: 'https://github.com/owner/repo.git',
        ref: 'feature/install',
      });
      expect(result).toBe('https://github.com/owner/repo.git#feature/install');
    });
  });

  describe('buildLocalUpdateSource', () => {
    it('appends skill folder from skillPath with ref', () => {
      const result = buildLocalUpdateSource({
        source: 'owner/repo',
        ref: 'main',
        skillPath: 'skills/my-skill/SKILL.md',
      });
      expect(result).toBe('owner/repo/skills/my-skill#main');
    });

    it('appends skill folder from skillPath without ref', () => {
      const result = buildLocalUpdateSource({
        source: 'owner/repo',
        skillPath: 'skills/my-skill/SKILL.md',
      });
      expect(result).toBe('owner/repo/skills/my-skill');
    });

    it('keeps root-level skillPath from collapsing to trailing slash', () => {
      const result = buildLocalUpdateSource({
        source: 'owner/repo',
        skillPath: 'SKILL.md',
      });
      expect(result).toBe('owner/repo');
    });

    it('falls back to bare source when skillPath is missing', () => {
      const result = buildLocalUpdateSource({
        source: 'owner/repo',
        ref: 'main',
      });
      expect(result).toBe('owner/repo#main');
    });

    it('does not append skill folder for SSH sources (would produce unclonable URL)', () => {
      const result = buildLocalUpdateSource({
        source: 'git@gitea.example.com:owner/repo.git',
        skillPath: 'skills/my-skill/SKILL.md',
      });
      expect(result).toBe('git@gitea.example.com:owner/repo.git');
    });

    it('keeps ref on SSH sources even when skill folder is dropped', () => {
      const result = buildLocalUpdateSource({
        source: 'git@gitea.example.com:owner/repo.git',
        ref: 'main',
        skillPath: 'skills/my-skill/SKILL.md',
      });
      expect(result).toBe('git@gitea.example.com:owner/repo.git#main');
    });

    it('does not append skill folder for self-hosted HTTPS .git URLs', () => {
      const result = buildLocalUpdateSource({
        source: 'https://gitea.example.com/owner/repo.git',
        skillPath: 'skills/my-skill/SKILL.md',
      });
      expect(result).toBe('https://gitea.example.com/owner/repo.git');
    });

    it('appends skill folder for github.com HTTPS URLs', () => {
      const result = buildLocalUpdateSource({
        source: 'https://github.com/owner/repo',
        skillPath: 'skills/my-skill/SKILL.md',
      });
      expect(result).toBe('https://github.com/owner/repo/skills/my-skill');
    });
  });
});
