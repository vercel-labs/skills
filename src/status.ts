import type { InstalledSkill } from './installer.ts';
import { listInstalledSkills } from './installer.ts';
import type { LocalSkillLockFile } from './local-lock.ts';
import { computeSkillFolderHash } from './local-lock.ts';
import { readLocalLock } from './local-lock.ts';
import type { SkillLockFile, SkillLockEntry } from './skill-lock.ts';
import { getAllLockedSkills } from './skill-lock.ts';

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[38;5;102m';
const CYAN = '\x1b[36m';
const YELLOW = '\x1b[33m';

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

interface StatusCommandOptions {
  global?: boolean;
  json?: boolean;
}

function getLockEntry(
  skill: InstalledSkill,
  globalLock: Record<string, SkillLockEntry>,
  localLock: LocalSkillLockFile
): SkillLockEntry | LocalSkillLockFile['skills'][string] | undefined {
  return skill.scope === 'global' ? globalLock[skill.name] : localLock.skills[skill.name];
}

export async function evaluateSkillStatus(
  installedSkills: InstalledSkill[],
  globalLock: Record<string, SkillLockEntry>,
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

export function parseStatusOptions(args: string[]): StatusCommandOptions {
  const options: StatusCommandOptions = {};

  for (const arg of args) {
    if (arg === '-g' || arg === '--global') {
      options.global = true;
    } else if (arg === '--json') {
      options.json = true;
    }
  }

  return options;
}

export async function runStatus(args: string[]): Promise<void> {
  const options = parseStatusOptions(args);
  const scope = options.global === true ? true : false;
  const scopeLabel = scope ? 'Global' : 'Project';

  const installedSkills = await listInstalledSkills({ global: scope });
  const globalLock = await getAllLockedSkills();
  const localLock = await readLocalLock();
  const statuses = await evaluateSkillStatus(installedSkills, globalLock, localLock);

  if (options.json) {
    console.log(JSON.stringify(statuses, null, 2));
    return;
  }

  if (statuses.length === 0) {
    console.log(`${DIM}No ${scopeLabel.toLowerCase()} skills found.${RESET}`);
    if (scope) {
      console.log(`${DIM}Try checking project skills without -g${RESET}`);
    } else {
      console.log(`${DIM}Try checking global skills with -g${RESET}`);
    }
    return;
  }

  console.log(`${BOLD}${scopeLabel} Status${RESET}`);
  console.log();

  const tracked = statuses.filter((status) => status.status === 'tracked');
  const missing = statuses.filter((status) => status.status === 'missing-lock-entry');
  const mismatched = statuses.filter((status) => status.status === 'hash-mismatch');

  if (tracked.length > 0) {
    console.log(`${BOLD}Tracked${RESET}`);
    for (const status of tracked) {
      console.log(`${CYAN}${status.name}${RESET} ${DIM}${status.lockType}${RESET}`);
    }
    console.log();
  }

  if (missing.length > 0) {
    console.log(`${BOLD}Missing lock entry${RESET}`);
    for (const status of missing) {
      console.log(`${YELLOW}${status.name}${RESET}`);
    }
    console.log();
  }

  if (mismatched.length > 0) {
    console.log(`${BOLD}Hash mismatch${RESET}`);
    for (const status of mismatched) {
      console.log(`${YELLOW}${status.name}${RESET}`);
      console.log(`  ${DIM}Expected:${RESET} ${status.expectedHash}`);
      console.log(`  ${DIM}Actual:${RESET}   ${status.actualHash}`);
    }
    console.log();
  }
}
