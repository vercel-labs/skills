import type { InstalledSkill } from './installer.ts';
import type { SkillLockEntry } from './skill-lock.ts';
import type { LocalSkillLockEntry } from './local-lock.ts';

export interface SecurityAuditSkill {
  slug: string;
  displayName: string;
}

export interface SecurityAuditGroup {
  source: string;
  skills: SecurityAuditSkill[];
}

function isRemoteSource(
  entry?: SkillLockEntry | LocalSkillLockEntry
): entry is SkillLockEntry | LocalSkillLockEntry {
  if (!entry?.source) return false;
  if (entry.sourceType === 'local') return false;
  if (!entry.source.includes('/')) return false;
  return true;
}

export function groupInstalledSkillAudits(
  installedSkills: InstalledSkill[],
  lockedSkills: Record<string, SkillLockEntry>,
  localSkills: Record<string, LocalSkillLockEntry>
): SecurityAuditGroup[] {
  const grouped = new Map<string, Map<string, SecurityAuditSkill>>();

  for (const skill of installedSkills) {
    const entry = lockedSkills[skill.name] ?? localSkills[skill.name];
    if (!isRemoteSource(entry)) continue;

    const source = entry.source.trim();
    if (!source) continue;

    let skillsForSource = grouped.get(source);
    if (!skillsForSource) {
      skillsForSource = new Map();
      grouped.set(source, skillsForSource);
    }

    if (!skillsForSource.has(skill.name)) {
      skillsForSource.set(skill.name, {
        slug: skill.name,
        displayName: skill.name,
      });
    }
  }

  return Array.from(grouped.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([source, skills]) => ({
      source,
      skills: Array.from(skills.values()).sort((a, b) =>
        a.displayName.localeCompare(b.displayName)
      ),
    }));
}
