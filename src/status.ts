import type { InstalledSkill } from './installer.ts';
import type { LocalSkillLockFile } from './local-lock.ts';
import type { SkillLockFile, SkillLockEntry } from './skill-lock.ts';
import { computeSkillFolderHash } from './local-lock.ts';

export type SkillScope = 'project' | 'global';
export type SkillStatusKind = 'tracked' | 'missing-lock-entry' | 'hash-mismatch';

export interface SkillStatus {
  name: string;
  scope: SkillScope;
  status: SkillStatusKind;
  installedPath: string;
  canonicalPath: string;
  lockType?: 'local' | 'global';
  expectedHash?: string;
  actualHash?: string;
}

export interface SkillStatusOptions {
  hashFn?: (skillDir: string) => Promise<string>;
}

function getLockEntry(
  skill: InstalledSkill,
  globalLock: SkillLockFile,
  localLock: LocalSkillLockFile
): SkillLockEntry | LocalSkillLockFile['skills'][string] | undefined {
  return skill.scope === 'global' ? globalLock.skills[skill.name] : localLock.skills[skill.name];
}

export async function evaluateSkillStatus(
  installedSkills: InstalledSkill[],
  globalLock: SkillLockFile,
  localLock: LocalSkillLockFile,
  options: SkillStatusOptions = {}
): Promise<SkillStatus[]> {
  const hashFn = options.hashFn ?? computeSkillFolderHash;
  const statuses: SkillStatus[] = [];

  for (const skill of installedSkills) {
    const lockEntry = getLockEntry(skill, globalLock, localLock);

    if (!lockEntry) {
      statuses.push({
        name: skill.name,
        scope: skill.scope,
        status: 'missing-lock-entry',
        installedPath: skill.path,
        canonicalPath: skill.canonicalPath,
      });
      continue;
    }

    const lockType = skill.scope === 'global' ? 'global' : 'local';
    const expectedHash =
      lockType === 'global'
        ? (lockEntry as SkillLockEntry).skillFolderHash
        : (lockEntry as LocalSkillLockFile['skills'][string]).computedHash;

    const actualHash = await hashFn(skill.canonicalPath);
    const status: SkillStatusKind = actualHash === expectedHash ? 'tracked' : 'hash-mismatch';

    statuses.push({
      name: skill.name,
      scope: skill.scope,
      status,
      installedPath: skill.path,
      canonicalPath: skill.canonicalPath,
      lockType,
      expectedHash,
      actualHash,
    });
  }

  return statuses;
}
