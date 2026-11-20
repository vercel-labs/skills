import { describe, it, expect, vi, beforeEach } from 'vitest';
import { promptForAgents, selectAgentsInteractive } from './add.js';
import {
  agents,
  getNonUniversalAgents,
  getUniversalAgents,
  getVisibleUniversalAgents,
  readsCanonicalGlobally,
} from './agents.js';
import * as skillLock from './skill-lock.js';
import * as searchMultiselectModule from './prompts/search-multiselect.js';

// Mock dependencies
vi.mock('./skill-lock.js');
vi.mock('./prompts/search-multiselect.js');
vi.mock('./telemetry.js', () => ({
  setVersion: vi.fn(),
  track: vi.fn(),
}));
vi.mock('../package.json', () => ({
  default: { version: '1.0.0' },
}));

describe('promptForAgents', () => {
  // Cast to any to avoid AgentType validation in tests
  const choices: any[] = [
    { value: 'opencode', label: 'OpenCode' },
    { value: 'cursor', label: 'Cursor' },
    { value: 'claude-code', label: 'Claude Code' },
    { value: 'grok', label: 'Grok Build' },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should use default agents (claude-code, opencode, codex, grok) when no history exists', async () => {
    vi.mocked(skillLock.getLastSelectedAgents).mockResolvedValue(undefined);
    vi.mocked(searchMultiselectModule.searchMultiselect).mockResolvedValue(['opencode']);

    await promptForAgents('Select agents', choices);

    // Should default to claude-code, opencode, codex, grok (filtered by available choices)
    expect(searchMultiselectModule.searchMultiselect).toHaveBeenCalledWith(
      expect.objectContaining({
        initialSelected: ['claude-code', 'opencode', 'grok'],
      })
    );
  });

  it('should use last selected agents when history exists', async () => {
    vi.mocked(skillLock.getLastSelectedAgents).mockResolvedValue(['cursor']);
    vi.mocked(searchMultiselectModule.searchMultiselect).mockResolvedValue(['cursor']);

    await promptForAgents('Select agents', choices);

    expect(searchMultiselectModule.searchMultiselect).toHaveBeenCalledWith(
      expect.objectContaining({
        initialSelected: ['cursor'],
      })
    );
  });

  it('should filter out invalid agents from history', async () => {
    vi.mocked(skillLock.getLastSelectedAgents).mockResolvedValue(['cursor', 'invalid-agent']);
    vi.mocked(searchMultiselectModule.searchMultiselect).mockResolvedValue(['cursor']);

    await promptForAgents('Select agents', choices);

    expect(searchMultiselectModule.searchMultiselect).toHaveBeenCalledWith(
      expect.objectContaining({
        initialSelected: ['cursor'],
      })
    );
  });

  it('should use default agents if all history agents are invalid', async () => {
    vi.mocked(skillLock.getLastSelectedAgents).mockResolvedValue(['invalid-agent']);
    vi.mocked(searchMultiselectModule.searchMultiselect).mockResolvedValue(['opencode']);

    await promptForAgents('Select agents', choices);

    // When history is invalid, should fall back to defaults (claude-code, opencode, codex, grok)
    // filtered by available choices
    expect(searchMultiselectModule.searchMultiselect).toHaveBeenCalledWith(
      expect.objectContaining({
        initialSelected: ['claude-code', 'opencode', 'grok'],
      })
    );
  });

  it('should save selected agents if not cancelled', async () => {
    vi.mocked(skillLock.getLastSelectedAgents).mockResolvedValue(undefined);
    vi.mocked(searchMultiselectModule.searchMultiselect).mockResolvedValue(['opencode']);

    await promptForAgents('Select agents', choices);

    expect(skillLock.saveSelectedAgents).toHaveBeenCalledWith(['opencode']);
  });

  it('should not save agents if cancelled', async () => {
    vi.mocked(skillLock.getLastSelectedAgents).mockResolvedValue(undefined);
    vi.mocked(searchMultiselectModule.searchMultiselect).mockResolvedValue(
      searchMultiselectModule.cancelSymbol
    );

    await promptForAgents('Select agents', choices);

    expect(skillLock.saveSelectedAgents).not.toHaveBeenCalled();
  });
});

describe('selectAgentsInteractive', () => {
  const promptArgs = () => vi.mocked(searchMultiselectModule.searchMultiselect).mock.calls[0]![0];
  const values = (items: Array<{ value: unknown }>) => items.map((item) => item.value);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(skillLock.getLastSelectedAgents).mockResolvedValue(undefined);
    vi.mocked(searchMultiselectModule.searchMultiselect).mockResolvedValue([]);
  });

  it.each([{}, { global: false }])('keeps the project prompt unchanged (%o)', async (options) => {
    await selectAgentsInteractive(options);

    const universal = getUniversalAgents();
    const visibleUniversal = getVisibleUniversalAgents();
    expect(promptArgs()).toEqual({
      message: 'Which agents do you want to install to?',
      items: getNonUniversalAgents()
        .filter((a) => a !== 'eve')
        .map((a) => ({ value: a, label: agents[a].displayName, hint: agents[a].skillsDir })),
      initialSelected: [],
      lockedSection: {
        title: 'Universal (.agents/skills)',
        items: visibleUniversal.map((a) => ({ value: a, label: agents[a].displayName })),
        hiddenCount: universal.length - visibleUniversal.length,
      },
    });
  });

  it('offers Antigravity as a selectable agent in global mode', async () => {
    await selectAgentsInteractive({ global: true });

    const { items, lockedSection } = promptArgs();
    for (const agent of ['antigravity', 'antigravity-cli'] as const) {
      expect(items).toContainEqual({
        value: agent,
        label: agents[agent].displayName,
        hint: agents[agent].globalSkillsDir,
      });
      expect(values(lockedSection!.items)).not.toContain(agent);
    }

    const lockedUniversal = getUniversalAgents().filter(
      (a) => agents[a].globalSkillsDir && readsCanonicalGlobally(a)
    );
    expect(values(lockedSection!.items)).toContain('codex');
    expect(lockedUniversal).toEqual(expect.arrayContaining(values(lockedSection!.items)));
    expect(lockedSection!.hiddenCount).toBe(lockedUniversal.length - lockedSection!.items.length);
  });

  it('pre-checks a remembered Antigravity selection in global mode only', async () => {
    const history = ['antigravity', 'codex', 'claude-code'];
    vi.mocked(skillLock.getLastSelectedAgents).mockResolvedValue(history);

    await selectAgentsInteractive({ global: true });
    expect(promptArgs().initialSelected).toEqual(['antigravity', 'claude-code']);

    vi.clearAllMocks();
    vi.mocked(skillLock.getLastSelectedAgents).mockResolvedValue(history);
    await selectAgentsInteractive({ global: false });
    expect(promptArgs().initialSelected).toEqual(['claude-code']);
  });

  it('returns and saves the selected agents', async () => {
    const selected = ['codex', 'antigravity', 'antigravity-cli'];
    vi.mocked(searchMultiselectModule.searchMultiselect).mockResolvedValue(selected);

    await expect(selectAgentsInteractive({ global: true })).resolves.toEqual(selected);
    expect(skillLock.saveSelectedAgents).toHaveBeenCalledWith(selected);
  });
});
