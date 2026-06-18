import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildRememberedAddState, promptForAgents } from './add.js';
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

  it('should prefer source-specific remembered agents over global history', async () => {
    vi.mocked(skillLock.getLastSelectedAgents).mockResolvedValue(['cursor']);
    vi.mocked(searchMultiselectModule.searchMultiselect).mockResolvedValue(['opencode']);

    await promptForAgents('Select agents', choices, ['opencode']);

    expect(searchMultiselectModule.searchMultiselect).toHaveBeenCalledWith(
      expect.objectContaining({
        initialSelected: ['opencode'],
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

describe('buildRememberedAddState', () => {
  it('derives remembered skills, agents, scope, and mode from project entries', () => {
    const remembered = buildRememberedAddState(
      {
        alpha: {
          source: 'org/repo',
          sourceType: 'github',
          computedHash: 'hash',
          agents: ['claude-code', 'codex'],
          installMode: 'copy',
        },
      },
      {}
    );

    expect(remembered.skillNames).toEqual(['alpha']);
    expect(remembered.agents).toEqual(['claude-code', 'codex']);
    expect(remembered.scope).toBe(false);
    expect(remembered.installMode).toBe('copy');
  });

  it('derives global scope only when global is the clear match', () => {
    const remembered = buildRememberedAddState(
      {},
      {
        alpha: {
          source: 'org/repo',
          sourceType: 'github',
          sourceUrl: 'https://github.com/org/repo.git',
          skillFolderHash: 'hash',
          installedAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          agents: ['continue'],
          installMode: 'symlink',
        },
      }
    );

    expect(remembered.scope).toBe(true);
    expect(remembered.agents).toEqual(['continue']);
    expect(remembered.installMode).toBe('symlink');
  });

  it('does not pick a scope or mode when remembered entries conflict', () => {
    const remembered = buildRememberedAddState(
      {
        alpha: {
          source: 'org/repo',
          sourceType: 'github',
          computedHash: 'hash',
          installMode: 'copy',
        },
      },
      {
        beta: {
          source: 'org/repo',
          sourceType: 'github',
          sourceUrl: 'https://github.com/org/repo.git',
          skillFolderHash: 'hash',
          installedAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          installMode: 'symlink',
        },
      }
    );

    expect(remembered.skillNames).toEqual(['alpha', 'beta']);
    expect(remembered.scope).toBeUndefined();
    expect(remembered.installMode).toBeUndefined();
  });
});
