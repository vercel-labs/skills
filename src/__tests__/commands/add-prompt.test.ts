import { describe, it, expect, vi, beforeEach } from 'vitest';
import { promptForAgents } from '../../commands/add.js';
import * as skillLock from '../../services/lock/lock-file.js';
import * as searchMultiselectModule from '../../ui/search-multiselect.js';

// Mock dependencies
vi.mock('../../services/lock/lock-file.js');
vi.mock('../../ui/search-multiselect.js');
vi.mock('../../services/telemetry/index.js', () => ({
  setVersion: vi.fn(),
  track: vi.fn(),
}));
vi.mock('../../../package.json', () => ({
  default: { version: '1.0.0' },
}));

describe('promptForAgents', () => {
  // Cast to any to avoid AgentType validation in tests
  const choices: any[] = [
    { value: 'opencode', label: 'OpenCode' },
    { value: 'cursor', label: 'Cursor' },
    { value: 'claude-code', label: 'Claude Code' },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should use default agents (claude-code, opencode, codex) when no history exists', async () => {
    vi.mocked(skillLock.getLastSelectedAgents).mockResolvedValue(undefined);
    vi.mocked(searchMultiselectModule.searchMultiselect).mockResolvedValue(['opencode']);

    await promptForAgents('Select agents', choices);

    // Should default to claude-code, opencode, codex (filtered by available choices)
    expect(searchMultiselectModule.searchMultiselect).toHaveBeenCalledWith(
      expect.objectContaining({
        initialSelected: ['claude-code', 'opencode'],
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

    // When history is invalid, should fall back to defaults (claude-code, opencode, codex)
    // filtered by available choices
    expect(searchMultiselectModule.searchMultiselect).toHaveBeenCalledWith(
      expect.objectContaining({
        initialSelected: ['claude-code', 'opencode'],
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
