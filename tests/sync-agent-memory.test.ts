import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

vi.mock('@clack/prompts', () => {
  const noop = () => {};
  return {
    intro: noop,
    outro: noop,
    note: noop,
    confirm: vi.fn().mockResolvedValue(true),
    cancel: noop,
    isCancel: () => false,
    log: { info: noop, message: noop, warn: noop, error: noop, step: noop, success: noop },
    spinner: () => ({ start: noop, stop: noop, message: noop }),
  };
});

vi.mock('../src/telemetry.ts', () => ({ track: vi.fn(), setVersion: vi.fn() }));

vi.mock('../src/detect-agent.ts', () => ({
  detectAgent: vi.fn().mockResolvedValue({ isAgent: false, agent: { name: 'none' } }),
  getAgentType: vi.fn(),
}));

vi.mock('../src/prompts/search-multiselect.ts', () => ({ searchMultiselect: vi.fn() }));

import { runSync } from '../src/sync.ts';
import * as agentsModule from '../src/agents.ts';
import { searchMultiselect } from '../src/prompts/search-multiselect.ts';
import { getLastSelectedAgents, saveSelectedAgents } from '../src/skill-lock.ts';

describe('experimental_sync agent selection', () => {
  let project: string;
  let state: string;
  let originalCwd: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    project = await mkdtemp(join(tmpdir(), 'sync-agents-'));
    state = await mkdtemp(join(tmpdir(), 'sync-agents-state-'));
    vi.stubEnv('XDG_STATE_HOME', state);
    originalCwd = process.cwd();
    process.chdir(project);
    vi.spyOn(agentsModule, 'detectInstalledAgents').mockResolvedValue([]);

    await writeFile(join(project, 'package.json'), JSON.stringify({ dependencies: { lib: '*' } }));
    const skill = join(project, 'node_modules', 'lib', 'skills', 'lib-skill');
    await mkdir(skill, { recursive: true });
    await writeFile(join(project, 'node_modules', 'lib', 'package.json'), '{"name":"lib"}');
    await writeFile(join(skill, 'SKILL.md'), '---\nname: lib-skill\ndescription: d\n---\n');
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    vi.unstubAllEnvs();
    await rm(project, { recursive: true, force: true });
    await rm(state, { recursive: true, force: true });
  });

  it('preselects the last chosen agents and remembers the new choice', async () => {
    await saveSelectedAgents(['claude-code']);
    vi.mocked(searchMultiselect).mockResolvedValue(['windsurf']);

    await runSync([], {});

    expect(vi.mocked(searchMultiselect).mock.calls[0]![0].initialSelected).toEqual(['claude-code']);
    expect(await getLastSelectedAgents()).toEqual(['windsurf']);
  });
});
