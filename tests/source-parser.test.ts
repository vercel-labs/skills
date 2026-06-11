/**
 * Unit tests for source-parser.ts
 *
 * These tests verify the URL parsing logic - they don't make network requests
 * or clone repositories. They ensure that given a URL string, the parser
 * correctly extracts type, url, ref (branch), and subpath.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'child_process';
import { mkdtempSync, rmSync } from 'fs';
import { platform, tmpdir } from 'os';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { parseSource, resolveAmbiguousTreeRef, getOwnerRepo } from '../src/source-parser.ts';
import type { ParsedSource } from '../src/types.ts';

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

describe('tree URL query strings', () => {
  it('strips ?ref_type=heads from a GitLab tree URL with branch only', () => {
    const result = parseSource('https://gitlab.com/owner/repo/-/tree/main?ref_type=heads');
    expect(result.type).toBe('gitlab');
    expect(result.url).toBe('https://gitlab.com/owner/repo.git');
    expect(result.ref).toBe('main');
    expect(result.subpath).toBeUndefined();
  });

  it('strips ?ref_type=heads from a GitLab tree URL with subpath', () => {
    const result = parseSource('https://gitlab.com/owner/repo/-/tree/main/skills?ref_type=heads');
    expect(result.type).toBe('gitlab');
    expect(result.ref).toBe('main');
    expect(result.subpath).toBe('skills');
  });

  it('strips query strings from GitHub tree URLs', () => {
    const result = parseSource('https://github.com/owner/repo/tree/main/skills?foo=bar');
    expect(result.type).toBe('github');
    expect(result.ref).toBe('main');
    expect(result.subpath).toBe('skills');
  });
});

describe('resolveAmbiguousTreeRef', () => {
  let fixtureDir: string;
  let fixtureUrl: string;

  function git(cwd: string, ...args: string[]): void {
    execFileSync('git', args, { cwd, stdio: 'pipe' });
  }

  // Build the parsed source for a tree URL, but point its repo URL at the
  // local fixture so ls-remote runs against file:// (zero network).
  function parsedForFixture(source: string): ParsedSource {
    return { ...parseSource(source), url: fixtureUrl };
  }

  beforeAll(() => {
    fixtureDir = mkdtempSync(join(tmpdir(), 'skills-tree-ref-fixture-'));
    fixtureUrl = pathToFileURL(fixtureDir).href;

    git(fixtureDir, 'init', '-b', 'main');
    git(
      fixtureDir,
      '-c',
      'user.email=test@example.com',
      '-c',
      'user.name=test',
      'commit',
      '--allow-empty',
      '-m',
      'init'
    );
    // Branch names containing slashes. Note git itself forbids a branch named
    // "bugfix" alongside "bugfix/x" (ref namespace conflict), so the ambiguous
    // shorter ref is a tag.
    git(fixtureDir, 'branch', 'bugfix/ABC-123-some-fix');
    git(fixtureDir, 'branch', 'bugfix/x');
    git(fixtureDir, 'tag', 'bugfix');
    git(fixtureDir, 'tag', 'release/1.0');
  });

  afterAll(() => {
    rmSync(fixtureDir, { recursive: true, force: true });
  });

  it('resolves a GitLab branch containing slashes plus a subpath', async () => {
    const source =
      'https://gitlab.example.com/group/repo/-/tree/bugfix/ABC-123-some-fix/libs/skills';
    const parsed = parsedForFixture(source);
    // Without resolution, the parser can only guess a single-segment ref.
    expect(parsed.ref).toBe('bugfix');

    const resolved = await resolveAmbiguousTreeRef(source, parsed);
    expect(resolved.ref).toBe('bugfix/ABC-123-some-fix');
    expect(resolved.subpath).toBe('libs/skills');
  });

  it('prefers the longest matching ref when both bugfix and bugfix/x exist', async () => {
    const source = 'https://gitlab.example.com/group/repo/-/tree/bugfix/x';
    const resolved = await resolveAmbiguousTreeRef(source, parsedForFixture(source));
    expect(resolved.ref).toBe('bugfix/x');
    expect(resolved.subpath).toBeUndefined();
  });

  it('falls back to the shorter ref when the longer prefix is not a ref', async () => {
    const source = 'https://gitlab.example.com/group/repo/-/tree/bugfix/docs';
    const resolved = await resolveAmbiguousTreeRef(source, parsedForFixture(source));
    expect(resolved.ref).toBe('bugfix');
    expect(resolved.subpath).toBe('docs');
  });

  it('resolves tag refs containing slashes', async () => {
    const source = 'https://gitlab.example.com/group/repo/-/tree/release/1.0/skills';
    const resolved = await resolveAmbiguousTreeRef(source, parsedForFixture(source));
    expect(resolved.ref).toBe('release/1.0');
    expect(resolved.subpath).toBe('skills');
  });

  it('resolves GitHub-style tree URLs', async () => {
    const source = 'https://github.com/owner/repo/tree/bugfix/ABC-123-some-fix/libs/skills';
    const resolved = await resolveAmbiguousTreeRef(source, parsedForFixture(source));
    expect(resolved.ref).toBe('bugfix/ABC-123-some-fix');
    expect(resolved.subpath).toBe('libs/skills');
  });

  it('decodes %2F in the tree portion before matching', async () => {
    const source =
      'https://gitlab.example.com/group/repo/-/tree/bugfix%2FABC-123-some-fix/libs/skills';
    const resolved = await resolveAmbiguousTreeRef(source, parsedForFixture(source));
    expect(resolved.ref).toBe('bugfix/ABC-123-some-fix');
    expect(resolved.subpath).toBe('libs/skills');
  });

  it('ignores query strings appended by the GitLab UI', async () => {
    const source =
      'https://gitlab.example.com/group/repo/-/tree/bugfix/ABC-123-some-fix/libs/skills?ref_type=heads';
    const resolved = await resolveAmbiguousTreeRef(source, parsedForFixture(source));
    expect(resolved.ref).toBe('bugfix/ABC-123-some-fix');
    expect(resolved.subpath).toBe('libs/skills');
  });

  it('keeps the single-segment parse when no ref matches', async () => {
    const source = 'https://gitlab.example.com/group/repo/-/tree/nope/nothing';
    const parsed = parsedForFixture(source);
    const resolved = await resolveAmbiguousTreeRef(source, parsed);
    expect(resolved).toBe(parsed);
    expect(resolved.ref).toBe('nope');
    expect(resolved.subpath).toBe('nothing');
  });

  it('keeps the single-segment parse when ls-remote fails', async () => {
    const source =
      'https://gitlab.example.com/group/repo/-/tree/bugfix/ABC-123-some-fix/libs/skills';
    const parsed: ParsedSource = {
      ...parseSource(source),
      url: pathToFileURL(join(tmpdir(), 'skills-no-such-repo')).href,
    };
    const resolved = await resolveAmbiguousTreeRef(source, parsed);
    expect(resolved).toBe(parsed);
    expect(resolved.ref).toBe('bugfix');
    expect(resolved.subpath).toBe('ABC-123-some-fix/libs/skills');
  });

  it('returns single-segment tree URLs unchanged without resolving', async () => {
    const source = 'https://gitlab.example.com/group/repo/-/tree/main';
    // The repo URL is intentionally unreachable: a single-segment tree URL
    // must short-circuit before any ls-remote happens.
    const parsed = parseSource(source);
    const resolved = await resolveAmbiguousTreeRef(source, parsed);
    expect(resolved).toBe(parsed);
    expect(resolved.ref).toBe('main');
  });

  it('returns non-tree sources unchanged without resolving', async () => {
    const source = 'owner/repo/skills/my-skill';
    const parsed = parseSource(source);
    const resolved = await resolveAmbiguousTreeRef(source, parsed);
    expect(resolved).toBe(parsed);
    expect(resolved.subpath).toBe('skills/my-skill');
  });
});
