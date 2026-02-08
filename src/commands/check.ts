import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import pc from 'picocolors';
import { logger } from '../utils/logger.ts';
import { fetchSkillFolderHash, getGitHubToken } from '../services/lock/lock-file.ts';
import { track } from '../services/telemetry/index.ts';

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

export async function runCheck(args: string[] = []): Promise<void> {
  logger.log(`Checking for skill updates...`);
  logger.line();

  const lock = readSkillLock();
  const skillNames = Object.keys(lock.skills);

  if (skillNames.length === 0) {
    logger.dim('No skills tracked in lock file.');
    logger.log(`${pc.dim('Install skills with')} npx synk add <package>`);
    return;
  }

  // Get GitHub token from user's environment for higher rate limits
  const token = getGitHubToken();

  // Group skills by source (owner/repo) to batch GitHub API calls
  const skillsBySource = new Map<string, Array<{ name: string; entry: SkillLockEntry }>>();
  let skippedCount = 0;

  for (const skillName of skillNames) {
    const entry = lock.skills[skillName];
    if (!entry) continue;

    // Only check GitHub-sourced skills with folder hash
    if (entry.sourceType !== 'github' || !entry.skillFolderHash || !entry.skillPath) {
      skippedCount++;
      continue;
    }

    const existing = skillsBySource.get(entry.source) || [];
    existing.push({ name: skillName, entry });
    skillsBySource.set(entry.source, existing);
  }

  const totalSkills = skillNames.length - skippedCount;
  if (totalSkills === 0) {
    logger.dim('No GitHub skills to check.');
    return;
  }

  logger.dim(`Checking ${totalSkills} skill(s) for updates...`);

  const updates: Array<{ name: string; source: string }> = [];
  const errors: Array<{ name: string; source: string; error: string }> = [];

  // Check each source (one API call per repo)
  for (const [source, skills] of skillsBySource) {
    for (const { name, entry } of skills) {
      try {
        const latestHash = await fetchSkillFolderHash(source, entry.skillPath!, token);

        if (!latestHash) {
          errors.push({ name, source, error: 'Could not fetch from GitHub' });
          continue;
        }

        if (latestHash !== entry.skillFolderHash) {
          updates.push({ name, source });
        }
      } catch (err) {
        errors.push({
          name,
          source,
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }
  }

  logger.line();

  if (updates.length === 0) {
    logger.success('All skills are up to date');
  } else {
    logger.log(`${updates.length} update(s) available:`);
    logger.line();
    for (const update of updates) {
      logger.log(`  ${pc.cyan('\u2191')} ${update.name}`);
      logger.dim(`    source: ${update.source}`);
    }
    logger.line();
    logger.log(`${pc.dim('Run')} npx synk update ${pc.dim('to update all skills')}`);
  }

  if (errors.length > 0) {
    logger.line();
    logger.dim(`Could not check ${errors.length} skill(s) (may need reinstall)`);
  }

  // Track telemetry
  track({
    event: 'check',
    skillCount: String(totalSkills),
    updatesAvailable: String(updates.length),
  });

  logger.line();
}
