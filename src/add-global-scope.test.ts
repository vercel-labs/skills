import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as p from '@clack/prompts';

vi.mock('@clack/prompts', () => ({
  intro: vi.fn(),
  outro: vi.fn(),
  note: vi.fn(),
  cancel: vi.fn(),
  confirm: vi.fn(),
  select: vi.fn(),
  isCancel: (value: unknown) => typeof value === 'symbol',
  spinner: () => ({ start: vi.fn(), stop: vi.fn() }),
  log: {
    info: vi.fn(),
    message: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('./agents.ts', async (importActual) => ({
  ...(await importActual<typeof import('./agents.ts')>()),
  detectInstalledAgents: vi.fn(),
}));
vi.mock('./detect-agent.ts', async (importActual) => ({
  ...(await importActual<typeof import('./detect-agent.ts')>()),
  detectAgent: vi.fn(),
}));
vi.mock('./installer.ts', async (importActual) => ({
  ...(await importActual<typeof import('./installer.ts')>()),
  installSkillForAgent: vi.fn(),
  installWellKnownSkillForAgent: vi.fn(),
  isSkillInstalled: vi.fn().mockResolvedValue(false),
}));
vi.mock('./skill-lock.ts', () => ({
  addSkillToLock: vi.fn(),
  getGitHubToken: vi.fn(),
  isPromptDismissed: vi.fn().mockResolvedValue(true),
  dismissPrompt: vi.fn(),
  getLastSelectedAgents: vi.fn(),
  saveSelectedAgents: vi.fn(),
}));
vi.mock('./telemetry.ts', () => ({
  track: vi.fn(),
  setVersion: vi.fn(),
  fetchAuditData: vi.fn().mockResolvedValue(null),
}));
vi.mock('./prompts/search-multiselect.ts', () => ({ searchMultiselect: vi.fn() }));

import { runAdd } from './add.ts';
import { detectInstalledAgents } from './agents.ts';
import { detectAgent } from './detect-agent.ts';
import { installSkillForAgent, installWellKnownSkillForAgent } from './installer.ts';
import { searchMultiselect } from './prompts/search-multiselect.ts';
import { wellKnownProvider } from './providers/index.ts';
import { stripAnsi } from './test-utils.ts';
import type { AgentType } from './types.ts';

describe.each(['local', 'well-known'] as const)('%s global scope selection', (sourceType) => {
  let testDir: string;
  let source: string;
  let originalCwd: string;

  const installer = sourceType === 'local' ? installSkillForAgent : installWellKnownSkillForAgent;
  const targets = () => vi.mocked(installer).mock.calls.map((call) => call[1]);
  const selectionLog = () =>
    vi
      .mocked(p.log.info)
      .mock.calls.map(([message]) => stripAnsi(message))
      .join('\n');

  beforeEach(async () => {
    vi.clearAllMocks();
    testDir = await mkdtemp(join(tmpdir(), 'skills-global-scope-'));
    const sourceDir = join(testDir, 'source');
    await mkdir(sourceDir);
    const content = '---\nname: scope-skill\ndescription: Scope regression\n---\n\n# Scope\n';
    await writeFile(join(sourceDir, 'SKILL.md'), content);
    const projectDir = join(testDir, 'project');
    await mkdir(projectDir);
    originalCwd = process.cwd();
    process.chdir(projectDir);
    source = sourceType === 'local' ? sourceDir : 'https://registry.example.com';

    vi.mocked(detectAgent).mockResolvedValue({ isAgent: false, agent: undefined });
    vi.mocked(detectInstalledAgents).mockResolvedValue([]);
    vi.mocked(searchMultiselect).mockResolvedValue(['codex', 'promptscript']);
    vi.mocked(p.select).mockResolvedValue(true);
    vi.mocked(p.confirm).mockResolvedValue(true);
    vi.mocked(installer).mockResolvedValue({
      success: true,
      path: join(testDir, 'installed'),
      canonicalPath: join(testDir, 'installed'),
      mode: 'copy',
    });
    vi.spyOn(wellKnownProvider, 'fetchAllSkills').mockResolvedValue([
      {
        name: 'scope-skill',
        installName: 'scope-skill',
        description: 'Scope regression',
        content,
        sourceUrl: 'https://registry.example.com/scope-skill/SKILL.md',
        files: new Map([['SKILL.md', content]]),
        indexEntry: { name: 'scope-skill', description: 'Scope regression', files: ['SKILL.md'] },
      },
    ]);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('Unexpected process.exit');
    }) as never);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    vi.restoreAllMocks();
    await rm(testDir, { recursive: true, force: true });
  });

  it('preserves manually selected targets when the user subsequently chooses Global', async () => {
    await runAdd([source], { copy: true });

    expect(searchMultiselect).toHaveBeenCalled();
    expect(p.select).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Installation scope' })
    );
    expect(targets()).toEqual(['codex', 'promptscript']);
    expect(installer).toHaveBeenCalledWith(
      expect.anything(),
      'promptscript',
      expect.objectContaining({ global: true })
    );
  });

  it('preserves manually selected targets when --global is already set', async () => {
    await runAdd([source], { global: true, copy: true });

    expect(targets()).toEqual(['codex', 'promptscript']);
  });

  it.each<AgentType[]>([['promptscript'], ['codex', 'promptscript'], ['eve']])(
    'logs actual implicit global targets when detecting %j',
    async (...detected) => {
      vi.mocked(detectInstalledAgents).mockResolvedValue(detected);

      await runAdd([source], { global: true, yes: true, copy: true });

      expect(targets()).toContain('codex');
      expect(targets()).not.toContain('promptscript');
      expect(targets()).not.toContain('eve');
      expect(selectionLog()).toContain('Installing to:');
      expect(selectionLog()).toContain('Codex');
      expect(selectionLog()).not.toContain('PromptScript');
      expect(selectionLog()).not.toContain('Eve');
    }
  );

  it('logs targets after an automatic selection is changed to Global', async () => {
    vi.mocked(detectInstalledAgents).mockResolvedValue(['promptscript']);

    await runAdd([source], { copy: true });

    expect(targets()).not.toContain('promptscript');
    expect(selectionLog()).toContain('Installing to:');
    expect(selectionLog()).not.toContain('PromptScript');
  });

  it('logs the actual wildcard count after the user chooses Global', async () => {
    await runAdd([source], { agent: ['*'], copy: true });

    expect(targets()).not.toContain('promptscript');
    expect(targets()).not.toContain('eve');
    expect(selectionLog()).toContain(`Installing to all ${targets().length} agents`);
  });

  it('keeps defaults populated by agent detection implicit', async () => {
    vi.mocked(detectAgent).mockResolvedValue({ isAgent: true, agent: { name: 'codex' } });

    await runAdd([source], { global: true, copy: true });

    expect(searchMultiselect).not.toHaveBeenCalled();
    expect(targets()).toContain('codex');
    expect(targets()).not.toContain('promptscript');
    expect(targets()).not.toContain('eve');
  });
});
