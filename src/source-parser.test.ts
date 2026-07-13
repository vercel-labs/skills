import { describe, it, expect } from 'vitest';
import { parseSource, getOwnerRepo } from './source-parser.js';

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

  describe('Azure DevOps', () => {
    it('parses a dev.azure.com URL with the org as user info', () => {
      const result = parseSource(
        'https://acme@dev.azure.com/acme/shared-resources/_git/skills-repo'
      );
      expect(result).toEqual({
        type: 'azure',
        url: 'https://acme@dev.azure.com/acme/shared-resources/_git/skills-repo',
      });
    });

    it('parses a dev.azure.com URL without user info', () => {
      const result = parseSource('https://dev.azure.com/myorg/myproject/_git/myrepo');
      expect(result).toEqual({
        type: 'azure',
        url: 'https://dev.azure.com/myorg/myproject/_git/myrepo',
      });
    });

    it('extracts branch (?version=GB…) and subpath (?path=…)', () => {
      const result = parseSource(
        'https://dev.azure.com/myorg/myproject/_git/myrepo?path=%2Fskills%2Ffoo&version=GBmain'
      );
      expect(result).toEqual({
        type: 'azure',
        url: 'https://dev.azure.com/myorg/myproject/_git/myrepo',
        ref: 'main',
        subpath: 'skills/foo',
      });
    });

    it('extracts a tag ref from ?version=GT…', () => {
      const result = parseSource(
        'https://dev.azure.com/myorg/myproject/_git/myrepo?version=GTv1.2.0'
      );
      expect(result).toMatchObject({
        type: 'azure',
        url: 'https://dev.azure.com/myorg/myproject/_git/myrepo',
        ref: 'v1.2.0',
      });
    });

    it('ignores a commit ref (?version=GC…) since it can not be shallow cloned', () => {
      const result = parseSource(
        'https://dev.azure.com/myorg/myproject/_git/myrepo?version=GCabc123'
      );
      expect(result).toEqual({
        type: 'azure',
        url: 'https://dev.azure.com/myorg/myproject/_git/myrepo',
      });
    });

    it('treats a #branch fragment as a ref', () => {
      const result = parseSource('https://dev.azure.com/myorg/myproject/_git/myrepo#develop');
      expect(result).toEqual({
        type: 'azure',
        url: 'https://dev.azure.com/myorg/myproject/_git/myrepo',
        ref: 'develop',
      });
    });

    it('parses a legacy visualstudio.com URL', () => {
      const result = parseSource('https://myaccount.visualstudio.com/myproject/_git/myrepo');
      expect(result).toEqual({
        type: 'azure',
        url: 'https://myaccount.visualstudio.com/myproject/_git/myrepo',
      });
    });

    it('parses the SSH v3 form', () => {
      const result = parseSource('git@ssh.dev.azure.com:v3/myorg/myproject/myrepo');
      expect(result).toEqual({
        type: 'azure',
        url: 'git@ssh.dev.azure.com:v3/myorg/myproject/myrepo',
      });
    });

    it('does not treat a non-_git dev.azure.com URL as a repo', () => {
      const result = parseSource('https://dev.azure.com/myorg/myproject/_build');
      expect(result.type).not.toBe('azure');
    });

    it('derives org/repo via getOwnerRepo', () => {
      const result = parseSource(
        'https://acme@dev.azure.com/acme/shared-resources/_git/skills-repo'
      );
      expect(getOwnerRepo(result)).toBe('acme/skills-repo');
    });
  });

  describe('--source-type override', () => {
    it('forces an unrecognized host to be cloned as a generic git URL', () => {
      const result = parseSource('https://git.internal.corp/team/repo', { sourceType: 'git' });
      expect(result).toEqual({
        type: 'git',
        url: 'https://git.internal.corp/team/repo',
      });
    });

    it('forces azure parsing and normalization', () => {
      const result = parseSource(
        'https://dev.azure.com/myorg/myproject/_git/myrepo?version=GBmain',
        { sourceType: 'azure' }
      );
      expect(result).toEqual({
        type: 'azure',
        url: 'https://dev.azure.com/myorg/myproject/_git/myrepo',
        ref: 'main',
      });
    });

    it('forces a github classification while reusing URL normalization', () => {
      const result = parseSource('https://github.com/owner/repo/tree/main/path', {
        sourceType: 'github',
      });
      expect(result).toEqual({
        type: 'github',
        url: 'https://github.com/owner/repo.git',
        ref: 'main',
        subpath: 'path',
      });
    });

    it('forces gitlab classification for an unrecognized host', () => {
      const result = parseSource('https://git.internal.corp/group/repo', {
        sourceType: 'gitlab',
      });
      expect(result).toEqual({
        type: 'gitlab',
        url: 'https://git.internal.corp/group/repo',
      });
    });

    it('carries a #ref fragment through a forced git source', () => {
      const result = parseSource('https://git.internal.corp/team/repo#release', {
        sourceType: 'git',
      });
      expect(result).toEqual({
        type: 'git',
        url: 'https://git.internal.corp/team/repo',
        ref: 'release',
      });
    });

    it('forces a well-known classification', () => {
      const result = parseSource('https://github.com/owner/repo', {
        sourceType: 'well-known',
      });
      expect(result).toEqual({
        type: 'well-known',
        url: 'https://github.com/owner/repo',
      });
    });
  });
});
