import { describe, it, expect, vi, beforeEach } from 'vitest';
import { selectAgentsInteractive } from './add.js';
import * as skillLock from './skill-lock.js';
import * as searchMultiselectModule from './prompts/search-multiselect.js';

vi.mock('./skill-lock.js');
vi.mock('./prompts/search-multiselect.js');
vi.mock('./telemetry.js', () => ({
  setVersion: vi.fn(),
  track: vi.fn(),
}));
vi.mock('../package.json', () => ({
  default: { version: '1.0.0' },
}));

/**
 * Regression coverage for the bug where users running the interactive add prompt
 * with Claude Code installed (and no prior agent history) ended up with the skill
 * only in ~/.agents/skills, because Claude Code was offered as selectable but
 * never pre-checked. Hitting Enter on the prompt then yielded only the locked
 * universal agents.
 */
describe('selectAgentsInteractive — initial selection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('pre-selects detected non-universal agents when no prior history exists', async () => {
    vi.mocked(skillLock.getLastSelectedAgents).mockResolvedValue(undefined);
    vi.mocked(searchMultiselectModule.searchMultiselect).mockResolvedValue(['claude-code']);

    await selectAgentsInteractive({ global: true, installedAgents: ['claude-code'] });

    expect(searchMultiselectModule.searchMultiselect).toHaveBeenCalledWith(
      expect.objectContaining({
        initialSelected: ['claude-code'],
      })
    );
  });

  it('keeps using prior selection when history exists', async () => {
    vi.mocked(skillLock.getLastSelectedAgents).mockResolvedValue(['cursor']);
    vi.mocked(searchMultiselectModule.searchMultiselect).mockResolvedValue(['cursor']);

    await selectAgentsInteractive({ global: true, installedAgents: ['claude-code'] });

    // cursor is universal (.agents/skills); the existing logic filters universal agents
    // out of initialSelected because they are already locked. Result is the empty list,
    // so the user's explicit "I selected nothing else last time" is respected and we
    // do not silently augment with detected agents.
    expect(searchMultiselectModule.searchMultiselect).toHaveBeenCalledWith(
      expect.objectContaining({
        initialSelected: [],
      })
    );
  });

  it('pre-selects multiple detected non-universal agents', async () => {
    vi.mocked(skillLock.getLastSelectedAgents).mockResolvedValue(undefined);
    vi.mocked(searchMultiselectModule.searchMultiselect).mockResolvedValue([
      'claude-code',
      'aider-desk',
    ]);

    await selectAgentsInteractive({
      global: true,
      installedAgents: ['claude-code', 'aider-desk', 'codex'], // codex is universal — filtered out
    });

    expect(searchMultiselectModule.searchMultiselect).toHaveBeenCalledWith(
      expect.objectContaining({
        initialSelected: expect.arrayContaining(['claude-code', 'aider-desk']),
      })
    );
    const call = vi.mocked(searchMultiselectModule.searchMultiselect).mock.calls[0]![0];
    expect(call.initialSelected).not.toContain('codex');
  });

  it('falls back to empty selection when no installed agents are passed', async () => {
    vi.mocked(skillLock.getLastSelectedAgents).mockResolvedValue(undefined);
    vi.mocked(searchMultiselectModule.searchMultiselect).mockResolvedValue([]);

    await selectAgentsInteractive({ global: true });

    expect(searchMultiselectModule.searchMultiselect).toHaveBeenCalledWith(
      expect.objectContaining({
        initialSelected: [],
      })
    );
  });
});
