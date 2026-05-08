import { describe, it, expect } from 'vitest';
import { parseSource, parseNpmSpec } from './source-parser.js';

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
  });

  describe('npm sources', () => {
    it('parses npm:<pkg> with no version', () => {
      const result = parseSource('npm:my-skills');
      expect(result).toEqual({
        type: 'npm',
        url: 'npm:my-skills',
        packageSpec: 'my-skills',
        packageName: 'my-skills',
      });
    });

    it('parses npm:<pkg>@<version>', () => {
      const result = parseSource('npm:my-skills@1.2.3');
      expect(result).toEqual({
        type: 'npm',
        url: 'npm:my-skills@1.2.3',
        packageSpec: 'my-skills@1.2.3',
        packageName: 'my-skills',
      });
    });

    it('parses npm:<pkg>@<range>', () => {
      const result = parseSource('npm:my-skills@^1.0.0');
      expect(result).toEqual({
        type: 'npm',
        url: 'npm:my-skills@^1.0.0',
        packageSpec: 'my-skills@^1.0.0',
        packageName: 'my-skills',
      });
    });

    it('parses npm:@scope/<pkg>', () => {
      const result = parseSource('npm:@scope/skills');
      expect(result).toEqual({
        type: 'npm',
        url: 'npm:@scope/skills',
        packageSpec: '@scope/skills',
        packageName: '@scope/skills',
      });
    });

    it('parses npm:@scope/<pkg>@<version>', () => {
      const result = parseSource('npm:@scope/skills@1.0.0');
      expect(result).toEqual({
        type: 'npm',
        url: 'npm:@scope/skills@1.0.0',
        packageSpec: '@scope/skills@1.0.0',
        packageName: '@scope/skills',
      });
    });

    it('parses npm:@scope/<pkg>@<range>', () => {
      const result = parseSource('npm:@scope/skills@^1.2');
      expect(result).toEqual({
        type: 'npm',
        url: 'npm:@scope/skills@^1.2',
        packageSpec: '@scope/skills@^1.2',
        packageName: '@scope/skills',
      });
    });

    it('does not set ref for npm sources', () => {
      const result = parseSource('npm:my-skills@1.2.3');
      expect(result.ref).toBeUndefined();
    });

    it('throws when scoped package is missing the package name', () => {
      // "@bad" is not a valid scoped name (needs a slash: @scope/name)
      expect(() => parseSource('npm:@bad')).toThrow(/Invalid npm spec/);
    });
  });

  describe('parseNpmSpec', () => {
    it('handles unscoped package without version', () => {
      expect(parseNpmSpec('foo')).toEqual({ packageName: 'foo' });
    });

    it('handles unscoped package with version', () => {
      expect(parseNpmSpec('foo@1.0.0')).toEqual({ packageName: 'foo', version: '1.0.0' });
    });

    it('handles scoped package without version', () => {
      expect(parseNpmSpec('@scope/foo')).toEqual({ packageName: '@scope/foo' });
    });

    it('handles scoped package with version', () => {
      expect(parseNpmSpec('@scope/foo@1.0.0')).toEqual({
        packageName: '@scope/foo',
        version: '1.0.0',
      });
    });

    it('handles version ranges', () => {
      expect(parseNpmSpec('foo@^1.2.3')).toEqual({ packageName: 'foo', version: '^1.2.3' });
      expect(parseNpmSpec('@scope/foo@~2.0')).toEqual({
        packageName: '@scope/foo',
        version: '~2.0',
      });
    });
  });
});
