import { describe, it, expect } from 'vitest';
import {
  sanitizePackageName,
  createTargetName,
  matchesPattern,
  filterNpmSkills,
  type NpmSkill,
} from '../src/sync-utils.ts';

describe('sanitizePackageName', () => {
  it('strips leading @', () => {
    expect(sanitizePackageName('@vercel/ai-sdk')).toBe('vercel-ai-sdk');
  });

  it('replaces / with -', () => {
    expect(sanitizePackageName('@scope/pkg')).toBe('scope-pkg');
  });

  it('lowercases the result', () => {
    expect(sanitizePackageName('MyPackage')).toBe('mypackage');
  });

  it('handles unscoped packages', () => {
    expect(sanitizePackageName('my-lib')).toBe('my-lib');
  });
});

describe('createTargetName', () => {
  it('creates npm-<pkg> for root skills', () => {
    expect(createTargetName('my-pkg')).toBe('npm-my-pkg');
  });

  it('creates npm-<pkg>-<skill> for subdir skills', () => {
    expect(createTargetName('my-lib', 'coding')).toBe('npm-my-lib-coding');
  });

  it('handles scoped packages for root skills', () => {
    expect(createTargetName('@vercel/ai-sdk')).toBe('npm-vercel-ai-sdk');
  });

  it('handles scoped packages for subdir skills', () => {
    expect(createTargetName('@vercel/ai-sdk', 'coding')).toBe('npm-vercel-ai-sdk-coding');
  });
});

describe('matchesPattern', () => {
  it('matches exact names', () => {
    expect(matchesPattern('pkg-a', 'pkg-a')).toBe(true);
    expect(matchesPattern('pkg-a', 'pkg-b')).toBe(false);
  });

  it('matches wildcard patterns', () => {
    expect(matchesPattern('@scope/foo', '@scope/*')).toBe(true);
    expect(matchesPattern('@scope/bar', '@scope/*')).toBe(true);
    expect(matchesPattern('@other/foo', '@scope/*')).toBe(false);
  });

  it('matches ** patterns', () => {
    expect(matchesPattern('@scope/sub/pkg', '@scope/**')).toBe(true);
  });

  it('matches ? patterns', () => {
    expect(matchesPattern('pkg-a', 'pkg-?')).toBe(true);
    expect(matchesPattern('pkg-ab', 'pkg-?')).toBe(false);
  });

  it('matches suffix wildcards', () => {
    expect(matchesPattern('my-skills', '*-skills')).toBe(true);
    expect(matchesPattern('my-tools', '*-skills')).toBe(false);
  });
});

describe('filterNpmSkills', () => {
  const mockSkills: NpmSkill[] = [
    {
      packageName: 'pkg-a',
      skillName: 'skill1',
      skillPath: '/a/skill1',
      targetName: 'npm-pkg-a-skill1',
      name: 'Skill 1',
      description: 'Desc 1',
    },
    {
      packageName: 'pkg-b',
      skillName: 'skill2',
      skillPath: '/b/skill2',
      targetName: 'npm-pkg-b-skill2',
      name: 'Skill 2',
      description: 'Desc 2',
    },
    {
      packageName: '@scope/foo',
      skillName: 'integration',
      skillPath: '/scope/foo/integration',
      targetName: 'npm-scope-foo-integration',
      name: 'Foo Integration',
      description: 'Desc 3',
    },
    {
      packageName: '@scope/bar',
      skillName: 'guide',
      skillPath: '/scope/bar/guide',
      targetName: 'npm-scope-bar-guide',
      name: 'Bar Guide',
      description: 'Desc 4',
    },
  ];

  it('returns all skills with no filters', () => {
    const { skills, excludedCount } = filterNpmSkills(mockSkills);
    expect(skills).toHaveLength(4);
    expect(excludedCount).toBe(0);
  });

  it('includes only matching packages', () => {
    const { skills, excludedCount } = filterNpmSkills(mockSkills, ['pkg-a']);
    expect(skills).toHaveLength(1);
    expect(skills[0]!.packageName).toBe('pkg-a');
    expect(excludedCount).toBe(3);
  });

  it('excludes matching packages', () => {
    const { skills } = filterNpmSkills(mockSkills, undefined, ['pkg-a']);
    expect(skills).toHaveLength(3);
    expect(skills.every((s) => s.packageName !== 'pkg-a')).toBe(true);
  });

  it('handles wildcard include patterns', () => {
    const { skills } = filterNpmSkills(mockSkills, ['@scope/*']);
    expect(skills).toHaveLength(2);
    expect(skills.every((s) => s.packageName.startsWith('@scope/'))).toBe(true);
  });

  it('handles wildcard exclude patterns', () => {
    const { skills } = filterNpmSkills(mockSkills, undefined, ['@scope/*']);
    expect(skills).toHaveLength(2);
    expect(skills.every((s) => !s.packageName.startsWith('@scope/'))).toBe(true);
  });

  it('applies both include and exclude', () => {
    const { skills, excludedCount } = filterNpmSkills(mockSkills, ['pkg-a', 'pkg-b'], ['pkg-b']);
    expect(skills).toHaveLength(1);
    expect(skills[0]!.packageName).toBe('pkg-a');
    expect(excludedCount).toBe(3);
  });
});
