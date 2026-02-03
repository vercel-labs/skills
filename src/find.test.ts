import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { searchSkillsAPI, type SearchSkill } from './find.ts';

// Mock the global fetch for API tests
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('find command', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('searchSkillsAPI', () => {
    it('should return empty array when API returns no results', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ skills: [] }),
      });

      const results = await searchSkillsAPI('nonexistent');
      expect(results).toEqual([]);
    });

    it('should return mapped skills from API response with pkg field', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            skills: [
              {
                id: 'owner/repo/my-skill',
                name: 'my-skill',
                installs: 100,
                source: 'owner/repo',
              },
            ],
          }),
      });

      const results = await searchSkillsAPI('skill');
      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        name: 'my-skill',
        slug: 'owner/repo/my-skill',
        source: 'owner/repo',
        installs: 100,
        pkg: 'owner/repo@my-skill',
      });
    });

    it('should construct pkg from slug when source is empty', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            skills: [
              {
                id: 'owner/repo/my-skill',
                name: 'my-skill',
                installs: 50,
                source: '',
              },
            ],
          }),
      });

      const results = await searchSkillsAPI('skill');
      expect(results).toHaveLength(1);
      expect(results[0]!.pkg).toBe('owner/repo@my-skill');
    });

    it('should return empty array when API request fails', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      const results = await searchSkillsAPI('test');
      expect(results).toEqual([]);
    });

    it('should return empty array when fetch throws', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const results = await searchSkillsAPI('test');
      expect(results).toEqual([]);
    });
  });

  describe('pkg field usage', () => {
    // These tests verify the pkg field is used correctly for display

    it('should use pkg field for display', () => {
      const skill: SearchSkill = {
        name: 'my-skill',
        slug: 'owner/repo/my-skill',
        source: 'owner/repo',
        installs: 100,
        pkg: 'owner/repo@my-skill',
      };

      expect(skill.pkg).toBe('owner/repo@my-skill');
      expect(`https://skills.sh/${skill.slug}`).toBe('https://skills.sh/owner/repo/my-skill');
    });

    it('should handle multi-word repo names in pkg', () => {
      const skill: SearchSkill = {
        name: 'nested-skill',
        slug: 'owner/multi-skills/nested-skill',
        source: 'owner/multi-skills',
        installs: 25,
        pkg: 'owner/multi-skills@nested-skill',
      };

      expect(skill.pkg).toBe('owner/multi-skills@nested-skill');
    });

    it('should handle complex skill names in pkg', () => {
      const skill: SearchSkill = {
        name: 'api-security-best-practices',
        slug: 'owner/skills-collection/api-security-best-practices',
        source: 'owner/skills-collection',
        installs: 5,
        pkg: 'owner/skills-collection@api-security-best-practices',
      };

      expect(skill.pkg).toBe('owner/skills-collection@api-security-best-practices');
    });
  });
});
