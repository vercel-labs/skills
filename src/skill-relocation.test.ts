import { describe, expect, it } from 'vitest';
import { resolveSkillLocations } from './skill-relocation.ts';

const lock = (skillPath: string) => ({
  'swiftui-expert-skill': { skillPath },
});

describe('resolveSkillLocations', () => {
  it('keeps an unchanged exact path', () => {
    const result = resolveSkillLocations(
      ['swiftui-expert-skill'],
      lock('skills/swiftui-expert-skill/SKILL.md'),
      [
        {
          name: 'swiftui-expert-skill',
          skillPath: 'skills/swiftui-expert-skill/SKILL.md',
        },
      ]
    );

    expect(result.resolvedPaths.get('swiftui-expert-skill')).toBe(
      'skills/swiftui-expert-skill/SKILL.md'
    );
    expect(result.deletedSkills).toEqual([]);
    expect(result.ambiguousSkills).toEqual([]);
  });

  it('resolves a uniquely relocated skill by name', () => {
    const result = resolveSkillLocations(
      ['swiftui-expert-skill'],
      lock('swiftui-expert-skill/SKILL.md'),
      [
        {
          name: 'swiftui-expert-skill',
          skillPath: 'skills/swiftui-expert-skill/SKILL.md',
        },
      ]
    );

    expect(result.resolvedPaths.get('swiftui-expert-skill')).toBe(
      'skills/swiftui-expert-skill/SKILL.md'
    );
    expect(result.deletedSkills).toEqual([]);
  });

  it('matches normalized skill names', () => {
    const result = resolveSkillLocations(
      ['SwiftUI Expert Skill'],
      { 'SwiftUI Expert Skill': { skillPath: 'old/location/SKILL.md' } },
      [
        {
          name: 'swiftui_expert_skill',
          skillPath: 'new/location/SKILL.md',
        },
      ]
    );

    expect(result.resolvedPaths.get('SwiftUI Expert Skill')).toBe('new/location/SKILL.md');
  });

  it('marks a missing skill as deleted', () => {
    const result = resolveSkillLocations(
      ['swiftui-expert-skill'],
      lock('swiftui-expert-skill/SKILL.md'),
      []
    );

    expect(result.deletedSkills).toEqual(['swiftui-expert-skill']);
    expect(result.resolvedPaths.size).toBe(0);
  });

  it('fails closed when multiple current paths have the same name', () => {
    const result = resolveSkillLocations(
      ['swiftui-expert-skill'],
      lock('old/swiftui-expert-skill/SKILL.md'),
      [
        {
          name: 'swiftui-expert-skill',
          skillPath: 'skills/swiftui-expert-skill/SKILL.md',
        },
        {
          name: 'swiftui-expert-skill',
          skillPath: 'plugins/swiftui-expert-skill/SKILL.md',
        },
      ]
    );

    expect(result.ambiguousSkills).toEqual(['swiftui-expert-skill']);
    expect(result.deletedSkills).toEqual([]);
    expect(result.resolvedPaths.size).toBe(0);
  });

  it('fails closed on duplicate names even when one path matches exactly', () => {
    const result = resolveSkillLocations(
      ['swiftui-expert-skill'],
      lock('skills/swiftui-expert-skill/SKILL.md'),
      [
        {
          name: 'swiftui-expert-skill',
          skillPath: 'skills/swiftui-expert-skill/SKILL.md',
        },
        {
          name: 'swiftui-expert-skill',
          skillPath: 'plugins/swiftui-expert-skill/SKILL.md',
        },
      ]
    );

    expect(result.ambiguousSkills).toEqual(['swiftui-expert-skill']);
    expect(result.deletedSkills).toEqual([]);
    expect(result.resolvedPaths.size).toBe(0);
  });

  it('normalizes path separators before exact matching', () => {
    const result = resolveSkillLocations(
      ['swiftui-expert-skill'],
      lock('skills\\swiftui-expert-skill\\SKILL.md'),
      [
        {
          name: 'different-frontmatter-name',
          skillPath: 'skills/swiftui-expert-skill/SKILL.md',
        },
      ]
    );

    expect(result.resolvedPaths.get('swiftui-expert-skill')).toBe(
      'skills/swiftui-expert-skill/SKILL.md'
    );
    expect(result.deletedSkills).toEqual([]);
  });
});
