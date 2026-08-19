import * as p from '@clack/prompts';
import pc from 'picocolors';
import { readdir, rm, lstat } from 'fs/promises';
import { join } from 'path';
import { agents, detectInstalledAgents, getEveSubagents } from './agents.ts';
import { track } from './telemetry.ts';
import { detectAgent } from './detect-agent.ts';
import { removeSkillFromLock, getSkillFromLock, readSkillLock } from './skill-lock.ts';
import { readLocalLock, removeSkillFromLocalLock } from './local-lock.ts';
import { searchMultiselect, type SearchItem } from './prompts/search-multiselect.ts';
import type { AgentType } from './types.ts';
import {
  getInstallPath,
  getCanonicalPath,
  getCanonicalSkillsDir,
  getEveSubagentSkillsDir,
  sanitizeName,
} from './installer.ts';

export interface RemoveOptions {
  global?: boolean;
  agent?: string[];
  yes?: boolean;
  all?: boolean;
}

/**
 * Resolve requested skill names to canonical removal targets.
 *
 * On-disk folder names are the result of sanitizeName() at install time, but
 * lock-file keys keep the original name, which may contain characters
 * sanitizeName() rewrites — e.g. the ':' in plugin skills such as "ce:review"
 * maps to the folder "ce-review". Matching purely on folder names therefore
 * misses lock-only or name-mismatched skills (and stale lock entries whose
 * folder is already gone). Removable candidates preserve exact lock keys, including
 * distinct keys that sanitize to the same folder, while untracked folders are
 * reconciled with a lock identity where possible. Downstream disk cleanup
 * re-sanitizes and lock removal needs the exact key, so both target the right thing.
 */
export function resolveSkillsToRemove(
  requested: string[],
  folderNames: string[],
  lockKeys: string[] = []
): string[] {
  const candidates = getRemovalCandidates(folderNames, lockKeys);

  const matched = new Set<string>();
  for (const name of requested) {
    const sanitizedName = sanitizeName(name);
    for (const candidate of candidates) {
      if (sanitizeName(candidate) === sanitizedName) matched.add(candidate);
    }
  }
  return Array.from(matched);
}

type RemoveLockEntry = { source?: string };

function getRemovalCandidates(folderNames: string[], lockKeys: string[]): string[] {
  const candidates = new Set(lockKeys);

  for (const folder of folderNames) {
    const sanitizedFolder = sanitizeName(folder);
    const hasLockIdentity = lockKeys.some((key) => sanitizeName(key) === sanitizedFolder);
    if (!hasLockIdentity) candidates.add(folder);
  }

  return Array.from(candidates).sort((a, b) => a.localeCompare(b));
}

/** Build the grouped choices used by the interactive remove selector. */
export function buildRemoveChoices(
  folderNames: string[],
  lockEntries: Record<string, RemoveLockEntry>
): SearchItem<string>[] {
  const lockKeys = Object.keys(lockEntries);
  const groups = new Map<string, SearchItem<string>[]>();

  for (const skill of getRemovalCandidates(folderNames, lockKeys)) {
    const group = lockEntries[skill]?.source ?? 'Unknown source';
    const choices = groups.get(group) || [];
    choices.push({ value: skill, label: skill, group });
    groups.set(group, choices);
  }

  return Array.from(groups.values()).flat();
}

/** Resolve skill names first, then exact lock-entry source strings. */
export function resolveRemoveTargets(
  requested: string[],
  folderNames: string[],
  lockEntries: Record<string, RemoveLockEntry>
): string[] {
  const lockKeys = Object.keys(lockEntries);
  const candidates = getRemovalCandidates(folderNames, lockKeys);
  const identityByName = new Map<string, string>();

  for (const folder of folderNames) {
    const sanitizedFolder = sanitizeName(folder);
    const lockKey = lockKeys.find((key) => sanitizeName(key) === sanitizedFolder);
    identityByName.set(folder.toLowerCase(), lockKey || folder);
  }
  // Exact lock keys must retain their own identity, even when another key
  // sanitizes to the same on-disk folder name.
  for (const key of lockKeys) {
    identityByName.set(key.toLowerCase(), key);
  }
  for (const candidate of candidates) {
    identityByName.set(candidate.toLowerCase(), candidate);
  }

  const matched = new Set<string>();
  for (const request of requested) {
    const nameMatch = identityByName.get(request.toLowerCase());
    if (nameMatch) {
      matched.add(nameMatch);
      continue;
    }

    const sourceMatches = candidates.filter(
      (candidate) => lockEntries[candidate]?.source === request
    );
    if (sourceMatches.length > 0) {
      for (const candidate of sourceMatches) matched.add(candidate);
      continue;
    }

    // Keep the historical sanitized-name fallback for plugin skill names such
    // as `ce:review` and their on-disk `ce-review` folder.
    for (const candidate of resolveSkillsToRemove([request], folderNames, lockKeys)) {
      matched.add(candidate);
    }
  }

  return Array.from(matched);
}

export async function removeCommand(skillNames: string[], options: RemoveOptions) {
  // Auto-enable non-interactive mode when running inside an AI agent
  const agentResult = await detectAgent();
  if (agentResult.isAgent) {
    options.yes = true;
    p.log.info(
      pc.bgCyan(pc.black(pc.bold(` ${agentResult.agent.name} `))) +
        ' ' +
        'Agent detected — removing non-interactively'
    );
  }

  // `--skill '*'` is the documented synonym for selecting every skill.
  if (skillNames.includes('*')) {
    options.all = true;
    skillNames = skillNames.filter((name) => name !== '*');
  }

  // Footgun: `remove --skill foo --all` used to ignore `foo` and wipe everything,
  // because `--all` replaced the requested list with every installed skill.
  // Refuse the combination so agents/scripts cannot accidentally mass-delete.
  const namedSkills = skillNames.filter((name) => name !== '*');
  if (options.all && namedSkills.length > 0) {
    p.log.error('Cannot combine --all with specific skill names.');
    p.log.info(
      'Use `skills remove --all` to remove every skill, or omit --all to remove only the named skills.'
    );
    p.log.info(`Example: skills remove ${namedSkills[0]} -y`);
    process.exit(1);
  }

  const isGlobal = options.global ?? false;
  const cwd = process.cwd();

  const spinner = p.spinner();

  spinner.start('Scanning for installed skills…');
  const skillNamesSet = new Set<string>();

  const scanDir = async (dir: string) => {
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          skillNamesSet.add(entry.name);
        }
      }
    } catch (err) {
      if (err instanceof Error && (err as { code?: string }).code !== 'ENOENT') {
        p.log.warn(`Could not scan directory ${dir}: ${err.message}`);
      }
    }
  };

  if (isGlobal) {
    await scanDir(getCanonicalSkillsDir(true, cwd));
    for (const agent of Object.values(agents)) {
      if (agent.globalSkillsDir !== undefined) {
        await scanDir(agent.globalSkillsDir);
      }
    }
  } else {
    await scanDir(getCanonicalSkillsDir(false, cwd));
    for (const agent of Object.values(agents)) {
      await scanDir(join(cwd, agent.skillsDir));
    }
    // Eve subagents keep their skills under agent/subagents/<name>/skills.
    for (const subagent of getEveSubagents(cwd)) {
      await scanDir(getEveSubagentSkillsDir(subagent, cwd));
    }
  }

  const installedSkills = Array.from(skillNamesSet).sort();
  spinner.stop(`Found ${installedSkills.length} unique installed skill(s)`);

  // Read the relevant lock file once. Its keys represent stale skills as well as
  // skills that are still present on disk.
  const lockEntries = (isGlobal ? await readSkillLock() : await readLocalLock(cwd)).skills;
  const lockSkillsKeys = Object.keys(lockEntries);
  const removableSkills = getRemovalCandidates(installedSkills, lockSkillsKeys);
  const resolvedRequestedSkills =
    skillNames.length > 0 ? resolveRemoveTargets(skillNames, installedSkills, lockEntries) : [];

  if (removableSkills.length === 0) {
    p.outro(pc.yellow('No skills found to remove.'));
    return;
  }

  // Validate agent options BEFORE prompting for skill selection
  if (options.agent && options.agent.length > 0) {
    const validAgents = Object.keys(agents);
    const invalidAgents = options.agent.filter((a) => !validAgents.includes(a));

    if (invalidAgents.length > 0) {
      p.log.error(`Invalid agents: ${invalidAgents.join(', ')}`);
      p.log.info(`Valid agents: ${validAgents.join(', ')}`);
      process.exit(1);
    }
  }

  let selectedSkills: string[] = [];

  if (options.all) {
    selectedSkills = removableSkills;
  } else if (skillNames.length > 0) {
    selectedSkills = resolvedRequestedSkills;

    if (selectedSkills.length === 0) {
      p.log.error(`No matching skills found for: ${skillNames.join(', ')}`);
      return;
    }
  } else {
    const selected = await searchMultiselect({
      message: `Select skills to remove ${pc.dim('(space to toggle)')}`,
      items: buildRemoveChoices(installedSkills, lockEntries),
      required: true,
      selectGroups: true,
    });

    if (typeof selected === 'symbol') {
      p.cancel('Removal cancelled');
      process.exit(0);
    }

    selectedSkills = selected as string[];
  }

  let targetAgents: AgentType[];
  if (options.agent && options.agent.length > 0) {
    targetAgents = options.agent as AgentType[];
  } else {
    // When removing, we should target all known agents to ensure
    // ghost symlinks are cleaned up, even if the agent is not detected.
    targetAgents = Object.keys(agents) as AgentType[];
    spinner.stop(`Targeting ${targetAgents.length} potential agent(s)`);
  }

  if (!options.yes) {
    console.log();
    p.log.info('Skills to remove:');
    for (const skill of selectedSkills) {
      p.log.message(`  ${pc.red('•')} ${skill}`);
    }
    console.log();

    const confirmed = await p.confirm({
      message: `Are you sure you want to uninstall ${selectedSkills.length} skill(s)?`,
    });

    if (p.isCancel(confirmed) || !confirmed) {
      p.cancel('Removal cancelled');
      process.exit(0);
    }
  }

  spinner.start('Removing skills…');

  const results: {
    skill: string;
    success: boolean;
    source?: string;
    sourceType?: string;
    error?: string;
  }[] = [];

  for (const skillName of selectedSkills) {
    try {
      const canonicalPath = getCanonicalPath(skillName, { global: isGlobal, cwd });
      const sharesPathWithUnselectedSkill = removableSkills.some(
        (candidate) =>
          candidate !== skillName &&
          !selectedSkills.includes(candidate) &&
          sanitizeName(candidate) === sanitizeName(skillName)
      );

      for (const agentKey of targetAgents) {
        const agent = agents[agentKey];
        const skillPath = getInstallPath(skillName, agentKey, { global: isGlobal, cwd });

        // Determine potential paths to cleanup. For universal agents, getInstallPath
        // now returns the canonical path, so we also need to check their 'native'
        // directory to clean up any legacy symlinks.
        const pathsToCleanup = new Set([skillPath]);
        const sanitizedName = sanitizeName(skillName);
        if (isGlobal && agent.globalSkillsDir) {
          pathsToCleanup.add(join(agent.globalSkillsDir, sanitizedName));
        } else {
          pathsToCleanup.add(join(cwd, agent.skillsDir, sanitizedName));
          // Eve skills may also live in subagent directories.
          if (agentKey === 'eve') {
            for (const subagent of getEveSubagents(cwd)) {
              pathsToCleanup.add(join(getEveSubagentSkillsDir(subagent, cwd), sanitizedName));
            }
          }
        }

        for (const pathToCleanup of pathsToCleanup) {
          // A shared sanitized path belongs to an unselected lock identity too.
          if (sharesPathWithUnselectedSkill) {
            continue;
          }
          // Skip if this is the canonical path - we'll handle that after checking all agents
          if (pathToCleanup === canonicalPath) {
            continue;
          }

          try {
            const stats = await lstat(pathToCleanup).catch(() => null);
            if (stats) {
              await rm(pathToCleanup, { recursive: true, force: true });
            }
          } catch (err) {
            p.log.warn(
              `Could not remove skill from ${agent.displayName}: ${
                err instanceof Error ? err.message : String(err)
              }`
            );
          }
        }
      }

      // Only remove the canonical path if no other installed agents are using it.
      // This prevents breaking other agents when uninstalling from a specific agent (#287).
      const installedAgents = await detectInstalledAgents();
      const remainingAgents = installedAgents.filter((a) => !targetAgents.includes(a));

      let isStillUsed = false;
      for (const agentKey of remainingAgents) {
        const path = getInstallPath(skillName, agentKey, { global: isGlobal, cwd });
        const exists = await lstat(path).catch(() => null);
        if (exists) {
          isStillUsed = true;
          break;
        }
      }

      if (!sharesPathWithUnselectedSkill && !isStillUsed) {
        await rm(canonicalPath, { recursive: true, force: true });
      }

      let effectiveSource = 'local';
      let effectiveSourceType = 'local';

      // The lock entry tracks the canonical path, so it survives for as long as
      // that path does. Dropping it while another installed agent still links
      // the skill leaves the skill in place but no longer updatable (#1718).
      if (isGlobal) {
        const lockEntry = await getSkillFromLock(skillName);
        effectiveSource = lockEntry?.source || 'local';
        effectiveSourceType = lockEntry?.sourceType || 'local';
        if (!isStillUsed) {
          await removeSkillFromLock(skillName);
        }
      } else {
        const localLock = await readLocalLock(cwd);
        const lockEntry = localLock.skills[skillName];
        effectiveSource = lockEntry?.source || 'local';
        effectiveSourceType = lockEntry?.sourceType || 'local';
        if (!isStillUsed) {
          await removeSkillFromLocalLock(skillName, cwd);
        }
      }

      results.push({
        skill: skillName,
        success: true,
        source: effectiveSource,
        sourceType: effectiveSourceType,
      });
    } catch (err) {
      results.push({
        skill: skillName,
        success: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  spinner.stop('Removal process complete');

  const successful = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);

  // Track removal (grouped by source)
  if (successful.length > 0) {
    const bySource = new Map<string, { skills: string[]; sourceType?: string }>();

    for (const r of successful) {
      const source = r.source || 'local';
      const existing = bySource.get(source) || { skills: [] };
      existing.skills.push(r.skill);
      existing.sourceType = r.sourceType;
      bySource.set(source, existing);
    }

    for (const [source, data] of bySource) {
      track({
        event: 'remove',
        source,
        skills: data.skills.join(','),
        agents: targetAgents.join(','),
        ...(isGlobal && { global: '1' }),
        sourceType: data.sourceType,
      });
    }
  }

  if (successful.length > 0) {
    p.log.success(pc.green(`Successfully removed ${successful.length} skill(s)`));
  }

  if (failed.length > 0) {
    p.log.error(pc.red(`Failed to remove ${failed.length} skill(s)`));
    for (const r of failed) {
      p.log.message(`  ${pc.red('✗')} ${r.skill}: ${r.error}`);
    }
  }

  console.log();
  p.outro(pc.green('Done!'));
}

/**
 * Parse command line options for the remove command.
 * Separates skill names from options flags.
 *
 * Supports both positional names (`skills remove foo`) and `-s/--skill`
 * (documented in the CLI help). Unknown flags that start with `-` are ignored
 * so we do not treat `--skill` as a skill name when the flag is misspelled.
 */
export function parseRemoveOptions(args: string[]): { skills: string[]; options: RemoveOptions } {
  const options: RemoveOptions = {};
  const skills: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '-g' || arg === '--global') {
      options.global = true;
    } else if (arg === '-y' || arg === '--yes') {
      options.yes = true;
    } else if (arg === '--all') {
      options.all = true;
      options.yes = true;
    } else if (arg === '-s' || arg === '--skill') {
      i++;
      let nextArg = args[i];
      while (i < args.length && nextArg && !nextArg.startsWith('-')) {
        skills.push(nextArg);
        i++;
        nextArg = args[i];
      }
      i--; // Back up one since the loop will increment
    } else if (arg === '-a' || arg === '--agent') {
      options.agent = options.agent || [];
      i++;
      let nextArg = args[i];
      while (i < args.length && nextArg && !nextArg.startsWith('-')) {
        options.agent.push(nextArg);
        i++;
        nextArg = args[i];
      }
      i--; // Back up one since the loop will increment
    } else if (arg && !arg.startsWith('-')) {
      skills.push(arg);
    }
  }

  return { skills, options };
}
