import pc from 'picocolors';
import { logger } from '../utils/logger.ts';
import {
  readLockFile,
  fetchCognitiveFolderHash,
  getGitHubToken,
  type CognitiveLockEntry,
} from '../services/lock/lock-file.ts';
import { track } from '../services/telemetry/index.ts';

export async function runCheck(args: string[] = []): Promise<void> {
  logger.log('Checking for updates...');
  logger.line();

  const lock = await readLockFile();
  const cognitiveNames = Object.keys(lock.cognitives);

  if (cognitiveNames.length === 0) {
    logger.dim('No cognitives tracked in lock file.');
    logger.log(`${pc.dim('Install cognitives with')} npx cognit add <package>`);
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
        const latestHash = await fetchCognitiveFolderHash(source, entry.cognitivePath!, token);

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
    logger.log(`${pc.dim('Run')} npx cognit update ${pc.dim('to update all cognitives')}`);
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
