import * as p from '@clack/prompts';
import pc from 'picocolors';
import { readdir, readFile } from 'fs/promises';
import { join, sep } from 'path';
import { homedir } from 'os';
import { hasSkillMd, parseSkillMd } from './skills.ts';
import { installSkillForAgent, getCanonicalPath } from './installer.ts';
import {
  detectInstalledAgents,
  agents,
  getUniversalAgents,
  getVisibleUniversalAgents,
  getNonUniversalAgents,
} from './agents.ts';
import { searchMultiselect } from './prompts/search-multiselect.ts';
import { addSkillToLocalLock, computeSkillFolderHash, readLocalLock } from './local-lock.ts';
import type { Skill, AgentType } from './types.ts';
import { track } from './telemetry.ts';
import { detectAgent, getAgentType } from './detect-agent.ts';

const isCancelled = (value: unknown): value is symbol => typeof value === 'symbol';

export interface SyncOptions {
  agent?: string[];
  yes?: boolean;
  force?: boolean;
}

/**
 * Shortens a path for display: replaces homedir with ~ and cwd with .
 */
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

interface PackageSkill extends Skill {
  packageName: string;
  packageVersion?: string;
  /** Path to SKILL.md relative to the package root, e.g. `skills/pdf/SKILL.md`. */
  skillPath: string;
}

interface PackageJson {
  version?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

async function readPackageJson(dir: string): Promise<PackageJson | null> {
  try {
    return JSON.parse(await readFile(join(dir, 'package.json'), 'utf-8'));
  } catch {
    return null;
  }
}

async function discoverPackageSkills(pkgDir: string, packageName: string): Promise<PackageSkill[]> {
  const pkg = await readPackageJson(pkgDir);
  if (!pkg) return []; // not installed

  const rootSkill = (await hasSkillMd(pkgDir))
    ? await parseSkillMd(join(pkgDir, 'SKILL.md'))
    : null;
  if (rootSkill) {
    return [{ ...rootSkill, packageName, packageVersion: pkg.version, skillPath: 'SKILL.md' }];
  }

  const skills: PackageSkill[] = [];
  for (const dir of ['skills', 'dist/skills']) {
    for (const name of await readdir(join(pkgDir, dir)).catch(() => [])) {
      const skillDir = join(pkgDir, dir, name);
      if (!(await hasSkillMd(skillDir))) continue;
      const skill = await parseSkillMd(join(skillDir, 'SKILL.md'));
      if (skill) {
        skills.push({
          ...skill,
          packageName,
          packageVersion: pkg.version,
          skillPath: `${dir}/${name}/SKILL.md`,
        });
      }
    }
  }
  return skills;
}

/**
 * Find skills shipped by the project's direct dependencies.
 * Only packages listed in package.json are read, so transitive dependencies
 * cannot place a skill in front of the agent, and the package manager's
 * version resolution decides which copy of a package is seen.
 */
async function discoverNodeModuleSkills(cwd: string): Promise<PackageSkill[]> {
  const pkg = await readPackageJson(cwd);
  if (!pkg) return [];

  const names = new Set([
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.devDependencies ?? {}),
  ]);
  const perPackage = await Promise.all(
    [...names].map((name) => discoverPackageSkills(join(cwd, 'node_modules', name), name))
  );
  return perPackage.flat();
}

export async function runSync(args: string[], options: SyncOptions = {}): Promise<void> {
  const cwd = process.cwd();

  // Auto-enable non-interactive mode when running inside an AI agent
  const agentResult = await detectAgent();
  if (agentResult.isAgent) {
    options.yes = true;
    if (!options.agent || options.agent.length === 0) {
      const mappedAgent = getAgentType(agentResult.agent.name);
      if (mappedAgent) {
        const agentList: AgentType[] = [mappedAgent];
        for (const ua of getUniversalAgents()) {
          if (!agentList.includes(ua)) agentList.push(ua);
        }
        options.agent = agentList;
      }
    }
  }

  console.log();
  if (!agentResult.isAgent) {
    p.intro(pc.bgCyan(pc.black(' skills experimental_sync ')));
  }

  if (agentResult.isAgent) {
    p.log.info(
      pc.bgCyan(pc.black(pc.bold(` ${agentResult.agent.name} `))) +
        ' ' +
        'Agent detected — installing non-interactively'
    );
  }

  const spinner = p.spinner();

  // 1. Discover skills from node_modules
  spinner.start('Scanning node_modules for skills…');
  const discoveredSkills = await discoverNodeModuleSkills(cwd);

  if (discoveredSkills.length === 0) {
    spinner.stop(pc.yellow('No skills found'));
    p.outro(pc.dim('No SKILL.md files found in the dependencies listed in package.json.'));
    return;
  }

  spinner.stop(
    `Found ${pc.green(String(discoveredSkills.length))} skill${discoveredSkills.length > 1 ? 's' : ''} in node_modules`
  );

  // Show discovered skills
  for (const skill of discoveredSkills) {
    p.log.info(`${pc.cyan(skill.name)} ${pc.dim(`from ${skill.packageName}`)}`);
    if (skill.description) {
      p.log.message(pc.dim(`  ${skill.description}`));
    }
  }

  // 2. Check which skills are already up-to-date via local lock
  const localLock = await readLocalLock(cwd);
  const toInstall: PackageSkill[] = [];
  const upToDate: string[] = [];

  if (options.force) {
    toInstall.push(...discoveredSkills);
    p.log.info(pc.dim('Force mode: reinstalling all skills'));
  } else {
    for (const skill of discoveredSkills) {
      const existingEntry = localLock.skills[skill.name];
      if (existingEntry) {
        // Compute current hash and compare
        const currentHash = await computeSkillFolderHash(skill.path);
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

    if (toInstall.length === 0) {
      console.log();
      p.outro(pc.green('All skills are up to date.'));
      return;
    }
  }

  p.log.info(`${toInstall.length} skill${toInstall.length !== 1 ? 's' : ''} to install/update`);

  // 3. Select agents
  let targetAgents: AgentType[];
  const validAgents = Object.keys(agents);
  const universalAgents = getUniversalAgents();
  const visibleUniversalAgents = getVisibleUniversalAgents();

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
    spinner.start('Loading agents…');
    const installedAgents = await detectInstalledAgents();
    const totalAgents = Object.keys(agents).length;
    spinner.stop(`${totalAgents} agents`);

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

        const selected = await searchMultiselect({
          message: 'Which agents do you want to install to?',
          items: otherChoices,
          initialSelected: [],
          lockedSection: {
            title: 'Universal (.agents/skills)',
            items: visibleUniversalAgents.map((a) => ({
              value: a,
              label: agents[a].displayName,
            })),
            hiddenCount: universalAgents.length - visibleUniversalAgents.length,
          },
        });

        if (isCancelled(selected)) {
          p.cancel('Sync cancelled');
          process.exit(0);
        }

        targetAgents = selected as AgentType[];
      }
    } else if (installedAgents.length === 1 || options.yes) {
      // Ensure universal agents are included
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

      const selected = await searchMultiselect({
        message: 'Which agents do you want to install to?',
        items: otherChoices,
        initialSelected: installedAgents.filter((a) => !universalAgents.includes(a)),
        lockedSection: {
          title: 'Universal (.agents/skills)',
          items: visibleUniversalAgents.map((a) => ({
            value: a,
            label: agents[a].displayName,
          })),
          hiddenCount: universalAgents.length - visibleUniversalAgents.length,
        },
      });

      if (isCancelled(selected)) {
        p.cancel('Sync cancelled');
        process.exit(0);
      }

      targetAgents = selected as AgentType[];
    }
  }

  // 4. Build summary
  const summaryLines: string[] = [];
  for (const skill of toInstall) {
    const canonicalPath = getCanonicalPath(skill.name, { global: false });
    const shortCanonical = shortenPath(canonicalPath, cwd);
    summaryLines.push(`${pc.cyan(skill.name)} ${pc.dim(`← ${skill.packageName}`)}`);
    summaryLines.push(`  ${pc.dim(shortCanonical)}`);
  }

  console.log();
  p.note(summaryLines.join('\n'), 'Sync Summary');

  if (!options.yes) {
    const confirmed = await p.confirm({ message: 'Proceed with sync?' });

    if (p.isCancel(confirmed) || !confirmed) {
      p.cancel('Sync cancelled');
      process.exit(0);
    }
  }

  // 5. Install skills (always project-scoped, always symlink)
  spinner.start('Syncing skills…');

  const results: Array<{
    skill: string;
    packageName: string;
    agent: string;
    success: boolean;
    path: string;
    canonicalPath?: string;
    error?: string;
  }> = [];

  for (const skill of toInstall) {
    for (const agent of targetAgents) {
      const result = await installSkillForAgent(skill, agent, {
        global: false,
        cwd,
        mode: 'symlink',
      });
      results.push({
        skill: skill.name,
        packageName: skill.packageName,
        agent: agents[agent].displayName,
        success: result.success,
        path: result.path,
        canonicalPath: result.canonicalPath,
        error: result.error,
      });
    }
  }

  spinner.stop('Sync complete');

  // 6. Update local lock file
  const successful = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);
  const successfulSkillNames = new Set(successful.map((r) => r.skill));

  for (const skill of toInstall) {
    if (successfulSkillNames.has(skill.name)) {
      try {
        const computedHash = await computeSkillFolderHash(skill.path);
        await addSkillToLocalLock(
          skill.name,
          {
            source: skill.packageName,
            sourceType: 'node_modules',
            skillPath: skill.skillPath,
            ...(skill.packageVersion && { version: skill.packageVersion }),
            computedHash,
          },
          cwd
        );
      } catch {
        // Don't fail sync if lock file update fails
      }
    }
  }

  // 7. Display results
  console.log();

  if (successful.length > 0) {
    const bySkill = new Map<string, typeof results>();
    for (const r of successful) {
      const skillResults = bySkill.get(r.skill) || [];
      skillResults.push(r);
      bySkill.set(r.skill, skillResults);
    }

    const resultLines: string[] = [];
    for (const [skillName, skillResults] of bySkill) {
      const firstResult = skillResults[0]!;
      const pkg = toInstall.find((s) => s.name === skillName)?.packageName;
      if (firstResult.canonicalPath) {
        const shortPath = shortenPath(firstResult.canonicalPath, cwd);
        resultLines.push(`${pc.green('✓')} ${skillName} ${pc.dim(`← ${pkg}`)}`);
        resultLines.push(`  ${pc.dim(shortPath)}`);
      } else {
        resultLines.push(`${pc.green('✓')} ${skillName} ${pc.dim(`← ${pkg}`)}`);
      }
    }

    const skillCount = bySkill.size;
    const title = pc.green(`Synced ${skillCount} skill${skillCount !== 1 ? 's' : ''}`);
    p.note(resultLines.join('\n'), title);
  }

  if (failed.length > 0) {
    console.log();
    p.log.error(pc.red(`Failed to install ${failed.length}`));
    for (const r of failed) {
      p.log.message(`  ${pc.red('✗')} ${r.skill} → ${r.agent}: ${pc.dim(r.error)}`);
    }
  }

  // Track telemetry
  track({
    event: 'experimental_sync',
    skillCount: String(toInstall.length),
    successCount: String(successfulSkillNames.size),
    agents: targetAgents.join(','),
  });

  console.log();
  p.outro(
    pc.green('Done!') + pc.dim('  Review skills before use; they run with full agent permissions.')
  );
}

export function parseSyncOptions(args: string[]): { options: SyncOptions } {
  const options: SyncOptions = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '-y' || arg === '--yes') {
      options.yes = true;
    } else if (arg === '-f' || arg === '--force') {
      options.force = true;
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
    }
  }

  return { options };
}
