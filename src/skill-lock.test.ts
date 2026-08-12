import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getGitHubToken } from './skill-lock.ts';

describe('getGitHubToken', () => {
  const originalGitHubToken = process.env.GITHUB_TOKEN;
  const originalGhToken = process.env.GH_TOKEN;

  beforeEach(() => {
    delete process.env.GITHUB_TOKEN;
    delete process.env.GH_TOKEN;
  });

  afterEach(() => {
    if (originalGitHubToken === undefined) {
      delete process.env.GITHUB_TOKEN;
    } else {
      process.env.GITHUB_TOKEN = originalGitHubToken;
    }
    if (originalGhToken === undefined) {
      delete process.env.GH_TOKEN;
    } else {
      process.env.GH_TOKEN = originalGhToken;
    }
  });

  it('prefers an explicitly supplied GITHUB_TOKEN', () => {
    process.env.GITHUB_TOKEN = 'github-token';
    process.env.GH_TOKEN = 'gh-token';

    expect(getGitHubToken()).toBe('github-token');
  });

  it('uses an explicitly supplied GH_TOKEN', () => {
    process.env.GH_TOKEN = 'gh-token';

    expect(getGitHubToken()).toBe('gh-token');
  });

  it('does not extract credentials from external tools', () => {
    expect(getGitHubToken()).toBeNull();
  });
});
