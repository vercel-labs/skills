import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

vi.mock('../src/telemetry.ts', () => ({
  track: vi.fn(),
  setVersion: vi.fn(),
  setDetectedAgent: vi.fn(),
  fetchAuditData: vi.fn().mockResolvedValue(null),
}));

vi.mock('../src/detect-agent.ts', () => ({
  detectAgent: vi.fn().mockResolvedValue({ isAgent: false, agent: { name: 'none' } }),
  getAgentType: vi.fn(),
}));

// Simulate another process adding an entry right after sync reads the lock.
vi.mock('../src/local-lock.ts', async (importActual) => {
  const actual = await importActual<typeof import('../src/local-lock.ts')>();
  let injected = false;
  return {
    ...actual,
    readLocalLock: async (...args: Parameters<typeof actual.readLocalLock>) => {
      const lock = await actual.readLocalLock(...args);
      if (!injected) {
        injected = true;
        await actual.addSkillToLocalLock(
          'other',
          { source: 'org/other', sourceType: 'github', computedHash: 'hash-other' },
          args[0]
        );
      }
      return lock;
    },
  };
});

import { runSync } from '../src/sync.ts';

let project: string;
let originalCwd: string;

beforeEach(async () => {
  project = await mkdtemp(join(tmpdir(), 'sync-lock-race-'));
  await writeFile(join(project, 'package.json'), JSON.stringify({ name: 'test-project' }));
  await mkdir(join(project, '.agents', 'skills', 'gone'), { recursive: true });
  await writeFile(
    join(project, '.agents', 'skills', 'gone', 'SKILL.md'),
    '---\nname: gone\ndescription: Removed dependency\n---\n'
  );
  await writeFile(
    join(project, 'skills-lock.json'),
    JSON.stringify({
      version: 2,
      skills: { gone: { source: 'old-lib', sourceType: 'node_modules', computedHash: 'x' } },
    })
  );
  originalCwd = process.cwd();
  process.chdir(project);
});

afterEach(async () => {
  process.chdir(originalCwd);
  await rm(project, { recursive: true, force: true });
});

it('keeps lock entries added by another process while sync prunes', async () => {
  await runSync([], { yes: true, agent: ['claude-code'], frozenLockfile: false });

  const lock = JSON.parse(await readFile(join(project, 'skills-lock.json'), 'utf-8'));
  expect(lock.skills.gone).toBeUndefined();
  expect(lock.skills.other?.source).toBe('org/other');
});
