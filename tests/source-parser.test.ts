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

    it('GitHub URL - tree with branch only', () => {
      const result = parseSource('https://github.com/owner/repo/tree/feature-branch');
      expect(result.type).toBe('github');
      expect(result.url).toBe('https://github.com/owner/repo.git');
      expect(result.ref).toBe('feature-branch');
      expect(result.subpath).toBeUndefined();
    });

    it('GitHub URL - tree with branch and path', () => {
      const result = parseSource('https://github.com/owner/repo/tree/main/agents/my-agent');
      expect(result.type).toBe('github');
      expect(result.url).toBe('https://github.com/owner/repo.git');
      expect(result.ref).toBe('main');
      expect(result.subpath).toBe('agents/my-agent');
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
      const result = parseSource('https://gitlab.com/owner/repo/-/tree/main/src/agents');
      expect(result.type).toBe('gitlab');
      expect(result.url).toBe('https://gitlab.com/owner/repo.git');
      expect(result.ref).toBe('main');
      expect(result.subpath).toBe('src/agents');
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
      const result = parseSource('https://gitlab.com/coresofthq/ai/agent-agents');
      expect(result.type).toBe('gitlab');
      expect(result.url).toBe('https://gitlab.com/coresofthq/ai/agent-agents.git');
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
        'https://gitlab.com/group/subgroup/repo/-/tree/main/path/to/agent'
      );
      expect(result.type).toBe('gitlab');
      expect(result.url).toBe('https://gitlab.com/group/subgroup/repo.git');
      expect(result.ref).toBe('main');
      expect(result.subpath).toBe('path/to/agent');
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
      const result = parseSource('owner/repo/agents/my-agent');
      expect(result.type).toBe('github');
      expect(result.url).toBe('https://github.com/owner/repo.git');
      expect(result.subpath).toBe('agents/my-agent');
    });

    it('GitHub shorthand - owner/repo@agent (agent filter syntax)', () => {
      const result = parseSource('owner/repo@my-agent');
      expect(result.type).toBe('github');
      expect(result.url).toBe('https://github.com/owner/repo.git');
      expect(result.agentFilter).toBe('my-agent');
      expect(result.subpath).toBeUndefined();
    });

    it('GitHub shorthand - owner/repo@agent with hyphenated agent name', () => {
      const result = parseSource('vercel-labs/agent-agents@find-agents');
      expect(result.type).toBe('github');
      expect(result.url).toBe('https://github.com/vercel-labs/agent-agents.git');
      expect(result.agentFilter).toBe('find-agents');
    });
  });

  describe('Local path tests', () => {
    it('Local path - relative with ./', () => {
      const result = parseSource('./my-agents');
      expect(result.type).toBe('local');
      expect(result.localPath).toContain('my-agents');
    });

    it('Local path - relative with ../', () => {
      const result = parseSource('../other-agents');
      expect(result.type).toBe('local');
      expect(result.localPath).toContain('other-agents');
    });

    it('Local path - current directory', () => {
      const result = parseSource('.');
      expect(result.type).toBe('local');
      expect(result.localPath).toBeTruthy();
    });

    it('Local path - absolute path', () => {
      // Use platform-specific absolute path
      const testPath = isWindows ? 'C:\\Users\\test\\agents' : '/home/user/agents';
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

    it('Git URL - custom host', () => {
      const result = parseSource('https://git.example.com/owner/repo.git');
      expect(result.type).toBe('git');
      expect(result.url).toBe('https://git.example.com/owner/repo.git');
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
    const parsed = parseSource('https://github.com/owner/repo/tree/main/agents/my-agent');
    expect(getOwnerRepo(parsed)).toBe('owner/repo');
  });

  it('getOwnerRepo - GitHub shorthand', () => {
    const parsed = parseSource('owner/repo');
    expect(getOwnerRepo(parsed)).toBe('owner/repo');
  });

  it('getOwnerRepo - GitHub shorthand with subpath', () => {
    const parsed = parseSource('owner/repo/agents/my-agent');
    expect(getOwnerRepo(parsed)).toBe('owner/repo');
  });

  it('getOwnerRepo - GitLab URL', () => {
    const parsed = parseSource('https://gitlab.com/owner/repo');
    expect(getOwnerRepo(parsed)).toBe('owner/repo');
  });

  it('getOwnerRepo - GitLab URL with tree', () => {
    const parsed = parseSource('https://gitlab.com/owner/repo/-/tree/main/agents');
    expect(getOwnerRepo(parsed)).toBe('owner/repo');
  });

  it('getOwnerRepo - GitLab URL with subgroup', () => {
    const parsed = parseSource('https://gitlab.com/coresofthq/ai/agent-agents');
    expect(getOwnerRepo(parsed)).toBe('coresofthq/ai/agent-agents');
  });

  it('getOwnerRepo - local path returns null', () => {
    const parsed = parseSource('./my-agents');
    expect(getOwnerRepo(parsed)).toBeNull();
  });

  it('getOwnerRepo - absolute local path returns null', () => {
    const parsed = parseSource('/home/user/agents');
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
    const parsed = parseSource('https://git.internal.io/myteam/agents.git');
    expect(getOwnerRepo(parsed)).toBe('myteam/agents');
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

  it('getOwnerRepo - SSH URL without path (returns null)', () => {
    const parsed = { type: 'git', url: 'git@github.com:repo.git' } as const;
    expect(getOwnerRepo(parsed)).toBeNull();
  });
});

describe('Source aliases', () => {
  it('resolves coinbase/agentWallet to coinbase/agentic-wallet-agents', () => {
    const result = parseSource('coinbase/agentWallet');
    expect(result.type).toBe('github');
    expect(result.url).toBe('https://github.com/coinbase/agentic-wallet-agents.git');
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
      const result = parseSource('github:owner/repo/agents/my-agent');
      expect(result.type).toBe('github');
      expect(result.url).toBe('https://github.com/owner/repo.git');
      expect(result.subpath).toBe('agents/my-agent');
    });

    it('github:owner/repo@agent-name', () => {
      const result = parseSource('github:owner/repo@my-agent');
      expect(result.type).toBe('github');
      expect(result.url).toBe('https://github.com/owner/repo.git');
      expect(result.agentFilter).toBe('my-agent');
    });

    it('github:googleworkspace/cli', () => {
      const result = parseSource('github:googleworkspace/cli');
      expect(result.type).toBe('github');
      expect(result.url).toBe('https://github.com/googleworkspace/cli.git');
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
