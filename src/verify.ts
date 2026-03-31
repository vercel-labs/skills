import * as p from '@clack/prompts';
import pc from 'picocolors';
import { existsSync } from 'fs';
import { readdir } from 'fs/promises';
import { join } from 'path';
import { readLocalLock, computeSkillFolderHash } from './local-lock.ts';
import { getCanonicalSkillsDir, getCanonicalPath } from './installer.ts';

type VerifyStatus = 'match' | 'modified' | 'missing' | 'unlocked';

interface VerifyResult {
  name: string;
  status: VerifyStatus;
  lockHash?: string;
  actualHash?: string;
}

/**
 * Verify installed skills against the local lockfile.
 * Reports matches, modifications, missing skills, and unlocked skills.
 * Exit code 0 if all match, 1 if any issues found.
 */
export async function runVerify(args: string[]): Promise<void> {
  const cwd = process.cwd();
  const lock = await readLocalLock(cwd);
  const lockedSkills = lock.skills;
  const lockedNames = new Set(Object.keys(lockedSkills));

  const results: VerifyResult[] = [];

  console.log();
  p.log.info('Verifying installed skills against lockfile...');
  console.log();

  // Check each locked skill
  for (const [skillName, entry] of Object.entries(lockedSkills)) {
    const canonicalPath = getCanonicalPath(skillName, { cwd });

    if (!existsSync(canonicalPath)) {
      results.push({ name: skillName, status: 'missing', lockHash: entry.computedHash });
      continue;
    }

    try {
      const actualHash = await computeSkillFolderHash(canonicalPath);
      if (actualHash === entry.computedHash) {
        results.push({
          name: skillName,
          status: 'match',
          lockHash: entry.computedHash,
          actualHash,
        });
      } else {
        results.push({
          name: skillName,
          status: 'modified',
          lockHash: entry.computedHash,
          actualHash,
        });
      }
    } catch {
      results.push({ name: skillName, status: 'missing', lockHash: entry.computedHash });
    }
  }

  // Scan for installed skills not in lockfile
  const canonicalDir = getCanonicalSkillsDir(false, cwd);
  if (existsSync(canonicalDir)) {
    try {
      const entries = await readdir(canonicalDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && !lockedNames.has(entry.name)) {
          const skillDir = join(canonicalDir, entry.name);
          // Only count directories that contain a SKILL.md
          if (existsSync(join(skillDir, 'SKILL.md'))) {
            results.push({ name: entry.name, status: 'unlocked' });
          }
        }
      }
    } catch {
      // canonical dir doesn't exist or can't be read
    }
  }

  // Sort: match, modified, missing, unlocked
  const statusOrder: Record<VerifyStatus, number> = {
    match: 0,
    modified: 1,
    missing: 2,
    unlocked: 3,
  };
  results.sort(
    (a, b) => statusOrder[a.status] - statusOrder[b.status] || a.name.localeCompare(b.name)
  );

  // Display results
  const statusLabels: Record<VerifyStatus, string> = {
    match: pc.green('[match]   '),
    modified: pc.yellow('[modified]'),
    missing: pc.red('[missing] '),
    unlocked: pc.dim('[unlocked]'),
  };

  const statusMessages: Record<VerifyStatus, string> = {
    match: 'content matches lockfile',
    modified: 'content modified locally (hash mismatch)',
    missing: 'in lockfile but not installed',
    unlocked: 'installed but not in lockfile',
  };

  for (const result of results) {
    console.log(
      `  ${statusLabels[result.status]} ${pc.bold(result.name)}  ${pc.dim(statusMessages[result.status])}`
    );
  }

  // Summary
  const counts: Record<VerifyStatus, number> = { match: 0, modified: 0, missing: 0, unlocked: 0 };
  for (const result of results) {
    counts[result.status]++;
  }

  console.log();

  const parts: string[] = [];
  if (counts.match > 0) parts.push(pc.green(`${counts.match} match`));
  if (counts.modified > 0) parts.push(pc.yellow(`${counts.modified} modified`));
  if (counts.missing > 0) parts.push(pc.red(`${counts.missing} missing`));
  if (counts.unlocked > 0) parts.push(pc.dim(`${counts.unlocked} unlocked`));

  if (results.length === 0) {
    p.log.warn('No skills found in lockfile or installed.');
    p.log.info(
      `Add project-level skills with ${pc.cyan('npx skills add <package>')} (without ${pc.cyan('-g')})`
    );
    return;
  }

  p.log.info(`Result: ${parts.join(', ')}`);

  // Exit code 1 if any mismatches or missing
  if (counts.modified > 0 || counts.missing > 0) {
    process.exit(1);
  }
}
