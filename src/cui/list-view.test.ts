import { describe, expect, it } from 'vitest';
import { formatInstalledSkills, formatSkillDetails } from './list-view.ts';
import type { CuiInstalledSkill } from './types.ts';

const skills: CuiInstalledSkill[] = [
  {
    name: 'global-skill',
    layer: 'global',
    agents: ['codex'],
    path: '~/.codex/skills/global-skill',
  },
  {
    name: 'project-skill',
    layer: 'project',
    agents: ['claude-code'],
    path: '.claude/skills/project-skill',
  },
];

describe('formatInstalledSkills', () => {
  it('separates project and global skills', () => {
    expect(formatInstalledSkills(skills)).toEqual([
      'Project skills (1)',
      '  - project-skill [Claude Code] — .claude/skills/project-skill',
      'Global skills (1)',
      '  - global-skill [Codex] — ~/.codex/skills/global-skill',
    ]);
  });

  it('renders clear empty states for each layer', () => {
    expect(formatInstalledSkills([])).toEqual([
      'Project skills (0)',
      '  No project skills found.',
      'Global skills (0)',
      '  No global skills found.',
    ]);
  });

  it('can render one selected layer', () => {
    expect(formatInstalledSkills(skills, ['project'])).toEqual([
      'Project skills (1)',
      '  - project-skill [Claude Code] — .claude/skills/project-skill',
    ]);
  });
});

describe('formatSkillDetails', () => {
  it('renders metadata with clean fallbacks', () => {
    expect(formatSkillDetails(skills[1]!)).toEqual([
      'Name: project-skill',
      'Description: not specified',
      'Triggers: not specified',
      'Layer: project',
      'Agents: Claude Code',
      'Path: .claude/skills/project-skill',
      'Source: not specified',
      'Source type: not specified',
      'Skill path: not specified',
      'Version/hash: not specified',
      'Plugin: not specified',
    ]);
  });

  it('renders rich metadata when available', () => {
    const lines = formatSkillDetails({
      ...skills[0]!,
      description: 'Keeps releases tidy',
      triggers: ['release', 'publish'],
      source: 'smota/skills',
      sourceUrl: 'https://github.com/smota/skills',
      sourceType: 'github',
      ref: 'main',
      skillPath: 'skills/release/SKILL.md',
      hash: 'abc123',
      hashKind: 'skillFolderHash',
      pluginName: 'release-tools',
      installedAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    });

    expect(lines).toContain('Description: Keeps releases tidy');
    expect(lines).toContain('Triggers: release, publish');
    expect(lines).toContain('Source: https://github.com/smota/skills');
    expect(lines).toContain('Version/hash: ref main • skillFolderHash abc123');
  });
});
