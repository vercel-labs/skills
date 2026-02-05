import { readdir, stat, mkdir, rename, readFile, rm } from 'fs/promises';
import { join, dirname, basename } from 'path';
import { homedir } from 'os';
import { TEXT, RESET, DIM } from './cli.ts';
import { SKILLS_SUBDIR } from './constants.ts';
import { parseSource, inferNamespace } from './source-parser.ts';
import { readSkillLock, writeSkillLock } from './skill-lock.ts';
import { getCanonicalSkillsDir } from './installer.ts';

/**
 * Sanitizes a namespace string for safe filesystem usage.
 * Preserves forward slashes for GitHub/GitLab owner/repo format.
 * Limits to 255 chars (common filesystem limit).
 */
export function sanitizeNamespace(name: string): string {
  const sanitized = name
    .toLowerCase()
    // Split by slashes and sanitize each part separately
    .split('/')
    .map((part) => {
      // For each part of the namespace, sanitize it like a filename
      return part.replace(/[^a-z0-9._]+/g, '-').replace(/^[.\-]+|[.\-]+$/g, '');
    })
    .join('/')
    // Remove leading/trailing slashes and dots to prevent path traversal
    .replace(/^[.\-\/]+|[.\-\/]+$/g, '');

  // Fallback to 'legacy' if empty
  return sanitized.substring(0, 255) || 'legacy';
}

/**
 * Determines the namespace for a skill based on lock file, source, or skill metadata.
 */
async function determineNamespace(
  skillName: string,
  skillMdPath: string,
  lock: Awaited<ReturnType<typeof readSkillLock>>
): Promise<string> {
  const lockEntry = lock.skills[skillName];

  // Priority 1: Use namespace from lock file
  if (lockEntry?.namespace) {
    return lockEntry.namespace;
  }

  // Priority 2: Infer from source
  if (lockEntry?.source) {
    const parsedSource = parseSource(lockEntry.source);
    const inferredNs = inferNamespace(parsedSource);
    if (inferredNs) {
      return sanitizeNamespace(inferredNs);
    }
  }

  // Priority 3: Extract from skill metadata
  try {
    const skillContent = await readFile(skillMdPath, 'utf-8');
    const namespaceMatch = skillContent.match(/namespace:\s*(.+)/i);
    if (namespaceMatch && namespaceMatch[1]) {
      return sanitizeNamespace(namespaceMatch[1].trim());
    }
  } catch {
    // Ignore read errors
  }

  // Fallback to 'legacy'
  return 'legacy';
}

/**
 * Checks if a directory is already under a namespace.
 * Returns true if the parent directory is NOT the skills/ directory.
 */
function isAlreadyNamespaced(skillDir: string): boolean {
  const parent = dirname(skillDir);
  return basename(parent) !== SKILLS_SUBDIR;
}

/**
 * Checks if a directory contains a valid skill (has SKILL.md).
 */
async function isValidSkillDirectory(skillDir: string): Promise<boolean> {
  const skillMdPath = join(skillDir, 'SKILL.md');
  try {
    await stat(skillMdPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Compares two skill directories to check if they have the same content.
 * Currently only compares SKILL.md files, normalizing line endings.
 */
async function compareSkillDirectories(dir1: string, dir2: string): Promise<boolean> {
  try {
    const content1 = (await readFile(join(dir1, 'SKILL.md'), 'utf-8')).replace(/\r\n/g, '\n');
    const content2 = (await readFile(join(dir2, 'SKILL.md'), 'utf-8')).replace(/\r\n/g, '\n');
    return content1 === content2;
  } catch {
    return false;
  }
}

/**
 * Removes a directory if it's empty or contains only SKILL.md.
 */
async function removeSkillDirectory(skillDir: string): Promise<void> {
  const entries = await readdir(skillDir);
  // Only remove if directory contains only SKILL.md (or is empty)
  const safeToRemove = entries.length === 0 || (entries.length === 1 && entries[0] === 'SKILL.md');
  if (safeToRemove) {
    await rm(skillDir, { recursive: true, force: true });
  }
}

/**
 * Migrates a single skill to a namespace-based structure.
 */
async function migrateSkill(
  skillName: string,
  skillDir: string,
  namespace: string,
  scopePath: string,
  dryRun: boolean,
  lockEntry?: Awaited<ReturnType<typeof readSkillLock>>['skills'][string]
): Promise<{
  skillName: string;
  oldPath: string;
  newPath: string;
  namespace: string;
  scope: 'global' | 'project';
  status: 'migrated' | 'skipped' | 'error';
  error?: string;
}> {
  const newPath = join(scopePath, namespace, skillName);
  const isGlobal = scopePath.includes(homedir());

  // Check if destination already exists
  try {
    await stat(newPath);
    // Destination exists - check if it's the same skill
    const isSameContent = await compareSkillDirectories(skillDir, newPath);
    if (isSameContent) {
      if (dryRun) {
        return {
          skillName,
          oldPath: skillDir,
          newPath,
          namespace,
          scope: isGlobal ? 'global' : 'project',
          status: 'migrated',
          error: 'Dry run - would clean up duplicate',
        };
      }
      // Same skill already migrated - clean up the old directory
      try {
        await removeSkillDirectory(skillDir);
      } catch {
        // Ignore cleanup errors (e.g., directory locked on Windows)
        // The skill is already migrated, so this is not a failure
      }
      return {
        skillName,
        oldPath: skillDir,
        newPath,
        namespace,
        scope: isGlobal ? 'global' : 'project',
        status: 'migrated',
      };
    }
    // Different skill - conflict
    return {
      skillName,
      oldPath: skillDir,
      newPath,
      namespace,
      scope: isGlobal ? 'global' : 'project',
      status: 'error',
      error: 'Destination already exists with different content',
    };
  } catch {
    // Destination doesn't exist, continue
  }

  // Dry run mode
  if (dryRun) {
    return {
      skillName,
      oldPath: skillDir,
      newPath,
      namespace,
      scope: isGlobal ? 'global' : 'project',
      status: 'skipped',
      error: 'Dry run - no changes made',
    };
  }

  // Perform migration
  try {
    // Create namespace directory
    await mkdir(dirname(newPath), { recursive: true });

    // Move the directory
    await rename(skillDir, newPath);

    // Verify the move was successful
    try {
      await stat(newPath);
      await stat(skillDir); // Should fail if move was successful
      // If we get here, the old path still exists - this is an error
      throw new Error('Move operation did not complete successfully');
    } catch (statError) {
      // Expected: stat(skillDir) should fail
      if ((statError as { code?: string }).code !== 'ENOENT') {
        throw statError;
      }
    }

    // Update lock file entry
    if (lockEntry) {
      lockEntry.namespace = namespace;
    }

    return {
      skillName,
      oldPath: skillDir,
      newPath,
      namespace,
      scope: isGlobal ? 'global' : 'project',
      status: 'migrated',
    };
  } catch (error) {
    // If directory is locked/busy, skip gracefully
    const errorCode = (error as { code?: string }).code;
    if (errorCode === 'EBUSY' || errorCode === 'EPERM' || errorCode === 'ACCESS') {
      return {
        skillName,
        oldPath: skillDir,
        newPath,
        namespace,
        scope: isGlobal ? 'global' : 'project',
        status: 'skipped',
        error: 'Directory is locked or in use - skipped',
      };
    }
    return {
      skillName,
      oldPath: skillDir,
      newPath,
      namespace,
      scope: isGlobal ? 'global' : 'project',
      status: 'error',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Processes all legacy skills in a given scope (global or project).
 */
async function processScope(
  scope: { global: boolean; path: string },
  lock: Awaited<ReturnType<typeof readSkillLock>>,
  dryRun: boolean
): Promise<
  Array<{
    skillName: string;
    oldPath: string;
    newPath: string;
    namespace: string;
    scope: 'global' | 'project';
    status: 'migrated' | 'skipped' | 'error';
    error?: string;
  }>
> {
  const results: Array<{
    skillName: string;
    oldPath: string;
    newPath: string;
    namespace: string;
    scope: 'global' | 'project';
    status: 'migrated' | 'skipped' | 'error';
    error?: string;
  }> = [];

  try {
    const entries = await readdir(scope.path, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const skillDir = join(scope.path, entry.name);
      const skillMdPath = join(skillDir, 'SKILL.md');

      // Skip if not a valid skill directory
      if (!(await isValidSkillDirectory(skillDir))) {
        continue;
      }

      // Skip if already under a namespace
      const skillName = entry.name;
      if (isAlreadyNamespaced(skillDir)) {
        continue;
      }

      // Determine namespace
      const namespace = await determineNamespace(skillName, skillMdPath, lock);

      // Migrate the skill
      const result = await migrateSkill(
        skillName,
        skillDir,
        namespace,
        scope.path,
        dryRun,
        lock.skills[skillName]
      );

      results.push(result);

      // Log result
      if (result.status === 'migrated') {
        if (dryRun) {
          console.log(`${DIM}↷${RESET} Would migrate ${skillName} to ${namespace}/${skillName}`);
        } else {
          console.log(`${TEXT}✓${RESET} Migrated ${skillName} to ${namespace}/${skillName}`);
        }
      } else if (result.status === 'error') {
        console.log(`${DIM}✗${RESET} Failed to migrate ${skillName}: ${result.error}`);
      }
    }
  } catch (error) {
    // Directory doesn't exist or can't be read
    console.log(
      `${DIM}Note: ${scope.global ? 'Global' : 'Project'} skills directory not found or inaccessible${RESET}`
    );
  }

  return results;
}

/**
 * Prints migration summary.
 */
function printMigrationSummary(
  results: Array<{
    skillName: string;
    oldPath: string;
    newPath: string;
    namespace: string;
    scope: 'global' | 'project';
    status: 'migrated' | 'skipped' | 'error';
    error?: string;
  }>
): void {
  console.log();
  console.log(`${TEXT}Migration Summary:${RESET}`);

  const migratedCount = results.filter((r) => r.status === 'migrated').length;
  const skippedCount = results.filter((r) => r.status === 'skipped').length;
  const errorCount = results.filter((r) => r.status === 'error').length;

  console.log(`  ${TEXT}✓${RESET} Migrated: ${migratedCount}`);
  console.log(`  ${DIM}↷${RESET} Skipped: ${skippedCount}`);
  console.log(`  ${DIM}✗${RESET} Errors: ${errorCount}`);

  if (errorCount > 0) {
    console.log();
    console.log(`${TEXT}Skills with errors:${RESET}`);
    results
      .filter((r) => r.status === 'error')
      .forEach((r) => {
        console.log(`  ${DIM}•${RESET} ${r.skillName}: ${r.error}`);
      });
  }

  console.log();
  console.log(`${TEXT}Migration completed!${RESET}`);
  console.log();
}

/**
 * Main entry point for the merge-with-namespace command.
 */
export async function runMergeWithNamespace(args: string[] = []): Promise<void> {
  console.log(`${TEXT}Migrating existing skills to namespace-based structure...${RESET}`);
  console.log();

  // Parse options
  const global = args.includes('-g') || args.includes('--global');
  const yes = args.includes('-y') || args.includes('--yes');
  const dryRun = args.includes('--dry-run');

  // Get canonical skills directories to scan
  const scopes: Array<{ global: boolean; path: string }> = [];
  if (global) {
    // Only scan global
    scopes.push({ global: true, path: getCanonicalSkillsDir(true) });
  } else {
    // Scan both project and global by default
    const cwd = process.cwd();
    scopes.push({ global: false, path: getCanonicalSkillsDir(false, cwd) });
    scopes.push({ global: true, path: getCanonicalSkillsDir(true) });
  }

  // Read lock file
  const lock = await readSkillLock();

  // Process each scope and collect results
  const results: Array<{
    skillName: string;
    oldPath: string;
    newPath: string;
    namespace: string;
    scope: 'global' | 'project';
    status: 'migrated' | 'skipped' | 'error';
    error?: string;
  }> = [];

  for (const scope of scopes) {
    const scopeResults = await processScope(scope, lock, dryRun);
    results.push(...scopeResults);
  }

  // Update lock file if changes were made
  if (!dryRun && results.some((r) => r.status === 'migrated')) {
    await writeSkillLock(lock);
    console.log(`${TEXT}✓ Lock file updated${RESET}`);
  }

  // Print summary
  printMigrationSummary(results);
}
