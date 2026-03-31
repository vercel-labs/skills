import * as p from '@clack/prompts';
import pc from 'picocolors';
import { readLocalLock, computeSkillFolderHash } from './local-lock.ts';
import { runAdd } from './add.ts';
import { runSync, parseSyncOptions } from './sync.ts';
import { getUniversalAgents } from './agents.ts';
import { getCanonicalPath } from './installer.ts';
import { existsSync } from 'fs';

interface InstallFromLockOptions {
  frozenLockfile?: boolean;
}

function parseInstallOptions(args: string[]): {
  restArgs: string[];
  options: InstallFromLockOptions;
} {
  const options: InstallFromLockOptions = {};
  const restArgs: string[] = [];

  for (const arg of args) {
    if (arg === '--frozen-lockfile' || arg === '--frozen') {
      options.frozenLockfile = true;
    } else {
      restArgs.push(arg);
    }
  }

  return { restArgs, options };
}

/**
 * Install all skills from the local skills-lock.json.
 * Groups skills by source and calls `runAdd` for each group.
 *
 * Only installs to .agents/skills/ (universal agents) -- the canonical
 * project-level location. Does not install to agent-specific directories.
 *
 * node_modules skills are handled via experimental_sync.
 */
export async function runInstallFromLock(args: string[]): Promise<void> {
  const { restArgs, options } = parseInstallOptions(args);
  const cwd = process.cwd();
  const lock = await readLocalLock(cwd);
  const skillEntries = Object.entries(lock.skills);

  if (skillEntries.length === 0) {
    p.log.warn('No project skills found in skills-lock.json');
    p.log.info(
      `Add project-level skills with ${pc.cyan('npx skills add <package>')} (without ${pc.cyan('-g')})`
    );
    return;
  }

  // Only install to .agents/skills/ (universal agents)
  const universalAgentNames = getUniversalAgents();

  // Separate node_modules skills from remote skills
  const nodeModuleSkills: string[] = [];
  const bySource = new Map<string, { sourceType: string; skills: string[] }>();

  for (const [skillName, entry] of skillEntries) {
    if (entry.sourceType === 'node_modules') {
      nodeModuleSkills.push(skillName);
      continue;
    }

    const installSource = entry.ref ? `${entry.source}#${entry.ref}` : entry.source;
    const existing = bySource.get(installSource);
    if (existing) {
      existing.skills.push(skillName);
    } else {
      bySource.set(installSource, {
        sourceType: entry.sourceType,
        skills: [skillName],
      });
    }
  }

  const remoteCount = skillEntries.length - nodeModuleSkills.length;
  if (remoteCount > 0) {
    p.log.info(
      `Restoring ${pc.cyan(String(remoteCount))} skill${remoteCount !== 1 ? 's' : ''} from skills-lock.json into ${pc.dim('.agents/skills/')}`
    );
  }

  // Install remote skills grouped by source
  for (const [source, { skills }] of bySource) {
    try {
      await runAdd([source], {
        skill: skills,
        agent: universalAgentNames,
        yes: true,
      });
    } catch (error) {
      p.log.error(
        `Failed to install from ${pc.cyan(source)}: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  // Handle node_modules skills via sync
  if (nodeModuleSkills.length > 0) {
    p.log.info(
      `${pc.cyan(String(nodeModuleSkills.length))} skill${nodeModuleSkills.length !== 1 ? 's' : ''} from node_modules`
    );
    try {
      const { options: syncOptions } = parseSyncOptions(restArgs);
      await runSync(restArgs, { ...syncOptions, yes: true, agent: universalAgentNames });
    } catch (error) {
      p.log.error(
        `Failed to sync node_modules skills: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  // Frozen lockfile: verify installed content matches lock hashes
  if (options.frozenLockfile) {
    await verifyInstalledMatchesLock(cwd, lock.skills);
  }
}

/**
 * After installation, verify that each installed skill's content hash
 * matches the computedHash in the lock file. Exits with code 1 on mismatch.
 */
async function verifyInstalledMatchesLock(
  cwd: string,
  lockedSkills: Record<string, { computedHash: string }>
): Promise<void> {
  const mismatches: Array<{ name: string; expected: string; actual: string }> = [];
  const missing: string[] = [];

  for (const [skillName, entry] of Object.entries(lockedSkills)) {
    const canonicalPath = getCanonicalPath(skillName, { cwd });

    if (!existsSync(canonicalPath)) {
      missing.push(skillName);
      continue;
    }

    try {
      const actualHash = await computeSkillFolderHash(canonicalPath);
      if (actualHash !== entry.computedHash) {
        mismatches.push({ name: skillName, expected: entry.computedHash, actual: actualHash });
      }
    } catch {
      missing.push(skillName);
    }
  }

  if (mismatches.length === 0 && missing.length === 0) {
    p.log.success('All installed skills match lockfile hashes');
    return;
  }

  if (mismatches.length > 0) {
    p.log.error(`${mismatches.length} skill(s) have content that differs from lockfile:`);
    for (const m of mismatches) {
      console.log(`  ${pc.red('✗')} ${m.name}`);
      console.log(`    ${pc.dim('expected:')} ${m.expected.slice(0, 12)}...`);
      console.log(`    ${pc.dim('actual:  ')} ${m.actual.slice(0, 12)}...`);
    }
  }

  if (missing.length > 0) {
    p.log.error(`${missing.length} skill(s) in lockfile but not installed:`);
    for (const name of missing) {
      console.log(`  ${pc.red('✗')} ${name}`);
    }
  }

  process.exit(1);
}
