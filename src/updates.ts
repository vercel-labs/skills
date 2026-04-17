import { spawnSync } from 'child_process';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';
import * as p from '@clack/prompts';
import { track } from './telemetry.ts';
import { fetchSkillFolderHash, getGitHubToken } from './skill-lock.ts';
import { readLocalLock, type LocalSkillLockEntry } from './local-lock.ts';
import {
  buildUpdateInstallSource,
  buildLocalUpdateSource,
  formatSourceInput,
} from './update-source.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[38;5;102m';
const TEXT = '\x1b[38;5;145m';

const AGENTS_DIR = '.agents';
const LOCK_FILE = '.skill-lock.json';
const CURRENT_LOCK_VERSION = 3;

// ============================================
// Lock file types and reader
// ============================================

export interface SkillLockEntry {
  source: string;
  sourceType: string;
  sourceUrl: string;
  ref?: string;
  skillPath?: string;
  /** GitHub tree SHA for the entire skill folder (v3) */
  skillFolderHash: string;
  installedAt: string;
  updatedAt: string;
}

export interface SkillLockFile {
  version: number;
  skills: Record<string, SkillLockEntry>;
}

export function getSkillLockPath(): string {
  const xdgStateHome = process.env.XDG_STATE_HOME;
  if (xdgStateHome) {
    return join(xdgStateHome, 'skills', LOCK_FILE);
  }
  return join(homedir(), AGENTS_DIR, LOCK_FILE);
}

export function readSkillLock(): SkillLockFile {
  const lockPath = getSkillLockPath();
  try {
    const content = readFileSync(lockPath, 'utf-8');
    const parsed = JSON.parse(content) as SkillLockFile;
    if (typeof parsed.version !== 'number' || !parsed.skills) {
      return { version: CURRENT_LOCK_VERSION, skills: {} };
    }
    // If old version, wipe and start fresh (backwards incompatible change)
    if (parsed.version < CURRENT_LOCK_VERSION) {
      return { version: CURRENT_LOCK_VERSION, skills: {} };
    }
    return parsed;
  } catch {
    return { version: CURRENT_LOCK_VERSION, skills: {} };
  }
}

// ============================================
// Scope resolution
// ============================================

export type UpdateScope = 'project' | 'global' | 'both';

export interface UpdateCheckOptions {
  global?: boolean;
  project?: boolean;
  yes?: boolean;
  /** Optional skill name(s) to filter on (positional args) */
  skills?: string[];
}

export function parseUpdateOptions(args: string[]): UpdateCheckOptions {
  const options: UpdateCheckOptions = {};
  const positional: string[] = [];
  for (const arg of args) {
    if (arg === '-g' || arg === '--global') {
      options.global = true;
    } else if (arg === '-p' || arg === '--project') {
      options.project = true;
    } else if (arg === '-y' || arg === '--yes') {
      options.yes = true;
    } else if (!arg.startsWith('-')) {
      positional.push(arg);
    }
  }
  if (positional.length > 0) {
    options.skills = positional;
  }
  return options;
}

/**
 * Check whether the current working directory has project-level skills.
 */
export function hasProjectSkills(cwd?: string): boolean {
  const dir = cwd || process.cwd();

  const lockPath = join(dir, 'skills-lock.json');
  if (existsSync(lockPath)) {
    return true;
  }

  const skillsDir = join(dir, '.agents', 'skills');
  try {
    const entries = readdirSync(skillsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const skillMd = join(skillsDir, entry.name, 'SKILL.md');
        if (existsSync(skillMd)) {
          return true;
        }
      }
    }
  } catch {
    // Directory doesn't exist
  }

  return false;
}

/**
 * Determine the update/check scope via interactive prompt or auto-detection.
 */
export async function resolveUpdateScope(options: UpdateCheckOptions): Promise<UpdateScope> {
  // When targeting specific skills, search both scopes to find them
  if (options.skills && options.skills.length > 0) {
    if (options.global) return 'global';
    if (options.project) return 'project';
    return 'both';
  }

  if (options.global && options.project) {
    return 'both';
  }
  if (options.global) {
    return 'global';
  }
  if (options.project) {
    return 'project';
  }

  if (options.yes || !process.stdin.isTTY) {
    return hasProjectSkills() ? 'project' : 'global';
  }

  const scope = await p.select({
    message: 'Update scope',
    options: [
      {
        value: 'project' as UpdateScope,
        label: 'Project',
        hint: 'Update skills in current directory',
      },
      {
        value: 'global' as UpdateScope,
        label: 'Global',
        hint: 'Update skills in home directory',
      },
      {
        value: 'both' as UpdateScope,
        label: 'Both',
        hint: 'Update all skills',
      },
    ],
  });

  if (p.isCancel(scope)) {
    p.cancel('Cancelled');
    process.exit(0);
  }

  return scope as UpdateScope;
}

// ============================================
// Skill filter
// ============================================

export function matchesSkillFilter(name: string, filter?: string[]): boolean {
  if (!filter || filter.length === 0) return true;
  const lower = name.toLowerCase();
  return filter.some((f) => f.toLowerCase() === lower);
}

// ============================================
// Skipped skills (unchecked) reporting
// ============================================

export interface SkippedSkill {
  name: string;
  reason: string;
  sourceUrl: string;
  sourceType: string;
  ref?: string;
}

/**
 * Determine why a skill cannot be checked for updates automatically.
 */
export function getSkipReason(entry: SkillLockEntry): string {
  if (entry.sourceType === 'local') {
    return 'Local path';
  }
  if (entry.sourceType === 'git') {
    return 'Git URL';
  }
  if (entry.sourceType === 'well-known') {
    return 'Well-known skill';
  }
  if (!entry.skillFolderHash) {
    return 'Private or deleted repo';
  }
  if (!entry.skillPath) {
    return 'No skill path recorded';
  }
  return 'No version tracking';
}

/**
 * For well-known skills, strip the .well-known/... path and /SKILL.md suffix
 * to produce the base URL the user originally used to install.
 */
function getInstallSource(skill: SkippedSkill): string {
  let url = skill.sourceUrl;
  if (skill.sourceType === 'well-known') {
    const idx = url.indexOf('/.well-known/');
    if (idx !== -1) {
      url = url.slice(0, idx);
    }
  }
  return formatSourceInput(url, skill.ref);
}

/**
 * Print a list of skills that cannot be checked automatically,
 * with the reason and a manual update command for each.
 */
function printSkippedSkills(skipped: SkippedSkill[]): void {
  if (skipped.length === 0) return;
  console.log();
  console.log(`${DIM}${skipped.length} skill(s) cannot be checked automatically:${RESET}`);

  const grouped = new Map<string, SkippedSkill[]>();
  for (const skill of skipped) {
    const source = getInstallSource(skill);
    const existing = grouped.get(source) || [];
    existing.push(skill);
    grouped.set(source, existing);
  }

  for (const [source, skills] of grouped) {
    if (skills.length === 1) {
      const skill = skills[0]!;
      console.log(`  ${TEXT}•${RESET} ${skill.name} ${DIM}(${skill.reason})${RESET}`);
    } else {
      const reason = skills[0]!.reason;
      const names = skills.map((s) => s.name).join(', ');
      console.log(`  ${TEXT}•${RESET} ${names} ${DIM}(${reason})${RESET}`);
    }
    console.log(`    ${DIM}To update: ${TEXT}npx skills add ${source} -g -y${RESET}`);
  }
}

// ============================================
// Check (no install): the authoritative primitive
// ============================================

/**
 * Result of a per-skill fetch attempt. `upstreamHash === null` combined
 * with `error !== null` means the fetch threw; `upstreamHash === null`
 * combined with `error === null` means the server returned no hash
 * (private/deleted repo, rate limit). `upstreamHash !== null` is a
 * definitive upstream answer — compare against `entry.skillFolderHash`
 * to derive the `outdated` boolean.
 */
export interface GlobalCheckedEntry {
  name: string;
  entry: SkillLockEntry;
  upstreamHash: string | null;
  error: string | null;
}

export interface GlobalCheckResult {
  /** Skills that we attempted to fetch upstream hashes for. */
  checked: GlobalCheckedEntry[];
  /** Skills that couldn't be checked at all (local path, well-known, missing metadata). */
  skipped: SkippedSkill[];
  /** checked.length + skipped.length */
  checkedCount: number;
}

export interface CheckProgress {
  (index: number, total: number, name: string): void;
}

/**
 * Partition installed global skills and fetch upstream hashes.
 * Does NOT install anything. Used by both `runUpdate` (for the install
 * phase) and `runOutdated` (for the check-only report).
 */
export async function checkGlobalSkillUpdates(
  skillFilter?: string[],
  onProgress?: CheckProgress
): Promise<GlobalCheckResult> {
  const lock = readSkillLock();
  const skillNames = Object.keys(lock.skills);

  const skipped: SkippedSkill[] = [];
  const checkable: Array<{ name: string; entry: SkillLockEntry }> = [];

  for (const skillName of skillNames) {
    if (!matchesSkillFilter(skillName, skillFilter)) continue;

    const entry = lock.skills[skillName];
    if (!entry) continue;

    if (!entry.skillFolderHash || !entry.skillPath) {
      skipped.push({
        name: skillName,
        reason: getSkipReason(entry),
        sourceUrl: entry.sourceUrl,
        sourceType: entry.sourceType,
        ref: entry.ref,
      });
      continue;
    }

    checkable.push({ name: skillName, entry });
  }

  const token = getGitHubToken();
  const checked: GlobalCheckedEntry[] = [];

  for (let i = 0; i < checkable.length; i++) {
    const { name: skillName, entry } = checkable[i]!;
    if (onProgress) onProgress(i + 1, checkable.length, skillName);

    try {
      const latestHash = await fetchSkillFolderHash(
        entry.source,
        entry.skillPath!,
        token,
        entry.ref
      );
      checked.push({
        name: skillName,
        entry,
        upstreamHash: latestHash ?? null,
        error: null,
      });
    } catch (err) {
      checked.push({
        name: skillName,
        entry,
        upstreamHash: null,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    checked,
    skipped,
    checkedCount: checkable.length + skipped.length,
  };
}

/** Derived view: which entries have a definitive upstream hash that differs from local. */
export function selectOutdated(result: GlobalCheckResult): GlobalCheckedEntry[] {
  return result.checked.filter(
    (c) => c.upstreamHash !== null && c.upstreamHash !== c.entry.skillFolderHash
  );
}

// ============================================
// Project Skills Discovery (for update + outdated)
// ============================================

export async function getProjectSkillsForUpdate(
  skillFilter?: string[]
): Promise<Array<{ name: string; source: string; entry: LocalSkillLockEntry }>> {
  const localLock = await readLocalLock();
  const skills: Array<{ name: string; source: string; entry: LocalSkillLockEntry }> = [];

  for (const [name, entry] of Object.entries(localLock.skills)) {
    if (!matchesSkillFilter(name, skillFilter)) continue;
    // Skip node_modules and local path skills - they are managed by sync/manually
    if (entry.sourceType === 'node_modules' || entry.sourceType === 'local') {
      continue;
    }
    skills.push({ name, source: entry.source, entry });
  }

  return skills;
}

// ============================================
// Update: Global Skills
// ============================================

async function updateGlobalSkills(
  skillFilter?: string[]
): Promise<{ successCount: number; failCount: number; checkedCount: number }> {
  let successCount = 0;
  let failCount = 0;

  const result = await checkGlobalSkillUpdates(skillFilter, (i, total, name) => {
    process.stdout.write(`\r${DIM}Checking global skill ${i}/${total}: ${name}${RESET}\x1b[K`);
  });

  if (result.checked.length > 0) {
    process.stdout.write('\r\x1b[K');
  }

  const outdated = selectOutdated(result);
  const errored = result.checked.filter((c) => c.error !== null);

  if (result.checked.length === 0 && result.skipped.length === 0) {
    if (!skillFilter) {
      const lock = readSkillLock();
      if (Object.keys(lock.skills).length === 0) {
        console.log(`${DIM}No global skills tracked in lock file.${RESET}`);
        console.log(`${DIM}Install skills with${RESET} ${TEXT}npx skills add <package> -g${RESET}`);
      } else {
        console.log(`${DIM}No global skills to check.${RESET}`);
      }
    }
    return { successCount, failCount, checkedCount: 0 };
  }

  if (result.checked.length === 0 && result.skipped.length > 0) {
    printSkippedSkills(result.skipped);
    return { successCount, failCount, checkedCount: result.checkedCount };
  }

  if (outdated.length === 0 && errored.length === 0) {
    console.log(`${TEXT}✓ All global skills are up to date${RESET}`);
    return { successCount, failCount, checkedCount: result.checkedCount };
  }

  if (errored.length > 0) {
    console.log(`${DIM}${errored.length} skill(s) could not be checked (network or auth):${RESET}`);
    for (const e of errored) {
      console.log(`  ${DIM}•${RESET} ${e.name}: ${e.error}`);
    }
    console.log();
  }

  if (outdated.length === 0) {
    return { successCount, failCount, checkedCount: result.checkedCount };
  }

  console.log(`${TEXT}Found ${outdated.length} global update(s)${RESET}`);
  console.log();

  for (const update of outdated) {
    console.log(`${TEXT}Updating ${update.name}...${RESET}`);
    const installUrl = buildUpdateInstallSource(update.entry);

    const cliEntry = join(__dirname, '..', 'bin', 'cli.mjs');
    if (!existsSync(cliEntry)) {
      failCount++;
      console.log(
        `  ${DIM}✗ Failed to update ${update.name}: CLI entrypoint not found at ${cliEntry}${RESET}`
      );
      continue;
    }
    const spawnResult = spawnSync(process.execPath, [cliEntry, 'add', installUrl, '-g', '-y'], {
      stdio: ['inherit', 'pipe', 'pipe'],
      encoding: 'utf-8',
      shell: process.platform === 'win32',
    });

    if (spawnResult.status === 0) {
      successCount++;
      console.log(`  ${TEXT}✓${RESET} Updated ${update.name}`);
    } else {
      failCount++;
      console.log(`  ${DIM}✗ Failed to update ${update.name}${RESET}`);
    }
  }

  printSkippedSkills(result.skipped);
  return { successCount, failCount, checkedCount: result.checkedCount };
}

// ============================================
// Update: Project Skills
// ============================================

async function updateProjectSkills(
  skillFilter?: string[]
): Promise<{ successCount: number; failCount: number; foundCount: number }> {
  const projectSkills = await getProjectSkillsForUpdate(skillFilter);
  let successCount = 0;
  let failCount = 0;

  if (projectSkills.length === 0) {
    if (!skillFilter) {
      console.log(`${DIM}No project skills to update.${RESET}`);
      console.log(
        `${DIM}Install project skills with${RESET} ${TEXT}npx skills add <package>${RESET}`
      );
    }
    return { successCount, failCount, foundCount: 0 };
  }

  console.log(`${TEXT}Refreshing ${projectSkills.length} project skill(s)...${RESET}`);
  console.log();

  for (const skill of projectSkills) {
    console.log(`${TEXT}Updating ${skill.name}...${RESET}`);
    const installUrl = buildLocalUpdateSource(skill.entry);

    const cliEntry = join(__dirname, '..', 'bin', 'cli.mjs');
    if (!existsSync(cliEntry)) {
      failCount++;
      console.log(
        `  ${DIM}✗ Failed to update ${skill.name}: CLI entrypoint not found at ${cliEntry}${RESET}`
      );
      continue;
    }

    const result = spawnSync(process.execPath, [cliEntry, 'add', installUrl, '-y'], {
      stdio: ['inherit', 'pipe', 'pipe'],
      encoding: 'utf-8',
      shell: process.platform === 'win32',
    });

    if (result.status === 0) {
      successCount++;
      console.log(`  ${TEXT}✓${RESET} Updated ${skill.name}`);
    } else {
      failCount++;
      console.log(`  ${DIM}✗ Failed to update ${skill.name}${RESET}`);
    }
  }

  return { successCount, failCount, foundCount: projectSkills.length };
}

// ============================================
// runUpdate entry
// ============================================

export async function runUpdate(args: string[] = []): Promise<void> {
  const options = parseUpdateOptions(args);
  const scope = await resolveUpdateScope(options);

  if (options.skills) {
    console.log(`${TEXT}Updating ${options.skills.join(', ')}...${RESET}`);
  } else {
    console.log(`${TEXT}Checking for skill updates...${RESET}`);
  }
  console.log();

  let totalSuccess = 0;
  let totalFail = 0;
  let totalFound = 0;

  if (scope === 'global' || scope === 'both') {
    if (scope === 'both' && !options.skills) {
      console.log(`${BOLD}Global Skills${RESET}`);
    }
    const { successCount, failCount, checkedCount } = await updateGlobalSkills(options.skills);
    totalSuccess += successCount;
    totalFail += failCount;
    totalFound += checkedCount;
    if (scope === 'both' && !options.skills) {
      console.log();
    }
  }

  if (scope === 'project' || scope === 'both') {
    if (scope === 'both' && !options.skills) {
      console.log(`${BOLD}Project Skills${RESET}`);
    }
    const { successCount, failCount, foundCount } = await updateProjectSkills(options.skills);
    totalSuccess += successCount;
    totalFail += failCount;
    totalFound += foundCount;
  }

  if (options.skills && totalFound === 0) {
    console.log(`${DIM}No installed skills found matching: ${options.skills.join(', ')}${RESET}`);
  }

  console.log();
  if (totalSuccess > 0) {
    console.log(`${TEXT}✓ Updated ${totalSuccess} skill(s)${RESET}`);
  }
  if (totalFail > 0) {
    console.log(`${DIM}Failed to update ${totalFail} skill(s)${RESET}`);
  }

  track({
    event: 'update',
    scope,
    skillCount: String(totalSuccess + totalFail),
    successCount: String(totalSuccess),
    failCount: String(totalFail),
  });
  console.log();
}
