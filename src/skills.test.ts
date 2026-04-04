import { describe, it, expect } from 'vitest';
import { resolveDependencies, formatDependencyTree } from './skills.ts';
import type { Skill } from './types.ts';

describe('resolveDependencies', () => {
  it('should detect circular dependencies', () => {
    const skillA: Skill = {
      name: 'skill-a',
      description: 'Skill A',
      path: '/path/a',
      depends: ['skill-b'],
    };
    const skillB: Skill = {
      name: 'skill-b',
      description: 'Skill B',
      path: '/path/b',
      depends: ['skill-a'],
    };
    const allSkills = [skillA, skillB];

    expect(() => resolveDependencies(skillA, allSkills)).toThrow(
      'Circular dependency detected: skill-a -> skill-b -> skill-a'
    );
  });

  it('should resolve linear dependencies', () => {
    const skillA: Skill = {
      name: 'skill-a',
      description: 'Skill A',
      path: '/path/a',
      depends: ['skill-b'],
    };
    const skillB: Skill = {
      name: 'skill-b',
      description: 'Skill B',
      path: '/path/b',
      depends: ['skill-c'],
    };
    const skillC: Skill = {
      name: 'skill-c',
      description: 'Skill C',
      path: '/path/c',
    };
    const allSkills = [skillA, skillB, skillC];

    const resolved = resolveDependencies(skillA, allSkills);
    expect(resolved.map((s) => s.name)).toEqual(['skill-c', 'skill-b', 'skill-a']);
  });

  it('should handle shared dependencies', () => {
    const skillA: Skill = {
      name: 'skill-a',
      description: 'Skill A',
      path: '/path/a',
      depends: ['skill-c'],
    };
    const skillB: Skill = {
      name: 'skill-b',
      description: 'Skill B',
      path: '/path/b',
      depends: ['skill-c'],
    };
    const skillC: Skill = {
      name: 'skill-c',
      description: 'Skill C',
      path: '/path/c',
    };
    const allSkills = [skillA, skillB, skillC];

    const resolvedA = resolveDependencies(skillA, allSkills);
    const resolvedB = resolveDependencies(skillB, allSkills);

    expect(resolvedA.map((s) => s.name)).toEqual(['skill-c', 'skill-a']);
    expect(resolvedB.map((s) => s.name)).toEqual(['skill-c', 'skill-b']);
  });

  it('should throw error when dependency not found', () => {
    const skillA: Skill = {
      name: 'skill-a',
      description: 'Skill A',
      path: '/path/a',
      depends: ['skill-missing'],
    };
    const allSkills = [skillA];

    expect(() => resolveDependencies(skillA, allSkills)).toThrow(
      'Dependency "skill-missing" not found for skill "skill-a"'
    );
  });

  it('should handle skills with no dependencies', () => {
    const skillA: Skill = {
      name: 'skill-a',
      description: 'Skill A',
      path: '/path/a',
    };
    const allSkills = [skillA];

    const resolved = resolveDependencies(skillA, allSkills);
    expect(resolved.map((s) => s.name)).toEqual(['skill-a']);
  });
});

describe('formatDependencyTree', () => {
  it('should format simple dependency tree', () => {
    const skillA: Skill = {
      name: 'skill-a',
      description: 'Skill A',
      path: '/path/a',
      depends: ['skill-b'],
    };
    const skillB: Skill = {
      name: 'skill-b',
      description: 'Skill B',
      path: '/path/b',
    };
    const resolved = [skillB, skillA];

    const tree = formatDependencyTree(skillA, resolved);
    expect(tree).toContain('skill-a');
    expect(tree).toContain('└─ skill-b');
  });

  it('should format nested dependency tree', () => {
    const skillA: Skill = {
      name: 'skill-a',
      description: 'Skill A',
      path: '/path/a',
      depends: ['skill-b'],
    };
    const skillB: Skill = {
      name: 'skill-b',
      description: 'Skill B',
      path: '/path/b',
      depends: ['skill-c'],
    };
    const skillC: Skill = {
      name: 'skill-c',
      description: 'Skill C',
      path: '/path/c',
    };
    const resolved = [skillC, skillB, skillA];

    const tree = formatDependencyTree(skillA, resolved);
    expect(tree).toContain('skill-a');
    expect(tree).toContain('└─ skill-b');
    expect(tree).toContain('   └─ skill-c');
  });
});
