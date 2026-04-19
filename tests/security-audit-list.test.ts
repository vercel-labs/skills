import { describe, it, expect } from 'vitest';
import { groupInstalledSkillAudits } from '../src/security-audit-list.ts';
import type { InstalledSkill } from '../src/installer.ts';
import type { SkillLockEntry } from '../src/skill-lock.ts';
import type { LocalSkillLockEntry } from '../src/local-lock.ts';

describe('groupInstalledSkillAudits', () => {
  const baseSkill: Partial<InstalledSkill> = {
    description: 'desc',
    path: '/tmp/skill',
    canonicalPath: '/tmp/skill',
    scope: 'project',
    agents: [],
  };

  it('groups skills by source and ignores non-remote entries', () => {
    const installedSkills: InstalledSkill[] = [
      { ...baseSkill, name: 'foo' },
      { ...baseSkill, name: 'bar' },
      { ...baseSkill, name: 'baz' },
    ] as InstalledSkill[];

    const lockedSkills: Record<string, SkillLockEntry> = {
      foo: {
        source: 'vercel-labs/agent-skills',
        sourceType: 'github',
        sourceUrl: 'https://github.com/vercel-labs/agent-skills',
        skillFolderHash: '123',
        installedAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
      },
    };

    const localSkills: Record<string, LocalSkillLockEntry> = {
      bar: {
        source: 'vercel-labs/agent-skills',
        sourceType: 'github',
        computedHash: 'abc',
      },
      baz: {
        source: '/Users/test/skills/local-baz',
        sourceType: 'local',
        computedHash: 'def',
      },
    };

    const groups = groupInstalledSkillAudits(installedSkills, lockedSkills, localSkills);

    expect(groups).toHaveLength(1);
    expect(groups[0]!.source).toBe('vercel-labs/agent-skills');
    expect(groups[0]!.skills.map((skill) => skill.slug)).toEqual(['bar', 'foo']);
  });
});
