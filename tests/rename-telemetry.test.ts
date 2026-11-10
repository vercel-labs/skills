import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// A --rename alias is a local name and must never reach skills.sh (audit or
// telemetry); only the name the public source uses may be sent.

vi.mock('@clack/prompts', () => {
  const noop = () => {};
  return {
    intro: noop,
    outro: noop,
    note: noop,
    confirm: vi.fn().mockResolvedValue(true),
    cancel: noop,
    log: {
      info: noop,
      message: noop,
      warn: noop,
      error: (...a: unknown[]) => console.log('[clack.error]', ...a),
      step: noop,
      success: noop,
    },
    spinner: () => ({ start: noop, stop: noop, message: noop }),
  };
});

vi.mock('../src/telemetry.ts', () => ({
  track: vi.fn(),
  setVersion: vi.fn(),
  fetchAuditData: vi.fn().mockResolvedValue(null),
}));

vi.mock('../src/detect-agent.ts', () => ({
  detectAgent: vi.fn().mockResolvedValue({ isAgent: false, agent: { name: 'none' } }),
  getAgentType: vi.fn(),
  ensureUniversalAgents: vi.fn((x: string[]) => x),
}));

vi.mock('../src/source-parser.ts', async (importActual) => ({
  ...(await importActual<typeof import('../src/source-parser.ts')>()),
  lookupGitHubRepo: vi.fn(),
}));

vi.mock('../src/git.ts', async (importActual) => ({
  ...(await importActual<typeof import('../src/git.ts')>()),
  cloneRepo: vi.fn(),
  cleanupTempDir: vi.fn().mockResolvedValue(undefined),
}));

import { runAdd } from '../src/add.ts';
import { removeCommand } from '../src/remove.ts';
import { cloneRepo } from '../src/git.ts';
import { fetchAuditData, track } from '../src/telemetry.ts';
import { lookupGitHubRepo } from '../src/source-parser.ts';

describe('--rename keeps the local alias out of audit and telemetry', () => {
  let base: string;
  let project: string;
  let origCwd: string;

  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), 'rename-telemetry-'));
    origCwd = process.cwd();
    vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit called');
    }) as never);

    const repo = join(base, 'repo');
    for (const name of ['alpha', 'gamma']) {
      await mkdir(join(repo, 'skills', name), { recursive: true });
      await writeFile(
        join(repo, 'skills', name, 'SKILL.md'),
        `---\nname: ${name}\ndescription: ${name}\n---\n`,
        'utf-8'
      );
    }
    vi.mocked(cloneRepo).mockResolvedValue(repo);
    // A public repo, so audit and telemetry are both sent.
    vi.mocked(lookupGitHubRepo).mockResolvedValue({ private: false, fullName: 'owner/repo' });

    project = join(base, 'project');
    await mkdir(project, { recursive: true });
    process.chdir(project);
  });

  afterEach(async () => {
    process.chdir(origCwd);
    await rm(base, { recursive: true, force: true });
    vi.restoreAllMocks();
    vi.mocked(track).mockClear();
    vi.mocked(fetchAuditData).mockClear();
  });

  const sentPayloads = () =>
    JSON.stringify([vi.mocked(track).mock.calls, vi.mocked(fetchAuditData).mock.calls]);

  it('sends the source name on add and remove', async () => {
    await runAdd(['owner/repo'], {
      yes: true,
      agent: ['codex'],
      skill: ['alpha'],
      rename: 'secret-alias',
    });

    const lock = JSON.parse(await readFile(join(project, 'skills-lock.json'), 'utf-8'));
    expect(lock.skills['secret-alias'].skillName).toBe('alpha');
    expect(fetchAuditData).toHaveBeenCalledWith('owner/repo', ['alpha']);
    expect(track).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'install',
        skills: 'alpha',
        skillFiles: JSON.stringify({ alpha: 'skills/alpha/SKILL.md' }),
      })
    );

    await removeCommand(['secret-alias'], { yes: true });

    expect(track).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'remove', source: 'owner/repo', skills: 'alpha' })
    );
    expect(sentPayloads()).not.toContain('secret-alias');
  });
});
