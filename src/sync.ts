import * as p from '@clack/prompts';
import pc from 'picocolors';
import { readdir, stat } from 'fs/promises';
import { join, sep } from 'path';
import { homedir } from 'os';
import { parseSkillMd } from './skills.ts';
import {
  detectInstalledAgents,
  agents,
  getUniversalAgents,
  getNonUniversalAgents,
} from './agents.ts';
import { searchMultiselect } from './prompts/search-multiselect.ts';
import { addSkillToLocalLock, computeSkillFolderHash, readLocalLock } from './local-lock.ts';
import type { AgentType } from './types.ts';
import { track } from './telemetry.ts';
import { getLastSelectedAgents, saveSelectedAgents } from './skill-lock.ts';
import {
  type NpmSkill,
  createTargetName,
  sanitizePackageName,
  getPackageDeps,
  searchForWorkspaceRoot,
  getWorkspacePackageRoots,
  filterNpmSkills,
  createSkillSymlink,
  cleanupStaleNpmSkills,
} from './sync-utils.ts';
import { updateGitignore } from './gitignore.ts';

const isCancelled = (value: unknown): value is symbol => typeof value === 'symbol';

export interface SyncOptions {
  agent?: string[];
  yes?: boolean;
  force?: boolean;
  source?: 'node_modules' | 'package.json';
  recursive?: boolean;
  include?: string[];
  exclude?: string[];
  dryRun?: boolean;
  cleanup?: boolean;
  gitignore?: boolean;
}

function shortenPath(fullPath: string, cwd: string): string {
  const home = homedir();
  if (fullPath === home || fullPath.startsWith(home + sep)) {
    return '~' + fullPath.slice(home.length);
  }
  if (fullPath === cwd || fullPath.startsWith(cwd + sep)) {
    return '.' + fullPath.slice(cwd.length);
  }
  return fullPath;
}

/**
 * Scan a single node_modules directory for skills.
 * For each package, checks:
 *   1. SKILL.md at package root (single-skill package, skips subdirectory scan)
 *   2. Subdirectories of: package root, skills/, dist/skills/, .agents/skills/
 */
async function scanNodeModulesDir(
  cwd: string,
  source: 'node_modules' | 'package.json' = 'package.json'
): Promise<NpmSkill[]> {
  const nodeModulesDir = join(cwd, 'node_modules');
  const skills: NpmSkill[] = [];
  const seenTargetNames = new Set<string>();

  const packageDeps = source === 'package.json' ? await getPackageDeps(cwd) : null;

  let topNames: string[];
  try {
    topNames = await readdir(nodeModulesDir);
  } catch {
    return skills;
  }

  const addSkill = (skill: NpmSkill) => {
    if (!seenTargetNames.has(skill.targetName)) {
      seenTargetNames.add(skill.targetName);
      skills.push(skill);
    }
  };

  const processPackageDir = async (pkgDir: string, packageName: string) => {
    // 1. Check for SKILL.md at package root (simple single-skill package)
    const rootSkill = await parseSkillMd(join(pkgDir, 'SKILL.md'));
    if (rootSkill) {
      addSkill({
        packageName,
        skillName: sanitizePackageName(packageName),
        skillPath: rootSkill.path,
        targetName: createTargetName(packageName),
        name: rootSkill.name,
        description: rootSkill.description,
      });
      return;
    }

    // 2. Scan subdirectories of common skill locations
    const searchDirs = [
      pkgDir,
      join(pkgDir, 'skills'),
      join(pkgDir, 'dist', 'skills'),
      join(pkgDir, '.agents', 'skills'),
    ];

    for (const searchDir of searchDirs) {
      try {
        const entries = await readdir(searchDir);
        for (const name of entries) {
          const skillDir = join(searchDir, name);
          try {
            const s = await stat(skillDir);
            if (!s.isDirectory()) continue;
          } catch {
            continue;
          }
          const skill = await parseSkillMd(join(skillDir, 'SKILL.md'));
          if (skill) {
            addSkill({
              packageName,
              skillName: name,
              skillPath: skill.path,
              targetName: createTargetName(packageName, name),
              name: skill.name,
              description: skill.description,
            });
          }
        }
      } catch {
        // Directory doesn't exist
      }
    }
  };

  await Promise.all(
    topNames.map(async (name) => {
      if (name.startsWith('.')) return;

      const fullPath = join(nodeModulesDir, name);
      try {
        const s = await stat(fullPath);
        if (!s.isDirectory()) return;
      } catch {
        return;
      }

      if (name.startsWith('@')) {
        try {
          const scopeNames = await readdir(fullPath);
          await Promise.all(
            scopeNames.map(async (scopedName) => {
              const scopedPath = join(fullPath, scopedName);
              const fullPackageName = `${name}/${scopedName}`;

              if (packageDeps && !packageDeps.includes(fullPackageName)) return;

              try {
                const s = await stat(scopedPath);
                if (!s.isDirectory()) return;
              } catch {
                return;
              }
              await processPackageDir(scopedPath, fullPackageName);
            })
          );
        } catch {
          // Scope directory not readable
        }
      } else {
        if (packageDeps && !packageDeps.includes(name)) return;
        await processPackageDir(fullPath, name);
      }
    })
  );

  return skills;
}

/**
 * Discover npm skills from node_modules.
 * Supports --source filtering and --recursive monorepo scanning.
 */
async function discoverNodeModuleSkills(
  cwd: string,
  options: { source?: 'node_modules' | 'package.json'; recursive?: boolean } = {}
): Promise<NpmSkill[]> {
  const source = options.source || 'package.json';

  if (!options.recursive) {
    return scanNodeModulesDir(cwd, source);
  }

  // Recursive mode: find workspace root and scan all package roots
  const workspaceRoot = searchForWorkspaceRoot(cwd);
  const packageRoots = await getWorkspacePackageRoots(workspaceRoot);
  const allRoots = [workspaceRoot, ...packageRoots];

  const allSkills = new Map<string, NpmSkill>();

  for (const root of allRoots) {
    const skills = await scanNodeModulesDir(root, source);
    for (const skill of skills) {
      if (!allSkills.has(skill.targetName)) {
        allSkills.set(skill.targetName, skill);
      }
    }
  }

  return Array.from(allSkills.values());
}

export async function runSync(_args: string[], options: SyncOptions = {}): Promise<void> {
  const cwd = process.cwd();

  console.log();
  p.intro(pc.bgCyan(pc.black(' skills experimental_sync ')));

  const spinner = p.spinner();

  // 1. Discover skills from node_modules
  spinner.start('Scanning node_modules for skills...');
  let discoveredSkills = await discoverNodeModuleSkills(cwd, {
    source: options.source,
    recursive: options.recursive,
  });

  if (discoveredSkills.length === 0) {
    spinner.stop(pc.yellow('No skills found'));
    p.outro(pc.dim('No SKILL.md files found in node_modules.'));
    return;
  }

  // 2. Apply include/exclude filters
  const { skills: filteredSkills, excludedCount } = filterNpmSkills(
    discoveredSkills,
    options.include,
    options.exclude
  );

  if (filteredSkills.length === 0) {
    spinner.stop(pc.yellow(`No skills found (${excludedCount} filtered)`));
    p.outro(pc.dim('All discovered skills were filtered out.'));
    return;
  }

  discoveredSkills = filteredSkills;

  const filterMsg = excludedCount > 0 ? ` (${excludedCount} filtered)` : '';
  spinner.stop(
    `Found ${pc.green(String(discoveredSkills.length))} skill${discoveredSkills.length > 1 ? 's' : ''} in node_modules${filterMsg}`
  );

  for (const skill of discoveredSkills) {
    p.log.info(`${pc.cyan(skill.name)} ${pc.dim(`from ${skill.packageName}`)}`);
    if (skill.description) {
      p.log.message(pc.dim(`  ${skill.description}`));
    }
  }

  // 3. Check which skills are already up-to-date via local lock
  const localLock = await readLocalLock(cwd);
  const toInstall: NpmSkill[] = [];
  const upToDate: string[] = [];

  if (options.force) {
    toInstall.push(...discoveredSkills);
    p.log.info(pc.dim('Force mode: reinstalling all skills'));
  } else {
    for (const skill of discoveredSkills) {
      const existingEntry = localLock.skills[skill.targetName];
      if (existingEntry) {
        const currentHash = await computeSkillFolderHash(skill.skillPath);
        if (currentHash === existingEntry.computedHash) {
          upToDate.push(skill.name);
          continue;
        }
      }
      toInstall.push(skill);
    }

    if (upToDate.length > 0) {
      p.log.info(
        pc.dim(`${upToDate.length} skill${upToDate.length !== 1 ? 's' : ''} already up to date`)
      );
    }
  }

  const hasWorkToDo = toInstall.length > 0;

  if (!hasWorkToDo) {
    // Even if nothing to install, still run cleanup if enabled
    if (options.cleanup !== false) {
      await runCleanup(cwd, discoveredSkills, options);
    }
    if (options.gitignore !== false) {
      await runGitignoreUpdate(cwd, options);
    }
    console.log();
    p.outro(pc.green('All skills are up to date.'));
    return;
  }

  p.log.info(`${toInstall.length} skill${toInstall.length !== 1 ? 's' : ''} to install/update`);

  // 4. Select agents
  let targetAgents: AgentType[];
  const validAgents = Object.keys(agents);
  const universalAgents = getUniversalAgents();

  if (options.agent?.includes('*')) {
    targetAgents = validAgents as AgentType[];
    p.log.info(`Installing to all ${targetAgents.length} agents`);
  } else if (options.agent && options.agent.length > 0) {
    const invalidAgents = options.agent.filter((a) => !validAgents.includes(a));
    if (invalidAgents.length > 0) {
      p.log.error(`Invalid agents: ${invalidAgents.join(', ')}`);
      p.log.info(`Valid agents: ${validAgents.join(', ')}`);
      process.exit(1);
    }
    targetAgents = options.agent as AgentType[];
  } else {
    spinner.start('Loading agents...');
    const installedAgents = await detectInstalledAgents();
    const totalAgents = Object.keys(agents).length;
    spinner.stop(`${totalAgents} agents`);

    // Load last selected agents for initial selection
    let lastSelected: string[] | undefined;
    try {
      lastSelected = await getLastSelectedAgents();
    } catch {
      // Silently ignore errors
    }

    if (installedAgents.length === 0) {
      if (options.yes) {
        targetAgents = universalAgents;
        p.log.info('Installing to universal agents');
      } else {
        const otherAgents = getNonUniversalAgents();

        const otherChoices = otherAgents.map((a) => ({
          value: a,
          label: agents[a].displayName,
          hint: agents[a].skillsDir,
        }));

        const initialSelected = lastSelected
          ? (lastSelected.filter(
              (a) =>
                otherAgents.includes(a as AgentType) && !universalAgents.includes(a as AgentType)
            ) as AgentType[])
          : [];

        const selected = await searchMultiselect({
          message: 'Which agents do you want to install to?',
          items: otherChoices,
          initialSelected,
          lockedSection: {
            title: 'Universal (.agents/skills)',
            items: universalAgents.map((a) => ({
              value: a,
              label: agents[a].displayName,
            })),
          },
        });

        if (isCancelled(selected)) {
          p.cancel('Sync cancelled');
          process.exit(0);
        }

        targetAgents = selected as AgentType[];

        // Save selection for next time
        try {
          await saveSelectedAgents(targetAgents as string[]);
        } catch {
          // Silently ignore errors
        }
      }
    } else if (installedAgents.length === 1 || options.yes) {
      targetAgents = [...installedAgents];
      for (const ua of universalAgents) {
        if (!targetAgents.includes(ua)) {
          targetAgents.push(ua);
        }
      }
    } else {
      const otherAgents = getNonUniversalAgents().filter((a) => installedAgents.includes(a));

      const otherChoices = otherAgents.map((a) => ({
        value: a,
        label: agents[a].displayName,
        hint: agents[a].skillsDir,
      }));

      // Use last saved selection if available, otherwise fall back to all installed
      const initialSelected = lastSelected
        ? (lastSelected.filter(
            (a) => otherAgents.includes(a as AgentType) && !universalAgents.includes(a as AgentType)
          ) as AgentType[])
        : (installedAgents.filter((a) => !universalAgents.includes(a)) as AgentType[]);

      const selected = await searchMultiselect({
        message: 'Which agents do you want to install to?',
        items: otherChoices,
        initialSelected,
        lockedSection: {
          title: 'Universal (.agents/skills)',
          items: universalAgents.map((a) => ({
            value: a,
            label: agents[a].displayName,
          })),
        },
      });

      if (isCancelled(selected)) {
        p.cancel('Sync cancelled');
        process.exit(0);
      }

      targetAgents = selected as AgentType[];

      // Save selection for next time
      try {
        await saveSelectedAgents(targetAgents as string[]);
      } catch {
        // Silently ignore errors
      }
    }
  }

  // 5. Build summary
  const summaryLines: string[] = [];
  for (const skill of toInstall) {
    summaryLines.push(`${pc.cyan(skill.name)} ${pc.dim(`← ${skill.packageName}`)}`);
    summaryLines.push(`  ${pc.dim(skill.targetName)}`);
  }

  console.log();
  p.note(summaryLines.join('\n'), 'Sync Summary');

  if (options.dryRun) {
    p.log.info(pc.yellow('Dry run mode: no changes will be made'));
  }

  if (!options.yes && !options.dryRun) {
    const confirmed = await p.confirm({ message: 'Proceed with sync?' });

    if (p.isCancel(confirmed) || !confirmed) {
      p.cancel('Sync cancelled');
      process.exit(0);
    }
  }

  // 6. Create symlinks
  // Deduplicate agent skillsDirs to avoid redundant symlinks
  const uniqueSkillsDirs = [...new Set(targetAgents.map((a) => agents[a].skillsDir))];

  spinner.start('Syncing skills...');

  const results: Array<{
    skill: string;
    targetName: string;
    packageName: string;
    skillsDir: string;
    success: boolean;
    error?: string;
  }> = [];

  for (const skill of toInstall) {
    for (const skillsDir of uniqueSkillsDirs) {
      const linkPath = join(cwd, skillsDir, skill.targetName);

      if (options.dryRun) {
        results.push({
          skill: skill.name,
          targetName: skill.targetName,
          packageName: skill.packageName,
          skillsDir,
          success: true,
        });
        continue;
      }

      const success = await createSkillSymlink(skill.skillPath, linkPath);
      results.push({
        skill: skill.name,
        targetName: skill.targetName,
        packageName: skill.packageName,
        skillsDir,
        success,
        error: success ? undefined : 'Failed to create symlink',
      });
    }
  }

  spinner.stop('Sync complete');

  // 7. Cleanup stale npm-* entries
  if (options.cleanup !== false) {
    await runCleanup(cwd, discoveredSkills, options, uniqueSkillsDirs);
  }

  // 8. Update .gitignore
  if (options.gitignore !== false) {
    await runGitignoreUpdate(cwd, options);
  }

  // 9. Update local lock file
  if (!options.dryRun) {
    const successfulTargetNames = new Set(
      results.filter((r) => r.success).map((r) => r.targetName)
    );

    for (const skill of toInstall) {
      if (successfulTargetNames.has(skill.targetName)) {
        try {
          const computedHash = await computeSkillFolderHash(skill.skillPath);
          await addSkillToLocalLock(
            skill.targetName,
            {
              source: skill.packageName,
              sourceType: 'node_modules',
              computedHash,
            },
            cwd
          );
        } catch {
          // Don't fail sync if lock file update fails
        }
      }
    }
  }

  // 10. Display results
  console.log();

  const successful = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);

  if (successful.length > 0) {
    const bySkill = new Map<string, (typeof results)[number][]>();
    for (const r of successful) {
      const skillResults = bySkill.get(r.targetName) || [];
      skillResults.push(r);
      bySkill.set(r.targetName, skillResults);
    }

    const resultLines: string[] = [];
    for (const [, skillResults] of bySkill) {
      const firstResult = skillResults[0]!;
      const shortPath = shortenPath(join(cwd, firstResult.skillsDir, firstResult.targetName), cwd);
      resultLines.push(
        `${pc.green('✓')} ${firstResult.skill} ${pc.dim(`← ${firstResult.packageName}`)}`
      );
      resultLines.push(`  ${pc.dim(shortPath)}`);
    }

    const action = options.dryRun ? 'Would sync' : 'Synced';
    const skillCount = bySkill.size;
    const title = pc.green(`${action} ${skillCount} skill${skillCount !== 1 ? 's' : ''}`);
    p.note(resultLines.join('\n'), title);
  }

  if (failed.length > 0) {
    console.log();
    p.log.error(pc.red(`Failed to install ${failed.length}`));
    for (const r of failed) {
      p.log.message(`  ${pc.red('✗')} ${r.skill} → ${r.skillsDir}: ${pc.dim(r.error)}`);
    }
  }

  // Track telemetry
  track({
    event: 'experimental_sync',
    skillCount: String(toInstall.length),
    successCount: String(new Set(successful.map((r) => r.targetName)).size),
    agents: targetAgents.join(','),
  });

  console.log();
  p.outro(
    pc.green('Done!') + pc.dim('  Review skills before use; they run with full agent permissions.')
  );
}

async function runCleanup(
  cwd: string,
  allSkills: NpmSkill[],
  options: SyncOptions,
  skillsDirs?: string[]
): Promise<void> {
  const validTargetNames = new Set(allSkills.map((s) => s.targetName));
  const dirs = skillsDirs || [...new Set(Object.values(agents).map((a) => a.skillsDir))];

  let totalCleaned = 0;
  for (const skillsDir of dirs) {
    const results = await cleanupStaleNpmSkills(
      join(cwd, skillsDir),
      validTargetNames,
      options.dryRun
    );
    const cleaned = results.filter((r) => r.success);
    totalCleaned += cleaned.length;

    if (cleaned.length > 0) {
      const action = options.dryRun ? 'Would remove' : 'Removed';
      for (const r of cleaned) {
        p.log.info(
          `${action} stale ${pc.dim(r.targetName)} from ${pc.dim(shortenPath(r.path, cwd))}`
        );
      }
    }
  }

  if (totalCleaned > 0) {
    const action = options.dryRun ? 'Would clean up' : 'Cleaned up';
    p.log.success(`${action} ${totalCleaned} stale skill${totalCleaned !== 1 ? 's' : ''}`);
  }
}

async function runGitignoreUpdate(cwd: string, options: SyncOptions): Promise<void> {
  const { updated, created } = await updateGitignore(cwd, options.dryRun);
  if (updated) {
    const prefix = options.dryRun ? 'Would update' : 'Updated';
    const msg = created ? `${prefix} .gitignore (created)` : `${prefix} .gitignore`;
    p.log.success(msg);
  }
}

export function parseSyncOptions(args: string[]): { options: SyncOptions } {
  const options: SyncOptions = {
    cleanup: true,
    gitignore: true,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '-y' || arg === '--yes') {
      options.yes = true;
    } else if (arg === '-f' || arg === '--force') {
      options.force = true;
    } else if (arg === '-r' || arg === '--recursive') {
      options.recursive = true;
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--no-cleanup') {
      options.cleanup = false;
    } else if (arg === '--no-gitignore') {
      options.gitignore = false;
    } else if (arg === '-s' || arg === '--source') {
      i++;
      const val = args[i];
      if (val === 'node_modules' || val === 'package.json') {
        options.source = val;
      }
    } else if (arg === '-a' || arg === '--agent') {
      options.agent = options.agent || [];
      i++;
      let nextArg = args[i];
      while (i < args.length && nextArg && !nextArg.startsWith('-')) {
        options.agent.push(nextArg);
        i++;
        nextArg = args[i];
      }
      i--;
    } else if (arg === '--include') {
      options.include = options.include || [];
      i++;
      let nextArg = args[i];
      while (i < args.length && nextArg && !nextArg.startsWith('-')) {
        options.include.push(nextArg);
        i++;
        nextArg = args[i];
      }
      i--;
    } else if (arg === '--exclude') {
      options.exclude = options.exclude || [];
      i++;
      let nextArg = args[i];
      while (i < args.length && nextArg && !nextArg.startsWith('-')) {
        options.exclude.push(nextArg);
        i++;
        nextArg = args[i];
      }
      i--;
    }
  }

  return { options };
}
