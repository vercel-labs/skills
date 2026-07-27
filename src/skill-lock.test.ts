import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';

const { execSync } = vi.hoisted(() => ({ execSync: vi.fn() }));

vi.mock('child_process', () => ({ execSync }));

import { getGitHubToken, resetGhAuthWarning } from './skill-lock.ts';

describe('getGitHubToken', () => {
  const originalGitHubToken = process.env.GITHUB_TOKEN;
  const originalGhToken = process.env.GH_TOKEN;
  let stderrWrite: MockInstance<typeof process.stderr.write>;

  beforeEach(() => {
    delete process.env.GITHUB_TOKEN;
    delete process.env.GH_TOKEN;
    resetGhAuthWarning();
    execSync.mockReset().mockReturnValue('ghp_test_token\n');
    stderrWrite = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
  });

  afterEach(() => {
    stderrWrite.mockRestore();
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

  it('describes the gh fallback as an automatic status, not an instruction', () => {
    expect(getGitHubToken()).toBe('ghp_test_token');

    const status = stderrWrite.mock.calls.map(([message]) => String(message)).join('');
    expect(status).toContain('GitHub API request limit reached');
    expect(status).toContain('checking existing');
    expect(status).toContain('authentication…');
    expect(status).not.toContain('Tip:');
    expect(status).not.toContain('to continue');
  });
});
