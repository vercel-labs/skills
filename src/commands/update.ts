import { spawnSync } from 'child_process';
import pc from 'picocolors';
import { logger } from '../utils/logger.ts';
import {
  readLockFile,
  fetchCognitiveFolderHash,
  getGitHubToken,
  type CognitiveLockEntry,
} from '../services/lock/lock-file.ts';
import { track } from '../services/telemetry/index.ts';
import { COGNITIVE_FILE_NAMES } from '../core/types.ts';

export async function runUpdate(): Promise<void> {
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

  // Find cognitives that need updates by checking GitHub directly
  const updates: Array<{ name: string; source: string; entry: CognitiveLockEntry }> = [];
  let checkedCount = 0;

  for (const name of cognitiveNames) {
    const entry = lock.cognitives[name];
    if (!entry) continue;

    // Only check GitHub-sourced cognitives with folder hash
    if (entry.sourceType !== 'github' || !entry.cognitiveFolderHash || !entry.cognitivePath) {
      continue;
    }

    checkedCount++;

    try {
      const latestHash = await fetchCognitiveFolderHash(entry.source, entry.cognitivePath, token);

      if (latestHash && latestHash !== entry.cognitiveFolderHash) {
        updates.push({ name, source: entry.source, entry });
      }
    } catch {
      // Skip cognitives that fail to check
    }
  }

  if (checkedCount === 0) {
    logger.dim('No cognitives to check.');
    return;
  }

  if (updates.length === 0) {
    logger.success('All skills are up to date');
    logger.line();
    return;
  }

  logger.log(`Found ${updates.length} update(s)`);
  logger.line();

  // Reinstall each skill that has an update
  let successCount = 0;
  let failCount = 0;

  for (const update of updates) {
    logger.log(`Updating ${update.name}...`);

    // Build the URL with subpath to target the specific skill directory
    // e.g., https://github.com/owner/repo/tree/main/skills/my-skill
    let installUrl = update.entry.sourceUrl;
    if (update.entry.cognitivePath) {
      // Extract the cognitive folder path (remove cognitive file name suffix)
      let skillFolder = update.entry.cognitivePath;
      for (const fileName of Object.values(COGNITIVE_FILE_NAMES)) {
        if (skillFolder.endsWith('/' + fileName)) {
          skillFolder = skillFolder.slice(0, -(fileName.length + 1));
          break;
        } else if (skillFolder.endsWith(fileName)) {
          skillFolder = skillFolder.slice(0, -fileName.length);
          break;
        }
      }
      if (skillFolder.endsWith('/')) {
        skillFolder = skillFolder.slice(0, -1);
      }

      // Convert git URL to tree URL with path
      // https://github.com/owner/repo.git -> https://github.com/owner/repo/tree/main/path
      installUrl = update.entry.sourceUrl.replace(/\.git$/, '').replace(/\/$/, '');
      installUrl = `${installUrl}/tree/main/${skillFolder}`;
    }

    // Use cognit CLI to reinstall with -g -y flags
    const result = spawnSync('npx', ['-y', 'cognit', 'add', installUrl, '-g', '-y'], {
      stdio: ['inherit', 'pipe', 'pipe'],
    });

    if (result.status === 0) {
      successCount++;
      logger.success(`Updated ${update.name}`);
    } else {
      failCount++;
      logger.dim(`\u2717 Failed to update ${update.name}`);
    }
  }

  logger.line();
  if (successCount > 0) {
    logger.success(`Updated ${successCount} cognitive(s)`);
  }
  if (failCount > 0) {
    logger.dim(`Failed to update ${failCount} cognitive(s)`);
  }

  // Track telemetry
  track({
    event: 'update',
    skillCount: String(updates.length),
    successCount: String(successCount),
    failCount: String(failCount),
  });

  logger.line();
}
