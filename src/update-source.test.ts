import { describe, it, expect } from 'vitest';
import {
  buildUpdateInstallSource,
  buildLocalUpdateSource,
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
        sourceType: 'github',
        sourceUrl: 'https://github.com/owner/repo.git',
        ref: 'feature/install',
        skillPath: 'SKILL.md',
      });
      expect(result).toBe('owner/repo#feature/install');
    });

    it('builds nested skill install source with ref', () => {
      const result = buildUpdateInstallSource({
        source: 'owner/repo',
        sourceType: 'github',
        sourceUrl: 'https://github.com/owner/repo.git',
        ref: 'feature/install',
        skillPath: 'skills/my-skill/SKILL.md',
      });
      expect(result).toBe('owner/repo/skills/my-skill#feature/install');
    });

    it('falls back to sourceUrl when skillPath is missing', () => {
      const result = buildUpdateInstallSource({
        source: 'owner/repo',
        sourceType: 'github',
        sourceUrl: 'https://github.com/owner/repo.git',
        ref: 'feature/install',
      });
      expect(result).toBe('https://github.com/owner/repo.git#feature/install');
    });

    it('uses full sourceUrl for gitlab sources regardless of skillPath', () => {
      const result = buildUpdateInstallSource({
        source: 'group/repo',
        sourceType: 'gitlab',
        sourceUrl: 'https://gitlab.company.com/group/repo.git',
        ref: 'main',
        skillPath: 'skills/my-skill/SKILL.md',
      });
      expect(result).toBe('https://gitlab.company.com/group/repo.git#main');
    });

    it('uses full sourceUrl for generic git sources regardless of skillPath', () => {
      const result = buildUpdateInstallSource({
        source: 'group/repo',
        sourceType: 'git',
        sourceUrl: 'https://git.example.com/group/repo.git',
        skillPath: 'skills/my-skill/SKILL.md',
      });
      expect(result).toBe('https://git.example.com/group/repo.git');
    });
  });

  describe('buildLocalUpdateSource', () => {
    it('returns source with ref when no skillPath', () => {
      expect(buildLocalUpdateSource({ source: 'owner/repo', ref: 'main' })).toBe('owner/repo#main');
    });

    it('appends skillPath to github shorthand', () => {
      expect(
        buildLocalUpdateSource({
          source: 'owner/repo',
          ref: 'main',
          skillPath: 'skills/my-skill',
          sourceType: 'github',
        })
      ).toBe('owner/repo/skills/my-skill#main');
    });

    it('builds /-/tree/ URL for gitlab with skillPath and ref', () => {
      expect(
        buildLocalUpdateSource({
          source: 'https://gitlab.company.com/group/repo.git',
          ref: 'master',
          skillPath: '.agents/skills/my-skill',
          sourceType: 'gitlab',
        })
      ).toBe('https://gitlab.company.com/group/repo/-/tree/master/.agents/skills/my-skill');
    });

    it('falls back to repo root for gitlab with skillPath but no ref', () => {
      expect(
        buildLocalUpdateSource({
          source: 'https://gitlab.company.com/group/repo.git',
          skillPath: '.agents/skills/my-skill',
          sourceType: 'gitlab',
        })
      ).toBe('https://gitlab.company.com/group/repo.git');
    });
  });

});
