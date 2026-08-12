import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

vi.mock('@clack/prompts', () => {
  const noop = () => {};
  return {
    intro: noop,
    outro: noop,
    note: noop,
    cancel: noop,
    log: { info: noop, message: noop, warn: noop, error: noop, step: noop, success: noop },
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
  ensureUniversalAgents: vi.fn((agents: string[]) => agents),
}));

vi.mock('../src/source-parser.ts', async (importActual) => ({
  ...(await importActual<typeof import('../src/source-parser.ts')>()),
  isRepoPrivate: vi.fn().mockResolvedValue(false),
}));

vi.mock('../src/git.ts', async (importActual) => ({
  ...(await importActual<typeof import('../src/git.ts')>()),
  cloneRepo: vi.fn(),
  cleanupTempDir: vi.fn().mockResolvedValue(undefined),
}));

import { fetchSource, installFromSource, runAdd } from '../src/add.ts';
import { resetRepoTreeAuthState } from '../src/blob.ts';
import { cloneRepo } from '../src/git.ts';
import { parseSource } from '../src/source-parser.ts';
import { computeSkillFileHash, computeSkillFolderHash, readLocalLock } from '../src/local-lock.ts';
import { updateProjectSkills } from '../src/update.ts';

const SKILL_MD = '---\nname: example\ndescription: Example skill\n---\n# Example\n';

describe('blob project lock hashes', () => {
  let base: string;
  let repo: string;
  let originalCwd: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    resetRepoTreeAuthState();
    base = await mkdtemp(join(tmpdir(), 'blob-project-lock-'));
    repo = join(base, 'repo');
    const project = join(base, 'project');
    await mkdir(project);
    originalCwd = process.cwd();
    process.chdir(project);
    vi.stubEnv('DISABLE_TELEMETRY', '1');
    vi.stubEnv('XDG_STATE_HOME', join(base, 'state'));
    vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit called');
    }) as never);
    vi.mocked(cloneRepo).mockResolvedValue(repo);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    await rm(base, { recursive: true, force: true });
  });

  it.each([
    { command: 'add', skillPath: 'SKILL.md' },
    { command: 'restore', skillPath: 'SKILL.md' },
    { command: 'add', skillPath: 'skills/example/SKILL.md' },
    { command: 'restore', skillPath: 'skills/example/SKILL.md' },
  ])(
    'keeps $command blob installs at $skillPath unchanged on update',
    async ({ command, skillPath }) => {
      const rootSkill = skillPath === 'SKILL.md';
      const supportingPath = rootSkill ? 'docs/guide.md' : 'skills/example/references/guide.md';
      const files = [
        { path: 'SKILL.md', contents: SKILL_MD },
        { path: rootSkill ? supportingPath : 'references/guide.md', contents: '# Guide\n' },
      ];
      for (const [path, contents] of [
        [skillPath, SKILL_MD],
        [supportingPath, '# Guide\n'],
      ]) {
        await mkdir(dirname(join(repo, path!)), { recursive: true });
        await writeFile(join(repo, path!), contents!, 'utf-8');
      }

      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: string | URL) => {
          const url = String(input);
          if (url.includes('/git/trees/')) {
            return Response.json({
              sha: 'tree-sha',
              tree: [skillPath, supportingPath].map((path) => ({ path, type: 'blob', sha: path })),
            });
          }
          if (url.startsWith('https://raw.githubusercontent.com/')) return new Response(SKILL_MD);
          if (url.includes('/api/download/')) return Response.json({ hash: 'server-hash', files });
          throw new Error(`Unexpected request: ${url}`);
        })
      );

      if (command === 'add') {
        await runAdd(['vercel-labs/hash-fixture'], { yes: true, agent: ['codex'], global: false });
      } else {
        const fetched = await fetchSource({
          parsed: parseSource('vercel-labs/hash-fixture'),
          skills: ['example'],
        });
        const result = await installFromSource(fetched, {
          skills: ['example'],
          agents: ['codex'],
        });
        expect(result).toEqual({ installed: ['example'], failed: [] });
      }
      expect(cloneRepo).not.toHaveBeenCalled();

      const entry = (await readLocalLock()).skills.example!;
      expect(entry.skillPath).toBe(skillPath);
      expect(entry.computedHashScope).toBe(rootSkill ? 'skill-file' : undefined);
      expect(entry.computedHash).toBe(
        rootSkill
          ? await computeSkillFileHash(repo)
          : await computeSkillFolderHash(join(repo, 'skills/example'))
      );
      await expect(
        readFile(join(process.cwd(), '.agents/skills/example/SKILL.md'), 'utf-8')
      ).resolves.toBe(SKILL_MD);

      const upToDate = { successCount: 0, failCount: 0, foundCount: 1 };
      expect(await updateProjectSkills({ yes: true })).toEqual(upToDate);

      const changedPath = rootSkill ? skillPath : supportingPath;
      const changedContents = rootSkill ? SKILL_MD + '\nChanged\n' : '# Changed\n';
      await writeFile(join(repo, changedPath), changedContents);
      expect(await updateProjectSkills({ yes: true })).toEqual({
        successCount: 1,
        failCount: 0,
        foundCount: 1,
      });
      const installedChanged = rootSkill ? 'SKILL.md' : 'references/guide.md';
      await expect(
        readFile(join(process.cwd(), '.agents/skills/example', installedChanged), 'utf-8')
      ).resolves.toBe(changedContents);

      // The reinstall copied the cloned folder, so the lock now tracks that
      // folder and the next update finds nothing to do.
      const updated = (await readLocalLock()).skills.example!;
      expect(updated.computedHashScope).toBeUndefined();
      expect(await updateProjectSkills({ yes: true })).toEqual(upToDate);
    }
  );
});
