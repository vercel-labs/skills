/**
 * Manifest-based batch skill installation (fork feature).
 *
 * Installs multiple skills from a TOML manifest file with support for:
 * - Version pinning and resolution
 * - Multi-location installation (global/project/custom paths)
 * - Frozen mode for reproducible installs via lock file
 */

import * as p from '@clack/prompts';
import pc from 'picocolors';
import { join } from 'path';
import { homedir } from 'os';
import { parseSource, getOwnerRepo } from './source-parser.ts';
import { cloneRepo, cleanupTempDir } from './git.ts';
import { discoverSkills, getSkillDisplayName } from './skills.ts';
import {
  installSkillForAgent,
  isSkillInstalled,
  getInstallPath,
  getCanonicalSkillsDir,
  getAgentBaseDir,
  sanitizeName,
} from './installer.ts';
import { detectInstalledAgents, agents } from './agents.ts';
import { track } from './telemetry.ts';
import { addSkillToLock } from './skill-lock.ts';
import { addSkillToLocalLock, computeSkillFolderHash } from './local-lock.ts';
import {
  parseManifestFile,
  groupSkillsBySource,
  groupSkillsBySourceAndRef,
  getLockFilePath,
  readLockFile,
  writeLockFile,
  ManifestParseError,
  SkillNotFoundError,
} from './manifest.ts';
import type { Skill, AgentType, ManifestSkillEntry, ManifestLockEntry } from './types.ts';

export interface ManifestInstallOptions {
  global?: boolean;
  agent?: string[];
  yes?: boolean;
  noLock?: boolean;
  frozen?: boolean;
}

/**
 * Resolves a location string to an actual install path for a given agent.
 */
function resolveLocationPath(
  skillName: string,
  agentType: AgentType,
  location: string,
  cwd: string
): string {
  const sanitized = sanitizeName(skillName);

  if (location === 'global') {
    return join(getAgentBaseDir(agentType, true), sanitized);
  }

  if (location === 'project') {
    return join(getAgentBaseDir(agentType, false, cwd), sanitized);
  }

  // Custom relative path
  const customCwd = join(cwd, location);
  return join(getAgentBaseDir(agentType, false, customCwd), sanitized);
}

function getLocationLabel(location: string): string {
  if (location === 'global') return '[global]';
  if (location === 'project') return '[project]';
  return `[${location}]`;
}

export async function installFromManifest(
  manifestPath: string,
  options: ManifestInstallOptions
): Promise<void> {
  console.log();
  p.intro(pc.bgCyan(pc.black(' add-skill ')) + pc.dim(' (manifest mode)'));

  const tempDirs: string[] = [];
  const cwd = process.cwd();

  try {
    const spinner = p.spinner();

    if (options.frozen && options.noLock) {
      p.log.error('Cannot use --frozen with --no-lock. Frozen mode requires a lock file.');
      process.exit(1);
    }

    // Parse manifest file
    spinner.start('Parsing manifest file...');
    let manifest;
    try {
      manifest = await parseManifestFile(manifestPath);
    } catch (error) {
      spinner.stop(pc.red('Failed to parse manifest'));
      if (error instanceof ManifestParseError) {
        p.log.error(error.message);
      } else {
        p.log.error((error as Error).message);
      }
      process.exit(1);
    }
    spinner.stop(
      `Found ${pc.green(String(manifest.skills.length))} skill${manifest.skills.length !== 1 ? 's' : ''} in manifest`
    );

    // Read lock file if in frozen mode
    const lockPath = getLockFilePath(manifestPath);
    let lockFile: Awaited<ReturnType<typeof readLockFile>> = null;

    if (options.frozen) {
      spinner.start('Reading lock file...');
      lockFile = await readLockFile(lockPath);

      if (!lockFile) {
        spinner.stop(pc.red('Lock file not found'));
        p.log.error(
          'Frozen mode requires a lock file. Run without --frozen first to generate one.'
        );
        p.log.info(`Expected lock file: ${lockPath}`);
        process.exit(1);
      }

      spinner.stop(`Lock file loaded (${pc.green(String(lockFile.skills.length))} entries)`);
    }

    // In frozen mode, validate all manifest skills exist in lock file
    if (options.frozen && lockFile) {
      for (const entry of manifest.skills) {
        const lockEntry = lockFile.skills.find(
          (l) => l.source === entry.source && l.name.toLowerCase() === entry.name.toLowerCase()
        );
        if (!lockEntry) {
          p.log.error(`Skill "${entry.name}" from "${entry.source}" not found in lock file.`);
          p.log.info('Run without --frozen to update the lock file with new skills.');
          process.exit(1);
        }
      }
    }

    // Group skills by source (and ref in frozen mode)
    const skillsBySource =
      options.frozen && lockFile
        ? groupSkillsBySourceAndRef(manifest.skills, lockFile.skills)
        : groupSkillsBySource(manifest.skills);
    p.log.info(
      `From ${pc.cyan(String(skillsBySource.size))} source${skillsBySource.size !== 1 ? 's' : ''}`
    );

    // Collect all skills to install
    const skillsToInstall: Array<{
      skill: Skill;
      entry: ManifestSkillEntry;
      resolvedRef: string;
      locations: string[];
    }> = [];
    const lockEntries: ManifestLockEntry[] = [];

    // Process each source
    for (const [_sourceKey, entries] of skillsBySource) {
      const firstEntry = entries[0]!;
      const source = firstEntry.source;
      const version = firstEntry.version;

      const parsed = parseSource(source);
      let tempDir: string;
      let resolvedRef: string;

      if (options.frozen && lockFile) {
        const lockEntry = lockFile.skills.find(
          (l) => l.source === source && l.name.toLowerCase() === firstEntry.name.toLowerCase()
        )!;
        const ref = lockEntry.resolvedRef;

        spinner.start(`Cloning ${pc.cyan(source)} @ ${pc.dim(ref.slice(0, 7))} (frozen)...`);

        tempDir = await cloneRepo(parsed.url, ref);
        resolvedRef = ref;
      } else {
        spinner.start(`Cloning ${pc.cyan(source)}${version ? ` @ ${version}` : ''}...`);

        // Clone at version tag if specified, otherwise HEAD
        const ref = version ? `v${version}` : undefined;
        tempDir = await cloneRepo(parsed.url, ref);

        // Get the resolved ref (HEAD of the cloned repo)
        const { execSync } = await import('child_process');
        resolvedRef = execSync('git rev-parse HEAD', {
          cwd: tempDir,
          encoding: 'utf-8',
        }).trim();
      }

      tempDirs.push(tempDir);
      spinner.stop(`Cloned ${pc.cyan(source)} (${pc.dim(resolvedRef.slice(0, 7))})`);

      spinner.start('Discovering skills...');
      const discoveredSkills = await discoverSkills(tempDir, parsed.subpath);
      spinner.stop(
        `Found ${discoveredSkills.length} skill${discoveredSkills.length !== 1 ? 's' : ''}`
      );

      // Match requested skills
      for (const entry of entries) {
        const skill = discoveredSkills.find(
          (s) => s.name.toLowerCase() === entry.name.toLowerCase()
        );

        if (!skill) {
          throw new SkillNotFoundError(
            entry.name,
            entry.source,
            discoveredSkills.map((s) => s.name)
          );
        }

        // Determine locations for this skill
        const entryLocations = entry.locations && entry.locations.length > 0 ? entry.locations : [];

        skillsToInstall.push({ skill, entry, resolvedRef, locations: entryLocations });
      }
    }

    // Determine target agents
    let targetAgents: AgentType[];

    if (options.agent && options.agent.length > 0) {
      const validAgentNames = Object.keys(agents);
      const invalidAgents = options.agent.filter((a) => !validAgentNames.includes(a));

      if (invalidAgents.length > 0) {
        p.log.error(`Invalid agents: ${invalidAgents.join(', ')}`);
        p.log.info(`Valid agents: ${validAgentNames.join(', ')}`);
        await cleanupAll(tempDirs);
        process.exit(1);
      }

      targetAgents = options.agent as AgentType[];
    } else {
      spinner.start('Detecting installed agents...');
      const installedAgents = await detectInstalledAgents();
      spinner.stop(
        `Detected ${installedAgents.length} agent${installedAgents.length !== 1 ? 's' : ''}`
      );

      if (installedAgents.length === 0) {
        if (options.yes) {
          targetAgents = Object.keys(agents) as AgentType[];
          p.log.info('Installing to all agents (none detected)');
        } else {
          p.log.warn('No coding agents detected. You can still install skills.');

          const allAgentChoices = Object.entries(agents).map(([key, config]) => ({
            value: key as AgentType,
            label: config.displayName,
          }));

          const selected = await p.multiselect({
            message: 'Select agents to install skills to',
            options: allAgentChoices,
            required: true,
          });

          if (p.isCancel(selected)) {
            p.cancel('Installation cancelled');
            await cleanupAll(tempDirs);
            process.exit(0);
          }

          targetAgents = selected as AgentType[];
        }
      } else if (installedAgents.length === 1 || options.yes) {
        targetAgents = installedAgents;
        p.log.info(
          `Installing to: ${targetAgents.map((a) => pc.cyan(agents[a].displayName)).join(', ')}`
        );
      } else {
        const agentChoices = installedAgents.map((a) => ({
          value: a,
          label: agents[a].displayName,
          hint: `${options.global ? agents[a].globalSkillsDir : agents[a].skillsDir}`,
        }));

        const selected = await p.multiselect({
          message: 'Select agents to install skills to',
          options: agentChoices,
          required: true,
          initialValues: installedAgents,
        });

        if (p.isCancel(selected)) {
          p.cancel('Installation cancelled');
          await cleanupAll(tempDirs);
          process.exit(0);
        }

        targetAgents = selected as AgentType[];
      }
    }

    // Determine default location for skills without explicit locations
    let defaultLocation: string | null = null;
    const skillsNeedingLocation = skillsToInstall.filter((s) => s.locations.length === 0);

    if (skillsNeedingLocation.length > 0) {
      if (options.global !== undefined) {
        defaultLocation = options.global ? 'global' : 'project';
      } else if (options.yes) {
        defaultLocation = 'project';
      } else {
        const scope = await p.select({
          message: 'Installation scope (for skills without explicit locations)',
          options: [
            { value: 'project', label: 'Project', hint: 'Install in current directory' },
            { value: 'global', label: 'Global', hint: 'Install in home directory' },
          ],
        });

        if (p.isCancel(scope)) {
          p.cancel('Installation cancelled');
          await cleanupAll(tempDirs);
          process.exit(0);
        }

        defaultLocation = scope as string;
      }

      for (const item of skillsNeedingLocation) {
        item.locations = [defaultLocation];
      }
    }

    // Display summary
    console.log();
    p.log.step(pc.bold('Installation Summary'));

    for (const { skill, entry, locations } of skillsToInstall) {
      const versionStr = entry.version ? ` @ ${entry.version}` : '';
      p.log.message(`  ${pc.cyan(getSkillDisplayName(skill))}${pc.dim(versionStr)}`);
      p.log.message(`    ${pc.dim('from')} ${entry.source}`);
      for (const location of locations) {
        const locationLabel = getLocationLabel(location);
        for (const agent of targetAgents) {
          const path = resolveLocationPath(skill.name, agent, location, cwd);
          const installed = await isSkillInstalled(skill.name, agent, {
            global: location === 'global',
            cwd: location !== 'global' && location !== 'project' ? join(cwd, location) : cwd,
          });
          const status = installed ? pc.yellow(' (will overwrite)') : '';
          p.log.message(
            `    ${pc.dim('→')} ${agents[agent].displayName} ${pc.blue(locationLabel)}: ${pc.dim(path)}${status}`
          );
        }
      }
    }
    console.log();

    // Confirm installation
    if (!options.yes) {
      const confirmed = await p.confirm({ message: 'Proceed with installation?' });

      if (p.isCancel(confirmed) || !confirmed) {
        p.cancel('Installation cancelled');
        await cleanupAll(tempDirs);
        process.exit(0);
      }
    }

    // Install skills
    spinner.start('Installing skills...');

    const results: {
      skill: string;
      agent: string;
      location: string;
      success: boolean;
      path: string;
      error?: string;
    }[] = [];

    for (const { skill, entry, resolvedRef, locations } of skillsToInstall) {
      for (const location of locations) {
        for (const agent of targetAgents) {
          const isGlobal = location === 'global';
          const installCwd =
            location !== 'global' && location !== 'project' ? join(cwd, location) : cwd;

          const result = await installSkillForAgent(skill, agent, {
            global: isGlobal,
            cwd: installCwd,
          });

          results.push({
            skill: getSkillDisplayName(skill),
            agent: agents[agent].displayName,
            location,
            ...result,
          });

          // Register in upstream's global lock for update tracking
          if (result.success) {
            const ownerRepo = getOwnerRepo(parseSource(entry.source));
            if (ownerRepo) {
              try {
                await addSkillToLock(skill.name, {
                  source: ownerRepo,
                  sourceType: parseSource(entry.source).type,
                  sourceUrl: parseSource(entry.source).url,
                  ref: entry.version ? `v${entry.version}` : undefined,
                  skillFolderHash: '',
                });
              } catch {
                // Non-critical: don't fail install if lock update fails
              }
            }

            // Register in local lock for project-scope installs
            if (!isGlobal) {
              try {
                const hash = await computeSkillFolderHash(result.path);
                await addSkillToLocalLock(
                  skill.name,
                  {
                    source: ownerRepo || entry.source,
                    sourceType: parseSource(entry.source).type,
                    ref: entry.version ? `v${entry.version}` : undefined,
                    computedHash: hash,
                  },
                  installCwd
                );
              } catch {
                // Non-critical
              }
            }
          }

          // Prepare manifest lock entry
          if (!options.frozen && result.success) {
            lockEntries.push({
              source: entry.source,
              name: entry.name,
              version: entry.version || 'latest',
              resolvedRef,
              installedAt: new Date().toISOString(),
              location,
            });
          }
        }
      }
    }

    spinner.stop('Installation complete');

    // Write manifest lock file
    if (!options.noLock && !options.frozen && lockEntries.length > 0) {
      await writeLockFile(lockPath, lockEntries);
      p.log.info(`Lock file written to ${pc.dim(lockPath)}`);
    }

    // Report results
    console.log();
    const successful = results.filter((r) => r.success);
    const failed = results.filter((r) => !r.success);

    // Track installation
    const hasGlobalLocation = skillsToInstall.some((s) => s.locations.includes('global'));
    track({
      event: 'install',
      source: `manifest:${manifest.skills.length}`,
      skills: skillsToInstall.map((s) => s.skill.name).join(','),
      agents: targetAgents.join(','),
      ...(hasGlobalLocation && { global: '1' }),
    });

    if (successful.length > 0) {
      p.log.success(
        pc.green(
          `Successfully installed ${successful.length} skill${successful.length !== 1 ? 's' : ''}`
        )
      );
      for (const r of successful) {
        const locationLabel = getLocationLabel(r.location);
        p.log.message(`  ${pc.green('✓')} ${r.skill} → ${r.agent} ${pc.blue(locationLabel)}`);
        p.log.message(`    ${pc.dim(r.path)}`);
      }
    }

    if (failed.length > 0) {
      console.log();
      p.log.error(
        pc.red(`Failed to install ${failed.length} skill${failed.length !== 1 ? 's' : ''}`)
      );
      for (const r of failed) {
        const locationLabel = getLocationLabel(r.location);
        p.log.message(`  ${pc.red('✗')} ${r.skill} → ${r.agent} ${pc.blue(locationLabel)}`);
        p.log.message(`    ${pc.dim(r.error)}`);
      }
    }

    console.log();
    p.outro(pc.green('Done!'));
  } catch (error) {
    if (error instanceof SkillNotFoundError) {
      p.log.error(error.message);
      if (error.availableSkills.length > 0) {
        p.log.info('Available skills:');
        for (const name of error.availableSkills) {
          p.log.message(`  - ${name}`);
        }
      }
    } else {
      p.log.error(error instanceof Error ? error.message : 'Unknown error occurred');
    }
    p.outro(pc.red('Installation failed'));
    process.exit(1);
  } finally {
    await cleanupAll(tempDirs);
  }
}

async function cleanupAll(tempDirs: string[]) {
  for (const dir of tempDirs) {
    try {
      await cleanupTempDir(dir);
    } catch {
      // Best effort cleanup
    }
  }
}
