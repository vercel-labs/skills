import * as p from '@clack/prompts';
import pc from 'picocolors';
import { readdir, rm, lstat } from 'fs/promises';
import { join, sep } from 'path';
import { homedir } from 'os';
import { agents, detectInstalledAgents, getEveSubagents } from './agents.ts';
import { track } from './telemetry.ts';
import { detectAgent } from './detect-agent.ts';
import { removeSkillFromLock, getSkillFromLock, readSkillLock } from './skill-lock.ts';
import { readLocalLock, removeSkillFromLocalLock } from './local-lock.ts';
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
  project?: boolean;
  agent?: string[];
  yes?: boolean;
  all?: boolean;
}

/** A skill to remove, paired with the scope it is installed in. */
export interface RemovalTarget {
  name: string;
  global: boolean;
}

export function scopeLabel(global: boolean): string {
  return global ? 'Global' : 'Project';
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

/**
 * Decide which scopes a remove run touches.
 *
 * Explicit flags always win. Otherwise only the interactive picker looks at
 * both scopes — named skills and --all stay project-scoped so that existing
 * non-interactive invocations keep removing exactly what they removed before.
 */
export function resolveRemoveScopes(
  options: RemoveOptions,
  hasSkillNames: boolean
): Array<{ global: boolean }> {
  const project = { global: false };
  const global = { global: true };

  if (options.global && options.project) return [project, global];
  if (options.global) return [global];
  if (options.project) return [project];

  const isInteractiveSelection = !options.all && !hasSkillNames;
  return isInteractiveSelection ? [project, global] : [project];
}

/**
 * Build the grouped option list for the interactive picker, one group per
 * scope. Values carry their scope so a name installed both globally and in the
 * project stays two distinct, independently selectable entries.
 */
export function buildScopedChoices(
  skillsByScope: Array<{ global: boolean; names: string[]; dir: string }>
): Record<string, Array<{ value: RemovalTarget; label: string }>> {
  const groups: Record<string, Array<{ value: RemovalTarget; label: string }>> = {};

  for (const { global, names, dir } of skillsByScope) {
    if (names.length === 0) continue;
    groups[`${scopeLabel(global)} ${pc.dim(`(${dir})`)}`] = names.map((name) => ({
      value: { name, global },
      label: name,
    }));
  }

  return groups;
}

/**
 * Resolve requested skill names to canonical removal targets.
 *
 * On-disk folder names are the result of sanitizeName() at install time, but
 * lock-file keys keep the original name, which may contain characters
 * sanitizeName() rewrites — e.g. the ':' in plugin skills such as "ce:review"
 * maps to the folder "ce-review". Matching purely on folder names therefore
 * misses lock-only or name-mismatched skills (and stale lock entries whose
 * folder is already gone). Every candidate is canonicalized by its sanitized
 * name, preferring the lock key, so downstream disk cleanup (which
 * re-sanitizes) and lock removal (which needs the exact key) both target the
 * right thing.
 */
export function resolveSkillsToRemove(
  requested: string[],
  folderNames: string[],
  lockKeys: string[] = []
): string[] {
  const identityBySanitized = new Map<string, string>();
  for (const folder of folderNames) {
    identityBySanitized.set(sanitizeName(folder), folder);
  }
  // Lock keys win: they carry the exact key needed for lock removal.
  for (const key of lockKeys) {
    identityBySanitized.set(sanitizeName(key), key);
  }

  const matched = new Set<string>();
  for (const name of requested) {
    const hit = identityBySanitized.get(sanitizeName(name));
    if (hit) matched.add(hit);
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

  const cwd = process.cwd();
  const scopes = resolveRemoveScopes(options, skillNames.length > 0);

  const spinner = p.spinner();

  spinner.start('Scanning for installed skills…');

  const scanScope = async (isGlobal: boolean): Promise<string[]> => {
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

    return Array.from(skillNamesSet).sort();
  };

  // Read lock file keys up front. These are needed both to decide whether there is
  // anything to remove (a skill may be missing from disk but still leave a stale lock
  // entry) and to clean up those stale entries below.
  const readLockKeys = async (isGlobal: boolean): Promise<string[]> =>
    isGlobal
      ? Object.keys((await readSkillLock()).skills)
      : Object.keys((await readLocalLock(cwd)).skills);

  const scanned: Array<{ global: boolean; names: string[]; lockKeys: string[] }> = [];
  for (const { global } of scopes) {
    scanned.push({
      global,
      names: await scanScope(global),
      lockKeys: await readLockKeys(global),
    });
  }

  const installedCount = scanned.reduce((total, scope) => total + scope.names.length, 0);
  spinner.stop(`Found ${installedCount} unique installed skill(s)`);

  const resolvedRequestedTargets: RemovalTarget[] = [];
  if (options.all || skillNames.length > 0) {
    for (const scope of scanned) {
      const requested = options.all ? [...scope.names, ...scope.lockKeys] : skillNames;
      for (const name of resolveSkillsToRemove(requested, scope.names, scope.lockKeys)) {
        resolvedRequestedTargets.push({ name, global: scope.global });
      }
    }
  }

  if (installedCount === 0 && resolvedRequestedTargets.length === 0) {
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

  let selectedTargets: RemovalTarget[] = [];

  if (options.all) {
    selectedTargets = resolvedRequestedTargets;
  } else if (skillNames.length > 0) {
    selectedTargets = resolvedRequestedTargets;

    if (selectedTargets.length === 0) {
      p.log.error(`No matching skills found for: ${skillNames.join(', ')}`);
      return;
    }
  } else {
    const message = `Select skills to remove ${pc.dim('(space to toggle)')}`;
    let selected: RemovalTarget[] | symbol;

    if (scanned.length > 1) {
      // Both scopes are in play: group them so it is obvious which copy of a
      // skill is about to be removed.
      selected = await p.groupMultiselect<RemovalTarget>({
        message,
        options: buildScopedChoices(
          scanned.map((scope) => ({
            global: scope.global,
            names: scope.names,
            dir: shortenPath(getCanonicalSkillsDir(scope.global, cwd), cwd),
          }))
        ),
        required: true,
        selectableGroups: true,
      });
    } else {
      const scope = scanned[0]!;
      const picked = await p.multiselect({
        message,
        options: scope.names.map((name) => ({ value: name, label: name })),
        required: true,
      });
      selected = p.isCancel(picked)
        ? picked
        : (picked as string[]).map((name) => ({ name, global: scope.global }));
    }

    if (p.isCancel(selected)) {
      p.cancel('Removal cancelled');
      process.exit(0);
    }

    // Re-resolve per scope so lock-only keys (e.g. "ce:review" behind the
    // "ce-review" folder) are removed under their exact key.
    for (const scope of scanned) {
      const namesInScope = (selected as RemovalTarget[])
        .filter((target) => target.global === scope.global)
        .map((target) => target.name);
      if (namesInScope.length === 0) continue;
      for (const name of resolveSkillsToRemove(namesInScope, scope.names, scope.lockKeys)) {
        selectedTargets.push({ name, global: scope.global });
      }
    }
  }

  const spansScopes = new Set(selectedTargets.map((target) => target.global)).size > 1;

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
    for (const target of selectedTargets) {
      const scopeTag = spansScopes
        ? ` ${pc.dim(`(${scopeLabel(target.global).toLowerCase()})`)}`
        : '';
      p.log.message(`  ${pc.red('•')} ${target.name}${scopeTag}`);
    }
    console.log();

    const confirmed = await p.confirm({
      message: `Are you sure you want to uninstall ${selectedTargets.length} skill(s)?`,
    });

    if (p.isCancel(confirmed) || !confirmed) {
      p.cancel('Removal cancelled');
      process.exit(0);
    }
  }

  spinner.start('Removing skills…');

  const results: {
    skill: string;
    global: boolean;
    success: boolean;
    source?: string;
    sourceType?: string;
    error?: string;
  }[] = [];

  for (const { name: skillName, global: isGlobal } of selectedTargets) {
    try {
      const canonicalPath = getCanonicalPath(skillName, { global: isGlobal, cwd });

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

      if (!isStillUsed) {
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
        global: isGlobal,
        success: true,
        source: effectiveSource,
        sourceType: effectiveSourceType,
      });
    } catch (err) {
      results.push({
        skill: skillName,
        global: isGlobal,
        success: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  spinner.stop('Removal process complete');

  const successful = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);

  // Track removal (grouped by scope, then source)
  if (successful.length > 0) {
    const byScopeAndSource = new Map<
      string,
      { global: boolean; source: string; skills: string[]; sourceType?: string }
    >();

    for (const r of successful) {
      const source = r.source || 'local';
      const key = `${r.global ? 'global' : 'project'} ${source}`;
      const existing = byScopeAndSource.get(key) || { global: r.global, source, skills: [] };
      existing.skills.push(r.skill);
      existing.sourceType = r.sourceType;
      byScopeAndSource.set(key, existing);
    }

    for (const data of byScopeAndSource.values()) {
      track({
        event: 'remove',
        source: data.source,
        skills: data.skills.join(','),
        agents: targetAgents.join(','),
        ...(data.global && { global: '1' }),
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
 */
export function parseRemoveOptions(args: string[]): { skills: string[]; options: RemoveOptions } {
  const options: RemoveOptions = {};
  const skills: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '-g' || arg === '--global') {
      options.global = true;
    } else if (arg === '-p' || arg === '--project') {
      options.project = true;
    } else if (arg === '-y' || arg === '--yes') {
      options.yes = true;
    } else if (arg === '--all') {
      options.all = true;
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
