/**
 * Unit tests for source-parser.ts
 *
 * These tests verify the URL parsing logic - they don't make network requests
 * or clone repositories. They ensure that given a URL string, the parser
 * correctly extracts type, url, ref (branch), and subpath.
 */

import { describe, it, expect } from 'vitest';
import { platform } from 'os';
import { parseSource, getOwnerRepo } from '../src/source-parser.ts';

const isWindows = platform() === 'win32';

describe('parseSource', () => {
  describe('GitHub URL tests', () => {
    it('GitHub URL - basic repo', () => {
      const result = parseSource('https://github.com/owner/repo');
      expect(result.type).toBe('github');
      expect(result.url).toBe('https://github.com/owner/repo.git');
      expect(result.ref).toBeUndefined();
      expect(result.subpath).toBeUndefined();
    });

    it('GitHub URL - with .git suffix', () => {
      const result = parseSource('https://github.com/owner/repo.git');
      expect(result.type).toBe('github');
      expect(result.url).toBe('https://github.com/owner/repo.git');
    });

    it('GitHub URL - with .git suffix and #branch', () => {
      const result = parseSource('https://github.com/owner/repo.git#feature/install');
      expect(result.type).toBe('github');
      expect(result.url).toBe('https://github.com/owner/repo.git');
      expect(result.ref).toBe('feature/install');
    });

    it('GitHub blob URL anchor is not treated as a ref', () => {
      const result = parseSource('https://github.com/owner/repo/blob/main/README.md#L10');
      expect(result.type).toBe('github');
      expect(result.url).toBe('https://github.com/owner/repo.git');
      expect(result.ref).toBeUndefined();
    });

    it('GitHub URL - tree with branch only', () => {
      const result = parseSource('https://github.com/owner/repo/tree/feature-branch');
      expect(result.type).toBe('github');
      expect(result.url).toBe('https://github.com/owner/repo.git');
      expect(result.ref).toBe('feature-branch');
      expect(result.subpath).toBeUndefined();
    });

    it('GitHub URL - tree with branch and path', () => {
      const result = parseSource('https://github.com/owner/repo/tree/main/skills/my-skill');
      expect(result.type).toBe('github');
      expect(result.url).toBe('https://github.com/owner/repo.git');
      expect(result.ref).toBe('main');
      expect(result.subpath).toBe('skills/my-skill');
    });

    // Note: Branch names with slashes (e.g., feature/my-feature) are ambiguous.
    // The parser treats the first segment as branch and rest as path.
    // This matches GitHub's URL structure behavior.
    it('GitHub URL - tree with slash in path (ambiguous branch)', () => {
      const result = parseSource('https://github.com/owner/repo/tree/feature/my-feature');
      expect(result.type).toBe('github');
      expect(result.url).toBe('https://github.com/owner/repo.git');
      expect(result.ref).toBe('feature');
      expect(result.subpath).toBe('my-feature');
    });
  });

  describe('GitLab URL tests', () => {
    it('GitLab URL - basic repo', () => {
      const result = parseSource('https://gitlab.com/owner/repo');
      expect(result.type).toBe('gitlab');
      expect(result.url).toBe('https://gitlab.com/owner/repo.git');
      expect(result.ref).toBeUndefined();
    });

    it('GitLab URL - tree with branch only', () => {
      const result = parseSource('https://gitlab.com/owner/repo/-/tree/develop');
      expect(result.type).toBe('gitlab');
      expect(result.url).toBe('https://gitlab.com/owner/repo.git');
      expect(result.ref).toBe('develop');
      expect(result.subpath).toBeUndefined();
    });

    it('GitLab URL - tree with branch and path', () => {
      const result = parseSource('https://gitlab.com/owner/repo/-/tree/main/src/skills');
      expect(result.type).toBe('gitlab');
      expect(result.url).toBe('https://gitlab.com/owner/repo.git');
      expect(result.ref).toBe('main');
      expect(result.subpath).toBe('src/skills');
    });

    it('GitLab URL - with .git suffix', () => {
      const result = parseSource('https://gitlab.com/owner/repo.git');
      expect(result.type).toBe('gitlab');
      expect(result.url).toBe('https://gitlab.com/owner/repo.git');
    });

    it('GitLab URL - subgroup (2 levels)', () => {
      const result = parseSource('https://gitlab.com/group/subgroup/repo');
      expect(result.type).toBe('gitlab');
      expect(result.url).toBe('https://gitlab.com/group/subgroup/repo.git');
      expect(result.ref).toBeUndefined();
    });

    it('GitLab URL - subgroup (3 levels)', () => {
      const result = parseSource('https://gitlab.com/coresofthq/ai/agent-skills');
      expect(result.type).toBe('gitlab');
      expect(result.url).toBe('https://gitlab.com/coresofthq/ai/agent-skills.git');
      expect(result.ref).toBeUndefined();
    });

    it('GitLab URL - deep subgroup with .git suffix', () => {
      const result = parseSource('https://gitlab.com/org/team/project/repo.git');
      expect(result.type).toBe('gitlab');
      expect(result.url).toBe('https://gitlab.com/org/team/project/repo.git');
    });

    it('GitLab URL - subgroup with tree/branch', () => {
      const result = parseSource('https://gitlab.com/group/subgroup/repo/-/tree/main');
      expect(result.type).toBe('gitlab');
      expect(result.url).toBe('https://gitlab.com/group/subgroup/repo.git');
      expect(result.ref).toBe('main');
      expect(result.subpath).toBeUndefined();
    });

    it('GitLab URL - subgroup with tree/branch/path', () => {
      const result = parseSource(
        'https://gitlab.com/group/subgroup/repo/-/tree/main/path/to/skill'
      );
      expect(result.type).toBe('gitlab');
      expect(result.url).toBe('https://gitlab.com/group/subgroup/repo.git');
      expect(result.ref).toBe('main');
      expect(result.subpath).toBe('path/to/skill');
    });

    it('GitLab URL - trailing slash', () => {
      const result = parseSource('https://gitlab.com/group/subgroup/repo/');
      expect(result.type).toBe('gitlab');
      expect(result.url).toBe('https://gitlab.com/group/subgroup/repo.git');
    });
  });

  describe('GitHub shorthand tests', () => {
    it('GitHub shorthand - owner/repo', () => {
      const result = parseSource('owner/repo');
      expect(result.type).toBe('github');
      expect(result.url).toBe('https://github.com/owner/repo.git');
      expect(result.ref).toBeUndefined();
      expect(result.subpath).toBeUndefined();
    });

    it('GitHub shorthand - owner/repo/path', () => {
      const result = parseSource('owner/repo/skills/my-skill');
      expect(result.type).toBe('github');
      expect(result.url).toBe('https://github.com/owner/repo.git');
      expect(result.subpath).toBe('skills/my-skill');
    });

    it('GitHub shorthand - owner/repo/ trailing slash', () => {
      const result = parseSource('owner/repo/');
      expect(result.type).toBe('github');
      expect(result.url).toBe('https://github.com/owner/repo.git');
      expect(result.subpath).toBeUndefined();
    });

    it('GitHub shorthand - owner/repo@skill (skill filter syntax)', () => {
      const result = parseSource('owner/repo@my-skill');
      expect(result.type).toBe('github');
      expect(result.url).toBe('https://github.com/owner/repo.git');
      expect(result.skillFilter).toBe('my-skill');
      expect(result.subpath).toBeUndefined();
    });

    it('GitHub shorthand - owner/repo@skill with hyphenated skill name', () => {
      const result = parseSource('vercel-labs/agent-skills@find-skills');
      expect(result.type).toBe('github');
      expect(result.url).toBe('https://github.com/vercel-labs/agent-skills.git');
      expect(result.skillFilter).toBe('find-skills');
    });

    it('GitHub shorthand - owner/repo#branch', () => {
      const result = parseSource('owner/repo#my-branch');
      expect(result.type).toBe('github');
      expect(result.url).toBe('https://github.com/owner/repo.git');
      expect(result.ref).toBe('my-branch');
      expect(result.subpath).toBeUndefined();
    });

    it('GitHub shorthand - owner/repo/path#branch', () => {
      const result = parseSource('owner/repo/skills/my-skill#feature/skills');
      expect(result.type).toBe('github');
      expect(result.url).toBe('https://github.com/owner/repo.git');
      expect(result.ref).toBe('feature/skills');
      expect(result.subpath).toBe('skills/my-skill');
    });

    it('GitHub shorthand - owner/repo#branch@skill', () => {
      const result = parseSource('owner/repo#my-branch@my-skill');
      expect(result.type).toBe('github');
      expect(result.url).toBe('https://github.com/owner/repo.git');
      expect(result.ref).toBe('my-branch');
      expect(result.skillFilter).toBe('my-skill');
    });
  });

  describe('skills pack shorthand tests', () => {
    it('skills.sh/p/<id> parses as a well-known source', () => {
      const result = parseSource('skills.sh/p/frontend-pack-A1b2C3d4');
      expect(result.type).toBe('well-known');
      expect(result.url).toBe('https://skills.sh/p/frontend-pack-A1b2C3d4');
    });

    it('www.skills.sh/p/<id> parses as a canonical well-known source', () => {
      const result = parseSource('www.skills.sh/p/frontend_pack-A1b2C3d4/');
      expect(result.type).toBe('well-known');
      expect(result.url).toBe('https://skills.sh/p/frontend_pack-A1b2C3d4');
    });

    it('pack:<id> parses as a skills.sh pack well-known source', () => {
      const result = parseSource('pack:frontend-pack-A1b2C3d4');
      expect(result.type).toBe('well-known');
      expect(result.url).toBe('https://skills.sh/p/frontend-pack-A1b2C3d4');
    });

    it('https://skills.sh/p/<id> remains a well-known source', () => {
      const result = parseSource('https://skills.sh/p/frontend-pack-A1b2C3d4');
      expect(result.type).toBe('well-known');
      expect(result.url).toBe('https://skills.sh/p/frontend-pack-A1b2C3d4');
    });

    it('rejects invalid pack ids', () => {
      expect(() => parseSource('pack:')).toThrow('Invalid skills pack id');
      expect(() => parseSource('pack:../secret')).toThrow('Invalid skills pack id');
      expect(() => parseSource('skills.sh/p/')).toThrow('Invalid skills pack source');
      expect(() => parseSource('skills.sh/p/frontend-pack/extra')).toThrow(
        'Invalid skills pack source'
      );
    });
  });

  describe('Local path tests', () => {
    it('Local path - relative with ./', () => {
      const result = parseSource('./my-skills');
      expect(result.type).toBe('local');
      expect(result.localPath).toContain('my-skills');
    });

    it('Local path - relative with ../', () => {
      const result = parseSource('../other-skills');
      expect(result.type).toBe('local');
      expect(result.localPath).toContain('other-skills');
    });

    it('Local path - current directory', () => {
      const result = parseSource('.');
      expect(result.type).toBe('local');
      expect(result.localPath).toBeTruthy();
    });

    it('Local path - absolute path', () => {
      // Use platform-specific absolute path
      const testPath = isWindows ? 'C:\\Users\\test\\skills' : '/home/user/skills';
      const result = parseSource(testPath);
      expect(result.type).toBe('local');
      expect(result.localPath).toBe(testPath);
    });
  });

  describe('Git URL fallback tests', () => {
    it('Git URL - SSH format', () => {
      const result = parseSource('git@github.com:owner/repo.git');
      expect(result.type).toBe('git');
      expect(result.url).toBe('git@github.com:owner/repo.git');
    });

    it('Git URL - SSH format with #branch', () => {
      const result = parseSource('git@github.com:owner/repo.git#feature/install');
      expect(result.type).toBe('git');
      expect(result.url).toBe('git@github.com:owner/repo.git');
      expect(result.ref).toBe('feature/install');
    });

    it('Git URL - custom host', () => {
      const result = parseSource('https://git.example.com/owner/repo.git');
      expect(result.type).toBe('git');
      expect(result.url).toBe('https://git.example.com/owner/repo.git');
    });

    it('Git URL - https format with #branch', () => {
      const result = parseSource('https://git.example.com/owner/repo.git#release-2026');
      expect(result.type).toBe('git');
      expect(result.url).toBe('https://git.example.com/owner/repo.git');
      expect(result.ref).toBe('release-2026');
    });

    it('Git URL - ssh scheme with #branch', () => {
      const result = parseSource('ssh://git@git.example.com:7999/owner/repo.git#release-2026');
      expect(result.type).toBe('git');
      expect(result.url).toBe('ssh://git@git.example.com:7999/owner/repo.git');
      expect(result.ref).toBe('release-2026');
    });
  });
});

describe('getOwnerRepo', () => {
  it('getOwnerRepo - GitHub URL', () => {
    const parsed = parseSource('https://github.com/owner/repo');
    expect(getOwnerRepo(parsed)).toBe('owner/repo');
  });

  it('getOwnerRepo - GitHub URL with .git', () => {
    const parsed = parseSource('https://github.com/owner/repo.git');
    expect(getOwnerRepo(parsed)).toBe('owner/repo');
  });

  it('getOwnerRepo - GitHub URL with tree/branch/path', () => {
    const parsed = parseSource('https://github.com/owner/repo/tree/main/skills/my-skill');
    expect(getOwnerRepo(parsed)).toBe('owner/repo');
  });

  it('getOwnerRepo - GitHub shorthand', () => {
    const parsed = parseSource('owner/repo');
    expect(getOwnerRepo(parsed)).toBe('owner/repo');
  });

  it('getOwnerRepo - GitHub shorthand with subpath', () => {
    const parsed = parseSource('owner/repo/skills/my-skill');
    expect(getOwnerRepo(parsed)).toBe('owner/repo');
  });

  it('getOwnerRepo - GitLab URL', () => {
    const parsed = parseSource('https://gitlab.com/owner/repo');
    expect(getOwnerRepo(parsed)).toBe('owner/repo');
  });

  it('getOwnerRepo - GitLab URL with tree', () => {
    const parsed = parseSource('https://gitlab.com/owner/repo/-/tree/main/skills');
    expect(getOwnerRepo(parsed)).toBe('owner/repo');
  });

  it('getOwnerRepo - GitLab URL with subgroup', () => {
    const parsed = parseSource('https://gitlab.com/coresofthq/ai/agent-skills');
    expect(getOwnerRepo(parsed)).toBe('coresofthq/ai/agent-skills');
  });

  it('getOwnerRepo - local path returns null', () => {
    const parsed = parseSource('./my-skills');
    expect(getOwnerRepo(parsed)).toBeNull();
  });

  it('getOwnerRepo - skills pack shorthand returns null', () => {
    const parsed = parseSource('skills.sh/p/frontend-pack-A1b2C3d4');
    expect(getOwnerRepo(parsed)).toBeNull();
  });

  it('getOwnerRepo - skills.sh pack URL returns null', () => {
    const parsed = parseSource('https://www.skills.sh/p/frontend-pack-A1b2C3d4');
    expect(getOwnerRepo(parsed)).toBeNull();
  });

  it('getOwnerRepo - absolute local path returns null', () => {
    const parsed = parseSource('/home/user/skills');
    expect(getOwnerRepo(parsed)).toBeNull();
  });

  it('getOwnerRepo - custom git host extracts owner/repo', () => {
    const parsed = parseSource('https://git.example.com/owner/repo.git');
    expect(getOwnerRepo(parsed)).toBe('owner/repo');
  });

  it('getOwnerRepo - SSH format extracts owner/repo', () => {
    const parsed = parseSource('git@github.com:owner/repo.git');
    expect(getOwnerRepo(parsed)).toBe('owner/repo');
  });

  it('getOwnerRepo - private GitLab instance extracts owner/repo', () => {
    const parsed = parseSource('https://gitlab.company.com/team/repo');
    expect(getOwnerRepo(parsed)).toBe('team/repo');
  });

  it('getOwnerRepo - self-hosted git with .git suffix', () => {
    const parsed = parseSource('https://git.internal.io/myteam/skills.git');
    expect(getOwnerRepo(parsed)).toBe('myteam/skills');
  });

  it('getOwnerRepo - URL with query string', () => {
    const parsed = { type: 'git', url: 'https://git.example.com/owner/repo?ref=main' } as const;
    expect(getOwnerRepo(parsed)).toBe('owner/repo');
  });

  it('getOwnerRepo - URL with fragment', () => {
    const parsed = { type: 'git', url: 'https://git.example.com/owner/repo#readme' } as const;
    expect(getOwnerRepo(parsed)).toBe('owner/repo');
  });

  it('getOwnerRepo - URL with .git and query string', () => {
    const parsed = { type: 'git', url: 'https://git.example.com/owner/repo.git?ref=main' } as const;
    expect(getOwnerRepo(parsed)).toBe('owner/repo');
  });

  it('getOwnerRepo - GitLab subgroup (2 levels)', () => {
    const parsed = { type: 'git', url: 'https://gitlab.com/group/subgroup/repo' } as const;
    expect(getOwnerRepo(parsed)).toBe('group/subgroup/repo');
  });

  it('getOwnerRepo - GitLab subgroup (3 levels)', () => {
    const parsed = { type: 'git', url: 'https://gitlab.com/org/team/project/repo.git' } as const;
    expect(getOwnerRepo(parsed)).toBe('org/team/project/repo');
  });

  it('getOwnerRepo - GitLab subgroup with query string', () => {
    const parsed = { type: 'git', url: 'https://gitlab.com/group/subgroup/repo?ref=main' } as const;
    expect(getOwnerRepo(parsed)).toBe('group/subgroup/repo');
  });

  it('getOwnerRepo - self-hosted GitLab with subgroups', () => {
    const parsed = {
      type: 'git',
      url: 'https://gitlab.company.com/division/team/repo.git',
    } as const;
    expect(getOwnerRepo(parsed)).toBe('division/team/repo');
  });

  it('getOwnerRepo - SSH URL (GitHub)', () => {
    const parsed = { type: 'git', url: 'git@github.com:owner/repo.git' } as const;
    expect(getOwnerRepo(parsed)).toBe('owner/repo');
  });

  it('getOwnerRepo - SSH URL (GitLab)', () => {
    const parsed = { type: 'git', url: 'git@gitlab.com:owner/repo.git' } as const;
    expect(getOwnerRepo(parsed)).toBe('owner/repo');
  });

  it('getOwnerRepo - SSH URL with subgroups (GitLab)', () => {
    const parsed = {
      type: 'git',
      url: 'git@gitlab.com:group/subgroup/project/repo.git',
    } as const;
    expect(getOwnerRepo(parsed)).toBe('group/subgroup/project/repo');
  });

  it('getOwnerRepo - SSH URL without .git suffix', () => {
    const parsed = { type: 'git', url: 'git@github.com:owner/repo' } as const;
    expect(getOwnerRepo(parsed)).toBe('owner/repo');
  });

  it('getOwnerRepo - SSH URL (custom host)', () => {
    const parsed = { type: 'git', url: 'git@git.company.com:org/team/repo.git' } as const;
    expect(getOwnerRepo(parsed)).toBe('org/team/repo');
  });

  it('getOwnerRepo - SSH URL with scheme and port', () => {
    const parsed = {
      type: 'git',
      url: 'ssh://git@git.company.com:7999/org/team/repo.git',
    } as const;
    expect(getOwnerRepo(parsed)).toBe('org/team/repo');
  });

  it('getOwnerRepo - SSH URL without path (returns null)', () => {
    const parsed = { type: 'git', url: 'git@github.com:repo.git' } as const;
    expect(getOwnerRepo(parsed)).toBeNull();
  });
});

describe('Source aliases', () => {
  it('resolves coinbase/agentWallet to coinbase/agentic-wallet-skills', () => {
    const result = parseSource('coinbase/agentWallet');
    expect(result.type).toBe('github');
    expect(result.url).toBe('https://github.com/coinbase/agentic-wallet-skills.git');
  });
});

describe('Prefix shorthand tests', () => {
  describe('github: prefix', () => {
    it('github:owner/repo - basic', () => {
      const result = parseSource('github:owner/repo');
      expect(result.type).toBe('github');
      expect(result.url).toBe('https://github.com/owner/repo.git');
      expect(result.subpath).toBeUndefined();
    });

    it('github:owner/repo/subpath', () => {
      const result = parseSource('github:owner/repo/skills/my-skill');
      expect(result.type).toBe('github');
      expect(result.url).toBe('https://github.com/owner/repo.git');
      expect(result.subpath).toBe('skills/my-skill');
    });

    it('github:owner/repo@skill-name', () => {
      const result = parseSource('github:owner/repo@my-skill');
      expect(result.type).toBe('github');
      expect(result.url).toBe('https://github.com/owner/repo.git');
      expect(result.skillFilter).toBe('my-skill');
    });

    it('github:googleworkspace/cli', () => {
      const result = parseSource('github:googleworkspace/cli');
      expect(result.type).toBe('github');
      expect(result.url).toBe('https://github.com/googleworkspace/cli.git');
    });

    it('github:owner/repo#branch', () => {
      const result = parseSource('github:owner/repo#feature/install');
      expect(result.type).toBe('github');
      expect(result.url).toBe('https://github.com/owner/repo.git');
      expect(result.ref).toBe('feature/install');
    });
  });

  describe('gitlab: prefix', () => {
    it('gitlab:owner/repo - basic', () => {
      const result = parseSource('gitlab:owner/repo');
      expect(result.type).toBe('gitlab');
      expect(result.url).toBe('https://gitlab.com/owner/repo.git');
    });

    it('gitlab:group/subgroup/repo', () => {
      const result = parseSource('gitlab:group/subgroup/repo');
      expect(result.type).toBe('gitlab');
      expect(result.url).toBe('https://gitlab.com/group/subgroup/repo.git');
    });
  });
});
