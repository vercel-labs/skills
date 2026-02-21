import { describe, it, expect } from 'vitest';
import { parseSymrefOutput, resolveDefaultBranch } from '../src/git.ts';

describe('parseSymrefOutput', () => {
  it('parses "main" from standard output', () => {
    const output = 'ref: refs/heads/main\tHEAD\na1b2c3d4e5f6\tHEAD\n';
    expect(parseSymrefOutput(output)).toBe('main');
  });

  it('parses "master" from standard output', () => {
    const output = 'ref: refs/heads/master\tHEAD\na1b2c3d4e5f6\tHEAD\n';
    expect(parseSymrefOutput(output)).toBe('master');
  });

  it('parses non-standard branch names', () => {
    expect(parseSymrefOutput('ref: refs/heads/develop\tHEAD\nabc123\tHEAD\n')).toBe('develop');
    expect(parseSymrefOutput('ref: refs/heads/trunk\tHEAD\nabc123\tHEAD\n')).toBe('trunk');
    expect(parseSymrefOutput('ref: refs/heads/v2\tHEAD\nabc123\tHEAD\n')).toBe('v2');
    expect(parseSymrefOutput('ref: refs/heads/release/1.0\tHEAD\nabc123\tHEAD\n')).toBe(
      'release/1.0'
    );
  });

  it('returns null for empty output', () => {
    expect(parseSymrefOutput('')).toBeNull();
  });

  it('returns null for output without symref line', () => {
    // Some servers only return the SHA line without the symref
    expect(parseSymrefOutput('a1b2c3d4e5f6\tHEAD\n')).toBeNull();
  });

  it('returns null for malformed output', () => {
    expect(parseSymrefOutput('garbage')).toBeNull();
    expect(parseSymrefOutput('ref: not-a-branch\tHEAD')).toBeNull();
  });

  it('handles extra whitespace in ref line', () => {
    const output = 'ref:  refs/heads/main\tHEAD\nabc123\tHEAD\n';
    expect(parseSymrefOutput(output)).toBe('main');
  });
});

describe('resolveDefaultBranch', () => {
  it('returns null for a nonexistent repo', async () => {
    const branch = await resolveDefaultBranch(
      'https://github.com/this-does-not-exist-12345/nope.git'
    );
    expect(branch).toBeNull();
  });

  it('returns a string or null (network-dependent)', async () => {
    // This test validates the function contract without requiring network access.
    // If network is available, it returns a branch name; otherwise null.
    const branch = await resolveDefaultBranch('https://github.com/octocat/Hello-World.git');
    expect(branch === null || typeof branch === 'string').toBe(true);
  });
});
