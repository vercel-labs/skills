import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseSymrefOutput } from '../src/git.ts';

const mockListRemote = vi.fn();

vi.mock('simple-git', () => ({
  default: vi.fn(() => ({
    env: vi.fn(() => ({ listRemote: mockListRemote })),
  })),
}));

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
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Dynamic import required because vi.mock is hoisted
  async function loadResolveDefaultBranch() {
    const { resolveDefaultBranch } = await import('../src/git.ts');
    return resolveDefaultBranch;
  }

  it('passes args to listRemote in correct order: --symref, url, HEAD', async () => {
    const resolveDefaultBranch = await loadResolveDefaultBranch();
    mockListRemote.mockResolvedValue('ref: refs/heads/main\tHEAD\nabc123\tHEAD\n');

    await resolveDefaultBranch('https://github.com/owner/repo.git');

    expect(mockListRemote).toHaveBeenCalledWith([
      '--symref',
      'https://github.com/owner/repo.git',
      'HEAD',
    ]);
  });

  it('returns parsed branch name from listRemote output', async () => {
    const resolveDefaultBranch = await loadResolveDefaultBranch();
    mockListRemote.mockResolvedValue('ref: refs/heads/develop\tHEAD\nabc123\tHEAD\n');

    const result = await resolveDefaultBranch('https://github.com/owner/repo.git');
    expect(result).toBe('develop');
  });

  it('returns null when listRemote throws', async () => {
    const resolveDefaultBranch = await loadResolveDefaultBranch();
    mockListRemote.mockRejectedValue(new Error('fatal: repository not found'));

    const result = await resolveDefaultBranch('https://github.com/bad/repo.git');
    expect(result).toBeNull();
  });

  it('returns null when output has no symref line', async () => {
    const resolveDefaultBranch = await loadResolveDefaultBranch();
    mockListRemote.mockResolvedValue('abc123\tHEAD\n');

    const result = await resolveDefaultBranch('https://github.com/owner/repo.git');
    expect(result).toBeNull();
  });
});
