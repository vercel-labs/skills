import { afterEach, describe, it, expect, vi } from 'vitest';
import { parseSource } from './source-parser.js';

describe('source-parser', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

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

    it('prevents false positives for generic URLs (falls through to well-known handling)', () => {
      const result = parseSource('https://google.com/search/result');
      expect(result.type).toBe('well-known');
      expect(result.url).toBe('https://google.com/search/result');
    });

    it('treats raw GitHub files as direct downloads', () => {
      const url = 'https://raw.githubusercontent.com/owner/repo/main/SKILL.md';
      expect(parseSource(url)).toEqual({ type: 'download', url });
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

    it('does not treat GitHub blob anchors as refs', () => {
      const result = parseSource('https://github.com/owner/repo/blob/main/README.md#L10');
      expect(result).toEqual({
        type: 'github',
        url: 'https://github.com/owner/repo.git',
      });
    });

    it('parses github shorthand with #branch', () => {
      const result = parseSource('vercel-labs/agent-skills#feature/install');
      expect(result).toEqual({
        type: 'github',
        url: 'https://github.com/vercel-labs/agent-skills.git',
        ref: 'feature/install',
        subpath: undefined,
      });
    });

    it('parses github shorthand with trailing slash', () => {
      const result = parseSource('vercel-labs/agent-skills/');
      expect(result).toEqual({
        type: 'github',
        url: 'https://github.com/vercel-labs/agent-skills.git',
        subpath: undefined,
      });
    });

    it('parses SSH git URL with #branch', () => {
      const result = parseSource('git@github.com:owner/repo.git#feature/install');
      expect(result).toEqual({
        type: 'git',
        url: 'git@github.com:owner/repo.git',
        ref: 'feature/install',
      });
    });

    it('uses GH_HOST for shorthand GitHub Enterprise sources', () => {
      vi.stubEnv('GH_HOST', 'github.example.com');

      expect(parseSource('acme/agent-skills')).toEqual({
        type: 'git',
        url: 'https://github.example.com/acme/agent-skills.git',
        subpath: undefined,
      });
    });

    it('uses GH_HOST for github: prefixed sources', () => {
      vi.stubEnv('GH_HOST', 'github.example.com');

      expect(parseSource('github:acme/agent-skills@review')).toEqual({
        type: 'git',
        url: 'https://github.example.com/acme/agent-skills.git',
        skillFilter: 'review',
      });
    });

    it('parses explicit GitHub Enterprise tree URLs', () => {
      vi.stubEnv('GH_HOST', 'github.example.com');

      expect(
        parseSource('https://github.example.com/acme/agent-skills/tree/main/skills/review')
      ).toEqual({
        type: 'git',
        url: 'https://github.example.com/acme/agent-skills.git',
        ref: 'main',
        subpath: 'skills/review',
      });
    });

    it('does not override explicit github.com URLs with GH_HOST', () => {
      vi.stubEnv('GH_HOST', 'github.example.com');

      expect(parseSource('https://github.com/owner/repo')).toEqual({
        type: 'github',
        url: 'https://github.com/owner/repo.git',
      });
    });
  });

  describe('Bare Domain Well-Known Discovery', () => {
    it('routes a bare domain to the well-known provider over https', () => {
      const result = parseSource('openagreements.org');
      expect(result).toEqual({
        type: 'well-known',
        url: 'https://openagreements.org',
      });
    });

    it('routes a bare subdomain to well-known', () => {
      const result = parseSource('skills.example.com');
      expect(result).toEqual({
        type: 'well-known',
        url: 'https://skills.example.com',
      });
    });

    it('preserves a port on a bare domain', () => {
      const result = parseSource('skills.example.com:8443');
      expect(result).toEqual({
        type: 'well-known',
        url: 'https://skills.example.com:8443',
      });
    });

    it('routes a bare domain with a hyphenated label', () => {
      const result = parseSource('my-skills.example-host.com');
      expect(result).toEqual({
        type: 'well-known',
        url: 'https://my-skills.example-host.com',
      });
    });

    it('still parses owner/repo shorthand as github, not a bare domain', () => {
      const result = parseSource('vercel-labs/agent-skills');
      expect(result.type).toBe('github');
    });

    it('leaves a scheme-less .git target to the git fallback', () => {
      const result = parseSource('repo.git');
      expect(result.type).toBe('git');
    });

    it('leaves a single-label host (no dot) to the git fallback', () => {
      const result = parseSource('intranet');
      expect(result).toEqual({
        type: 'git',
        url: 'intranet',
      });
    });
  });
});
