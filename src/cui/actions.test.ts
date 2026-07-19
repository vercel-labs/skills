import { describe, expect, it, vi } from 'vitest';
import { CuiActions, CuiInputError, filterInstalledSkills, oppositeLayer } from './actions.ts';
import type { CuiBackend, CuiInstalledSkill } from './types.ts';

const installed: CuiInstalledSkill[] = [
  {
    name: 'project-claude',
    layer: 'project',
    agents: ['claude-code'],
    path: '.claude/skills/a',
  },
  { name: 'project-codex', layer: 'project', agents: ['codex'], path: '.codex/skills/b' },
  {
    name: 'global-claude',
    layer: 'global',
    agents: ['claude-code'],
    path: '~/.claude/skills/c',
  },
];

function mockBackend(overrides: Partial<CuiBackend> = {}): CuiBackend {
  return {
    list: vi.fn().mockResolvedValue(installed),
    search: vi.fn().mockResolvedValue([]),
    install: vi.fn().mockResolvedValue({ ok: true }),
    update: vi.fn().mockResolvedValue({ ok: true }),
    remove: vi.fn().mockResolvedValue({ ok: true }),
    move: vi.fn().mockResolvedValue({ ok: true }),
    ...overrides,
  };
}

describe('filterInstalledSkills', () => {
  it('filters by layer and agent without mutating backend results', () => {
    expect(filterInstalledSkills(installed, { layer: 'project', agents: ['claude-code'] })).toEqual(
      [installed[0]]
    );
    expect(installed).toHaveLength(3);
  });

  it('returns all layers by default', () => {
    expect(filterInstalledSkills(installed).map((skill) => skill.name)).toEqual([
      'project-claude',
      'project-codex',
      'global-claude',
    ]);
  });
});

describe('oppositeLayer', () => {
  it('returns the other install layer', () => {
    expect(oppositeLayer('project')).toBe('global');
    expect(oppositeLayer('global')).toBe('project');
  });
});

describe('CuiActions', () => {
  it('delegates list through the backend contract and applies filters', async () => {
    const backend = mockBackend();
    const actions = new CuiActions(backend);

    await expect(actions.list({ layer: 'global' })).resolves.toEqual([installed[2]]);
    expect(backend.list).toHaveBeenCalledWith({ layer: 'global' });
  });

  it('normalizes search input before delegating', async () => {
    const backend = mockBackend();
    const actions = new CuiActions(backend);

    await actions.search({ query: '  react  ', owner: 'Vercel-Labs' });

    expect(backend.search).toHaveBeenCalledWith({ query: 'react', owner: 'vercel-labs' });
  });

  it('validates install source and agent selection', async () => {
    const actions = new CuiActions(mockBackend());

    await expect(
      actions.install({ source: '   ', layer: 'project', agents: ['claude-code'] })
    ).rejects.toThrow(CuiInputError);
    await expect(
      actions.install({ source: 'vercel-labs/agent-skills', layer: 'project', agents: [] })
    ).rejects.toThrow('at least one agent is required');
  });

  it('delegates install, update, remove, and move operations', async () => {
    const backend = mockBackend();
    const actions = new CuiActions(backend);

    await actions.install({
      source: ' owner/repo ',
      layer: 'project',
      agents: ['codex'],
      skills: ['lint'],
    });
    await actions.update({ names: ['lint'], layer: 'project' });
    await actions.remove({ names: ['lint'], layer: 'project', skipConfirmation: true });
    await actions.move({ name: 'lint', fromLayer: 'project', toLayer: 'global' });

    expect(backend.install).toHaveBeenCalledWith({
      source: 'owner/repo',
      layer: 'project',
      agents: ['codex'],
      skills: ['lint'],
    });
    expect(backend.update).toHaveBeenCalledWith({ names: ['lint'], layer: 'project' });
    expect(backend.remove).toHaveBeenCalledWith({
      names: ['lint'],
      layer: 'project',
      skipConfirmation: true,
    });
    expect(backend.move).toHaveBeenCalledWith({
      name: 'lint',
      fromLayer: 'project',
      toLayer: 'global',
    });
  });

  it('rejects destructive actions without selected skills or with invalid layers', async () => {
    const actions = new CuiActions(mockBackend());

    await expect(actions.remove({ names: [], layer: 'global' })).rejects.toThrow(
      'at least one skill name is required'
    );
    await expect(
      actions.move({ name: 'lint', fromLayer: 'project', toLayer: 'project' })
    ).rejects.toThrow('source and target layers must be different');
  });
});
