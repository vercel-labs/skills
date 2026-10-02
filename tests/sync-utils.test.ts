import { describe, it, expect } from 'vitest';
import {
  sanitizePackageName,
  createTargetName,
  getPackageDeps,
  matchesPattern,
  filterNpmSkills,
  resolveNpmSkillConflicts,
  buildNpmSyncTelemetryPackages,
  type NpmSkill,
} from '../src/sync-utils.ts';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

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

describe('getPackageDeps', () => {
  it('returns every direct package.json dependency class', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'skills-sync-deps-'));
    try {
      await writeFile(
        join(cwd, 'package.json'),
        JSON.stringify({
          dependencies: { react: '^19' },
          devDependencies: { vitest: '^4' },
          optionalDependencies: { sharp: '^0.34' },
          peerDependencies: { next: '^16' },
        })
      );

      expect((await getPackageDeps(cwd))?.sort()).toEqual(['next', 'react', 'sharp', 'vitest']);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});

describe('buildNpmSyncTelemetryPackages', () => {
  it('builds npm package observations for versioned package skills', () => {
    const skills: NpmSkill[] = [
      {
        packageName: 'next',
        packageVersion: '16.2.1',
        skillName: 'next',
        skillPath: '/repo/node_modules/next/dist/skills/next/SKILL.md',
        targetName: 'npm-next-next',
        name: 'Next.js',
        description: 'Next.js skill',
      },
      {
        packageName: '@vercel/ai-sdk',
        packageVersion: '6.0.0',
        skillName: 'coding',
        skillPath: '/repo/node_modules/@vercel/ai-sdk/skills/coding/SKILL.md',
        targetName: 'npm-vercel-ai-sdk-coding',
        name: 'AI SDK Coding',
        description: 'AI SDK skill',
      },
    ];

    expect(buildNpmSyncTelemetryPackages(skills)).toEqual([
      {
        skill: 'Next.js',
        package: 'next',
        ecosystem: 'npm',
        registry: 'npm',
        version: '16.2.1',
      },
      {
        skill: 'AI SDK Coding',
        package: '@vercel/ai-sdk',
        ecosystem: 'npm',
        registry: 'npm',
        version: '6.0.0',
      },
    ]);
  });

  it('omits skills when package version is unavailable', () => {
    const skills: NpmSkill[] = [
      {
        packageName: 'fixture-pkg',
        skillName: 'skill',
        skillPath: '/fixture/SKILL.md',
        targetName: 'npm-fixture-pkg',
        name: 'Fixture Skill',
        description: 'No package.json version',
      },
    ];

    expect(buildNpmSyncTelemetryPackages(skills)).toEqual([]);
  });
});

describe('resolveNpmSkillConflicts', () => {
  it('keeps the first resolved package and reports the ignored collision', () => {
    const rootSkill: NpmSkill = {
      packageName: '@scope/tool',
      packageVersion: '2.0.0',
      skillName: 'migrate',
      skillPath: '/repo/node_modules/@scope/tool/skills/migrate/SKILL.md',
      targetName: 'npm-scope-tool-migrate',
      name: 'Migrate',
      description: 'Root package skill',
    };
    const nestedSkill: NpmSkill = {
      ...rootSkill,
      packageName: 'scope-tool',
      packageVersion: '1.0.0',
      skillPath: '/repo/packages/app/node_modules/scope-tool/skills/migrate/SKILL.md',
      description: 'Workspace package skill',
    };

    expect(resolveNpmSkillConflicts([rootSkill, nestedSkill])).toEqual({
      skills: [rootSkill],
      conflicts: [
        {
          targetName: 'npm-scope-tool-migrate',
          selectedPackage: '@scope/tool',
          ignoredPackage: 'scope-tool',
        },
      ],
    });
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
