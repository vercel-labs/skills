import { spawnSync } from 'child_process';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { fetchSkillFolderHash, getGitHubToken } from '../services/lock/lock-file.ts';
import { track } from '../services/telemetry/index.ts';

const RESET = '\x1b[0m';
const DIM = '\x1b[38;5;102m'; // darker gray for secondary text
const TEXT = '\x1b[38;5;145m'; // lighter gray for primary text

const AGENTS_DIR = '.agents';
const LOCK_FILE = '.skill-lock.json';
const CURRENT_LOCK_VERSION = 4; // Bumped from 3 to 4 for cognitiveType support

interface SkillLockEntry {
  source: string;
  sourceType: string;
  sourceUrl: string;
  skillPath?: string;
  /** GitHub tree SHA for the entire skill folder (v3) */
  skillFolderHash: string;
  installedAt: string;
  updatedAt: string;
}

interface SkillLockFile {
  version: number;
  skills: Record<string, SkillLockEntry>;
}

function getSkillLockPath(): string {
  return join(homedir(), AGENTS_DIR, LOCK_FILE);
}

function readSkillLock(): SkillLockFile {
  const lockPath = getSkillLockPath();
  try {
    const content = readFileSync(lockPath, 'utf-8');
    const parsed = JSON.parse(content) as SkillLockFile;
    if (typeof parsed.version !== 'number' || !parsed.skills) {
      return { version: CURRENT_LOCK_VERSION, skills: {} };
    }
    // If old version, wipe and start fresh (backwards incompatible change)
    // v3 adds skillFolderHash - we want fresh installs to populate it
    if (parsed.version < CURRENT_LOCK_VERSION) {
      return { version: CURRENT_LOCK_VERSION, skills: {} };
    }
    return parsed;
  } catch {
    return { version: CURRENT_LOCK_VERSION, skills: {} };
  }
}

export async function runUpdate(): Promise<void> {
  console.log(`${TEXT}Checking for skill updates...${RESET}`);
  console.log();

  const lock = readSkillLock();
  const skillNames = Object.keys(lock.skills);

  if (skillNames.length === 0) {
    console.log(`${DIM}No skills tracked in lock file.${RESET}`);
    console.log(`${DIM}Install skills with${RESET} ${TEXT}npx synk add <package>${RESET}`);
    return;
  }

  // Get GitHub token from user's environment for higher rate limits
  const token = getGitHubToken();

  // Find skills that need updates by checking GitHub directly
  const updates: Array<{ name: string; source: string; entry: SkillLockEntry }> = [];
  let checkedCount = 0;

  for (const skillName of skillNames) {
    const entry = lock.skills[skillName];
    if (!entry) continue;

    // Only check GitHub-sourced skills with folder hash
    if (entry.sourceType !== 'github' || !entry.skillFolderHash || !entry.skillPath) {
      continue;
    }

    checkedCount++;

    try {
      const latestHash = await fetchSkillFolderHash(entry.source, entry.skillPath, token);

      if (latestHash && latestHash !== entry.skillFolderHash) {
        updates.push({ name: skillName, source: entry.source, entry });
      }
    } catch {
      // Skip skills that fail to check
    }
  }

  if (checkedCount === 0) {
    console.log(`${DIM}No skills to check.${RESET}`);
    return;
  }

  if (updates.length === 0) {
    console.log(`${TEXT}\u2713 All skills are up to date${RESET}`);
    console.log();
    return;
  }

  console.log(`${TEXT}Found ${updates.length} update(s)${RESET}`);
  console.log();

  // Reinstall each skill that has an update
  let successCount = 0;
  let failCount = 0;

  for (const update of updates) {
    console.log(`${TEXT}Updating ${update.name}...${RESET}`);

    // Build the URL with subpath to target the specific skill directory
    // e.g., https://github.com/owner/repo/tree/main/skills/my-skill
    let installUrl = update.entry.sourceUrl;
    if (update.entry.skillPath) {
      // Extract the skill folder path (remove /SKILL.md suffix)
      let skillFolder = update.entry.skillPath;
      if (skillFolder.endsWith('/SKILL.md')) {
        skillFolder = skillFolder.slice(0, -9);
      } else if (skillFolder.endsWith('SKILL.md')) {
        skillFolder = skillFolder.slice(0, -8);
      }
      if (skillFolder.endsWith('/')) {
        skillFolder = skillFolder.slice(0, -1);
      }

      // Convert git URL to tree URL with path
      // https://github.com/owner/repo.git -> https://github.com/owner/repo/tree/main/path
      installUrl = update.entry.sourceUrl.replace(/\.git$/, '').replace(/\/$/, '');
      installUrl = `${installUrl}/tree/main/${skillFolder}`;
    }

    // Use skills CLI to reinstall with -g -y flags
    const result = spawnSync('npx', ['-y', 'skills', 'add', installUrl, '-g', '-y'], {
      stdio: ['inherit', 'pipe', 'pipe'],
    });

    if (result.status === 0) {
      successCount++;
      console.log(`  ${TEXT}\u2713${RESET} Updated ${update.name}`);
    } else {
      failCount++;
      console.log(`  ${DIM}\u2717 Failed to update ${update.name}${RESET}`);
    }
  }

  console.log();
  if (successCount > 0) {
    console.log(`${TEXT}\u2713 Updated ${successCount} skill(s)${RESET}`);
  }
  if (failCount > 0) {
    console.log(`${DIM}Failed to update ${failCount} skill(s)${RESET}`);
  }

  // Track telemetry
  track({
    event: 'update',
    skillCount: String(updates.length),
    successCount: String(successCount),
    failCount: String(failCount),
  });

  console.log();
}
