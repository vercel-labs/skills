import { beforeEach, describe, expect, it, vi } from 'vitest';

import { runInstallFromLock } from '../src/install.ts';
import * as add from '../src/add.ts';
import * as agents from '../src/agents.ts';
import * as localLock from '../src/local-lock.ts';

vi.mock('../src/add.ts');
vi.mock('../src/agents.ts');
vi.mock('../src/local-lock.ts');
vi.mock('../src/sync.ts');
vi.mock('@clack/prompts', () => ({
  log: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}));

describe('runInstallFromLock', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(agents.getUniversalAgents).mockReturnValue(['claude-code']);
  });

  it('restores project skills using sourceUrl and ref when available', async () => {
    vi.mocked(localLock.readLocalLock).mockResolvedValue({
      version: 1,
      skills: {
        'gitlab-skill': {
          source: 'org/repo',
          sourceUrl: 'https://gitlab.example.com/org/repo.git',
          ref: 'main',
          sourceType: 'gitlab',
          computedHash: 'abc',
        },
      },
    });

    await runInstallFromLock([]);

    expect(add.runAdd).toHaveBeenCalledWith(['https://gitlab.example.com/org/repo.git#main'], {
      skill: ['gitlab-skill'],
      agent: ['claude-code'],
      yes: true,
    });
  });

  it('falls back to source when sourceUrl is not available', async () => {
    vi.mocked(localLock.readLocalLock).mockResolvedValue({
      version: 1,
      skills: {
        'github-skill': {
          source: 'owner/repo',
          ref: 'v1',
          sourceType: 'github',
          computedHash: 'abc',
        },
      },
    });

    await runInstallFromLock([]);

    expect(add.runAdd).toHaveBeenCalledWith(['owner/repo#v1'], {
      skill: ['github-skill'],
      agent: ['claude-code'],
      yes: true,
    });
  });
});
