import { describe, it, expect } from 'vitest';
import { parseSource } from './source-parser.js';

describe('source-parser', () => {
  describe('GitLab Custom Domains & Subgroups', () => {
    it('parses custom gitlab domain with deep subgroup paths', () => {
      const result = parseSource('https://git.corp.com/group/subgroup/project/-/tree/main/src');
      expect(result).toEqual({
        type: 'gitlab',
        url: 'https://git.corp.com/group/subgroup/project.git',
        ref: 'main',
        subpath: 'src',
      });
    });

    it('parses gitlab tree with branch but no path', () => {
      const result = parseSource('https://gitlab.example.com/org/repo/-/tree/v1.0');
      expect(result).toEqual({
        type: 'gitlab',
        url: 'https://gitlab.example.com/org/repo.git',
        ref: 'v1.0',
      });
    });

    it('parses custom gitlab domain with port number', () => {
      const result = parseSource('https://git.corp.com:8443/group/repo/-/tree/main');
      expect(result).toMatchObject({
        type: 'gitlab',
        url: 'https://git.corp.com:8443/group/repo.git',
        ref: 'main',
      });
    });

    it('parses http protocol (non-ssl)', () => {
      const result = parseSource('http://git.local/group/repo/-/tree/dev');
      expect(result).toMatchObject({
        type: 'gitlab',
        url: 'http://git.local/group/repo.git',
      });
    });

    it('parses personal project path (~user)', () => {
      const result = parseSource('https://gitlab.com/~user/project/-/tree/main');
      expect(result).toMatchObject({
        type: 'gitlab',
        url: 'https://gitlab.com/~user/project.git',
      });
    });
  });

  describe('Simplified Git Strategy', () => {
    it('treats custom domains with .git as generic git', () => {
      const result = parseSource('https://git.mycompany.com/my-group/my-repo.git');
      expect(result).toEqual({
        type: 'git',
        url: 'https://git.mycompany.com/my-group/my-repo.git',
      });
    });

    it('prevents false positives for generic URLs (falls through to well-known)', () => {
      const result = parseSource('https://google.com/search/result');
      expect(result.type).toBe('well-known');
      expect(result.url).toBe('https://google.com/search/result');
    });

    it('retains official gitlab.com parsing for convenience', () => {
      const result = parseSource('https://gitlab.com/owner/repo');
      expect(result).toEqual({
        type: 'gitlab',
        url: 'https://gitlab.com/owner/repo.git',
      });
    });
  });

  describe('Existing GitHub Support', () => {
    it('parses github shorthand', () => {
      const result = parseSource('vercel-labs/agent-skills');
      expect(result).toEqual({
        type: 'github',
        url: 'https://github.com/vercel-labs/agent-skills.git',
        subpath: undefined,
      });
    });

    it('parses github full URL', () => {
      const result = parseSource('https://github.com/owner/repo/tree/main/path');
      expect(result).toEqual({
        type: 'github',
        url: 'https://github.com/owner/repo.git',
        ref: 'main',
        subpath: 'path',
      });
    });
  });

  describe('Custom GitHub Enterprise URLs (*.github.com and github.*.*)', () => {
    it('parses shorthand without protocol: mycompany.github.com/org/repo', () => {
      const result = parseSource('mycompany.github.com/org/repo');
      expect(result).toEqual({
        type: 'github',
        url: 'https://mycompany.github.com/org/repo.git',
        ref: undefined,
        subpath: undefined,
      });
    });

    it('parses full URL: https://mycompany.github.com/org/repo', () => {
      const result = parseSource('https://mycompany.github.com/org/repo');
      expect(result).toEqual({
        type: 'github',
        url: 'https://mycompany.github.com/org/repo.git',
        ref: undefined,
        subpath: undefined,
      });
    });

    it('parses with tree/branch: mycompany.github.com/org/repo/tree/main', () => {
      const result = parseSource('mycompany.github.com/org/repo/tree/main');
      expect(result).toEqual({
        type: 'github',
        url: 'https://mycompany.github.com/org/repo.git',
        ref: 'main',
        subpath: undefined,
      });
    });

    it('parses with tree/branch/path: mycompany.github.com/org/repo/tree/main/skills', () => {
      const result = parseSource('mycompany.github.com/org/repo/tree/main/skills');
      expect(result).toEqual({
        type: 'github',
        url: 'https://mycompany.github.com/org/repo.git',
        ref: 'main',
        subpath: 'skills',
      });
    });

    it('parses with subpath (no tree): mycompany.github.com/org/repo/skills/my-skill', () => {
      const result = parseSource('mycompany.github.com/org/repo/skills/my-skill');
      expect(result).toEqual({
        type: 'github',
        url: 'https://mycompany.github.com/org/repo.git',
        subpath: 'skills/my-skill',
      });
    });

    it('parses with @skill syntax: mycompany.github.com/org/repo@my-skill', () => {
      const result = parseSource('mycompany.github.com/org/repo@my-skill');
      expect(result).toEqual({
        type: 'github',
        url: 'https://mycompany.github.com/org/repo.git',
        skillFilter: 'my-skill',
      });
    });

    it('parses with .git suffix: mycompany.github.com/org/repo.git', () => {
      const result = parseSource('mycompany.github.com/org/repo.git');
      expect(result).toEqual({
        type: 'github',
        url: 'https://mycompany.github.com/org/repo.git',
        ref: undefined,
        subpath: undefined,
      });
    });

    it('parses various subdomains: enterprise.github.com/team/project', () => {
      const result = parseSource('enterprise.github.com/team/project');
      expect(result).toEqual({
        type: 'github',
        url: 'https://enterprise.github.com/team/project.git',
        ref: undefined,
        subpath: undefined,
      });
    });

    it('does not match standard github.com as custom host', () => {
      // Standard github.com should still work via the existing github.com patterns
      const result = parseSource('github.com/owner/repo');
      expect(result).toEqual({
        type: 'github',
        url: 'https://github.com/owner/repo.git',
      });
    });

    // GitHub Enterprise Server format: github.COMPANY.com
    it('parses GHE Server URL: https://github.mycompany.com/org/repo', () => {
      const result = parseSource('https://github.mycompany.com/org/repo');
      expect(result).toEqual({
        type: 'github',
        url: 'https://github.mycompany.com/org/repo.git',
      });
    });

    it('parses GHE Server shorthand: github.mycompany.com/org/repo', () => {
      const result = parseSource('github.mycompany.com/org/repo');
      expect(result).toEqual({
        type: 'github',
        url: 'https://github.mycompany.com/org/repo.git',
      });
    });

    it('parses GHE Server with tree/branch/path: github.mycompany.com/org/repo/tree/main/skills', () => {
      const result = parseSource('https://github.mycompany.com/org/repo/tree/main/skills');
      expect(result).toEqual({
        type: 'github',
        url: 'https://github.mycompany.com/org/repo.git',
        ref: 'main',
        subpath: 'skills',
      });
    });

    it('parses GHE Server with @skill syntax: github.mycompany.com/org/repo@my-skill', () => {
      const result = parseSource('github.mycompany.com/org/repo@my-skill');
      expect(result).toEqual({
        type: 'github',
        url: 'https://github.mycompany.com/org/repo.git',
        skillFilter: 'my-skill',
      });
    });

    it('parses GHE Server with subpath: github.mycompany.com/org/repo/path/to/skill', () => {
      const result = parseSource('https://github.mycompany.com/org/repo/path/to/skill');
      expect(result).toEqual({
        type: 'github',
        url: 'https://github.mycompany.com/org/repo.git',
        subpath: 'path/to/skill',
      });
    });

    it('parses GHE Server with .git suffix: github.mycompany.com/org/repo.git', () => {
      const result = parseSource('github.mycompany.com/org/repo.git');
      expect(result).toEqual({
        type: 'github',
        url: 'https://github.mycompany.com/org/repo.git',
      });
    });

    it('parses GHE Server with different company domain: github.acme.com/team/project', () => {
      const result = parseSource('https://github.acme.com/team/project');
      expect(result).toEqual({
        type: 'github',
        url: 'https://github.acme.com/team/project.git',
      });
    });
  });
});
