import { describe, it, expect } from 'vitest';
import { parseScopeOptions, buildInstallUrl, buildUpdateAddArgs } from './cli.ts';
import type { SkillLockEntry } from './skill-lock.ts';

describe('check/update scope options', () => {
  it('defaults to both project and global', () => {
    expect(parseScopeOptions([])).toEqual({ project: true, global: true });
  });

  it('supports --global only', () => {
    expect(parseScopeOptions(['--global'])).toEqual({ project: false, global: true });
  });

  it('supports --project only', () => {
    expect(parseScopeOptions(['--project'])).toEqual({ project: true, global: false });
  });

  it('supports both flags together', () => {
    expect(parseScopeOptions(['--project', '--global'])).toEqual({ project: true, global: true });
  });
});

describe('update install argument builders', () => {
  const baseEntry: SkillLockEntry = {
    source: 'owner/repo',
    sourceType: 'github',
    sourceUrl: 'https://github.com/owner/repo.git',
    skillFolderHash: 'hash',
    installedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  it('buildInstallUrl returns sourceUrl when no skillPath is set', () => {
    expect(buildInstallUrl(baseEntry)).toBe('https://github.com/owner/repo.git');
  });

  it('buildInstallUrl appends tree/main/<folder> when skillPath is present', () => {
    const entry: SkillLockEntry = {
      ...baseEntry,
      skillPath: 'skills/my-skill/SKILL.md',
    };

    expect(buildInstallUrl(entry)).toBe('https://github.com/owner/repo/tree/main/skills/my-skill');
  });

  it('buildUpdateAddArgs preserves local name via --rename', () => {
    const args = buildUpdateAddArgs(
      'https://github.com/owner/repo/tree/main/skills/my-skill',
      'my-renamed-skill',
      'project'
    );
    expect(args).toEqual([
      '-y',
      'skills',
      'add',
      'https://github.com/owner/repo/tree/main/skills/my-skill',
      '-y',
      '--rename',
      'my-renamed-skill',
    ]);
  });

  it('buildUpdateAddArgs adds -g for global scope', () => {
    const args = buildUpdateAddArgs(
      'https://github.com/owner/repo/tree/main/skills/my-skill',
      'my-renamed-skill',
      'global'
    );
    expect(args).toContain('-g');
  });
});
