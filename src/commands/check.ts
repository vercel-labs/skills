import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import pc from 'picocolors';
import { logger } from '../utils/logger.ts';
import { fetchSkillFolderHash, getGitHubToken } from '../services/lock/lock-file.ts';
import { track } from '../services/telemetry/index.ts';

const AGENTS_DIR = '.agents';
const LOCK_FILE = '.synk-lock.json';
const CURRENT_LOCK_VERSION = 4; // Bumped from 3 to 4 for cognitiveType support

interface CognitiveLockEntry {
  source: string;
  sourceType: string;
  sourceUrl: string;
  cognitivePath?: string;
  /** GitHub tree SHA for the entire cognitive folder */
  cognitiveFolderHash: string;
  installedAt: string;
  updatedAt: string;
}

interface CognitiveLockFile {
  version: number;
  cognitives: Record<string, CognitiveLockEntry>;
}

function getLockFilePath(): string {
  return join(homedir(), AGENTS_DIR, LOCK_FILE);
}

function readLockFile(): CognitiveLockFile {
  const lockPath = getLockFilePath();
  try {
    const content = readFileSync(lockPath, 'utf-8');
    const parsed = JSON.parse(content) as CognitiveLockFile;
    if (typeof parsed.version !== 'number' || !parsed.cognitives) {
      return { version: CURRENT_LOCK_VERSION, cognitives: {} };
    }
    // If old version, wipe and start fresh (backwards incompatible change)
    if (parsed.version < CURRENT_LOCK_VERSION) {
      return { version: CURRENT_LOCK_VERSION, cognitives: {} };
    }
    return parsed;
  } catch {
    return { version: CURRENT_LOCK_VERSION, cognitives: {} };
  }
}

export async function runCheck(args: string[] = []): Promise<void> {
  logger.log('Checking for updates...');
  logger.line();

  const lock = readLockFile();
  const cognitiveNames = Object.keys(lock.cognitives);

  if (cognitiveNames.length === 0) {
    logger.dim('No cognitives tracked in lock file.');
    logger.log(`${pc.dim('Install cognitives with')} npx synk add <package>`);
    return;
  }

  // Get GitHub token from user's environment for higher rate limits
  const token = getGitHubToken();

  // Group cognitives by source (owner/repo) to batch GitHub API calls
  const cognitivesBySource = new Map<string, Array<{ name: string; entry: CognitiveLockEntry }>>();
  let skippedCount = 0;

  for (const name of cognitiveNames) {
    const entry = lock.cognitives[name];
    if (!entry) continue;

    // Only check GitHub-sourced cognitives with folder hash
    if (entry.sourceType !== 'github' || !entry.cognitiveFolderHash || !entry.cognitivePath) {
      skippedCount++;
      continue;
    }

    const existing = cognitivesBySource.get(entry.source) || [];
    existing.push({ name, entry });
    cognitivesBySource.set(entry.source, existing);
  }

  const totalCognitives = cognitiveNames.length - skippedCount;
  if (totalCognitives === 0) {
    logger.dim('No GitHub cognitives to check.');
    return;
  }

  logger.dim(`Checking ${totalCognitives} cognitive(s) for updates...`);

  const updates: Array<{ name: string; source: string }> = [];
  const errors: Array<{ name: string; source: string; error: string }> = [];

  // Check each source (one API call per repo)
  for (const [source, cognitives] of cognitivesBySource) {
    for (const { name, entry } of cognitives) {
      try {
        const latestHash = await fetchSkillFolderHash(source, entry.cognitivePath!, token);

        if (!latestHash) {
          errors.push({ name, source, error: 'Could not fetch from GitHub' });
          continue;
        }

        if (latestHash !== entry.cognitiveFolderHash) {
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
    logger.success('All cognitives are up to date');
  } else {
    logger.log(`${updates.length} update(s) available:`);
    logger.line();
    for (const update of updates) {
      logger.log(`  ${pc.cyan('\u2191')} ${update.name}`);
      logger.dim(`    source: ${update.source}`);
    }
    logger.line();
    logger.log(`${pc.dim('Run')} npx synk update ${pc.dim('to update all cognitives')}`);
  }

  if (errors.length > 0) {
    logger.line();
    logger.dim(`Could not check ${errors.length} cognitive(s) (may need reinstall)`);
  }

  // Track telemetry
  track({
    event: 'check',
    skillCount: String(totalCognitives),
    updatesAvailable: String(updates.length),
  });

  logger.line();
}
