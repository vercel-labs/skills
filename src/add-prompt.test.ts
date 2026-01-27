import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as p from '@clack/prompts';
import { promptForAgents } from './add.js';
import * as skillLock from './skill-lock.js';

// Mock dependencies
vi.mock('@clack/prompts');
vi.mock('./skill-lock.js');
vi.mock('./telemetry.js', () => ({
  setVersion: vi.fn(),
  track: vi.fn(),
}));
vi.mock('../package.json', () => ({
  default: { version: '1.0.0' }
}));

describe('promptForAgents', () => {
  // Cast to any to avoid AgentType validation in tests
  const choices: any[] = [
    { value: 'agent1', label: 'Agent 1' },
    { value: 'agent2', label: 'Agent 2' },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    // Default mocks
    vi.mocked(p.isCancel).mockReturnValue(false);
  });

  it('should use default agents (none) when no history exists and defaultToAll is false', async () => {
    vi.mocked(skillLock.getLastSelectedAgents).mockResolvedValue(undefined);
    vi.mocked(p.multiselect).mockResolvedValue(['agent1']);

    await promptForAgents('Select agents', choices, false);

    expect(p.multiselect).toHaveBeenCalledWith(expect.objectContaining({
      initialValues: []
    }));
  });

  it('should use all agents when no history exists and defaultToAll is true', async () => {
    vi.mocked(skillLock.getLastSelectedAgents).mockResolvedValue(undefined);
    vi.mocked(p.multiselect).mockResolvedValue(['agent1']);

    await promptForAgents('Select agents', choices, true);

    expect(p.multiselect).toHaveBeenCalledWith(expect.objectContaining({
      initialValues: ['agent1', 'agent2']
    }));
  });

  it('should use last selected agents when history exists', async () => {
    vi.mocked(skillLock.getLastSelectedAgents).mockResolvedValue(['agent2']);
    vi.mocked(p.multiselect).mockResolvedValue(['agent2']);

    await promptForAgents('Select agents', choices, false);

    expect(p.multiselect).toHaveBeenCalledWith(expect.objectContaining({
      initialValues: ['agent2']
    }));
  });

  it('should filter out invalid agents from history', async () => {
    vi.mocked(skillLock.getLastSelectedAgents).mockResolvedValue(['agent2', 'invalid-agent']);
    vi.mocked(p.multiselect).mockResolvedValue(['agent2']);

    await promptForAgents('Select agents', choices, false);

    expect(p.multiselect).toHaveBeenCalledWith(expect.objectContaining({
      initialValues: ['agent2']
    }));
  });

  it('should fallback to defaultToAll logic if filtered history is empty', async () => {
    // History exists but all agents are invalid
    vi.mocked(skillLock.getLastSelectedAgents).mockResolvedValue(['invalid-agent']);
    vi.mocked(p.multiselect).mockResolvedValue(['agent1']);

    await promptForAgents('Select agents', choices, true);

    // Should fall back to all agents since history resulted in empty list and defaultToAll=true
    expect(p.multiselect).toHaveBeenCalledWith(expect.objectContaining({
      initialValues: ['agent1', 'agent2']
    }));
  });

  it('should fallback to empty list if filtered history is empty and defaultToAll is false', async () => {
    // History exists but all agents are invalid
    vi.mocked(skillLock.getLastSelectedAgents).mockResolvedValue(['invalid-agent']);
    vi.mocked(p.multiselect).mockResolvedValue(['agent1']);

    await promptForAgents('Select agents', choices, false);

    expect(p.multiselect).toHaveBeenCalledWith(expect.objectContaining({
      initialValues: []
    }));
  });

  it('should save selected agents if not cancelled', async () => {
    vi.mocked(skillLock.getLastSelectedAgents).mockResolvedValue(undefined);
    vi.mocked(p.multiselect).mockResolvedValue(['agent1']);

    await promptForAgents('Select agents', choices, false);

    expect(skillLock.saveSelectedAgents).toHaveBeenCalledWith(['agent1']);
  });

  it('should not save agents if cancelled', async () => {
    vi.mocked(skillLock.getLastSelectedAgents).mockResolvedValue(undefined);
    const cancelSymbol = Symbol('cancel');
    vi.mocked(p.multiselect).mockResolvedValue(cancelSymbol);
    vi.mocked(p.isCancel).mockReturnValue(true);

    await promptForAgents('Select agents', choices, false);

    expect(skillLock.saveSelectedAgents).not.toHaveBeenCalled();
  });
});
