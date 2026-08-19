import { homedir } from 'os';
import type { AgentType } from './types.ts';
import { agents } from './agents.ts';
import { listInstalledSkills, sanitizeName, type InstalledSkill } from './installer.ts';
import { sanitizeMetadata } from './sanitize.ts';
import { getAllLockedSkills } from './skill-lock.ts';
import { readLocalLock } from './local-lock.ts';
import { buildUpdateInstallSource, shouldUseFullDepthForUpdate } from './update-source.ts';

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[38;5;102m';
const TEXT = '\x1b[38;5;145m';
const CYAN = '\x1b[36m';
const YELLOW = '\x1b[33m';

interface ListOptions {
  global?: boolean;
  agent?: string[];
  json?: boolean;
  export?: boolean;
}

interface ListLockEntry {
  source: string;
  sourceUrl?: string;
  sourceType: string;
  pluginName?: string;
  ref?: string;
  skillPath?: string;
}

/**
 * Shortens a path for display: replaces homedir with ~ and cwd with .
 */
function shortenPath(fullPath: string, cwd: string): string {
  const home = homedir();
  if (fullPath.startsWith(home)) {
    return fullPath.replace(home, '~');
  }
  if (fullPath.startsWith(cwd)) {
    return '.' + fullPath.slice(cwd.length);
  }
  return fullPath;
}

/**
 * Formats a list of items, truncating if too many
 */
function formatList(items: string[], maxShow: number = 5): string {
  if (items.length <= maxShow) {
    return items.join(', ');
  }
  const shown = items.slice(0, maxShow);
  const remaining = items.length - maxShow;
  return `${shown.join(', ')} +${remaining} more`;
}

export function parseListOptions(args: string[]): ListOptions {
  const options: ListOptions = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '-g' || arg === '--global') {
      options.global = true;
    } else if (arg === '--json') {
      options.json = true;
    } else if (arg === '--export') {
      options.export = true;
    } else if (arg === '-a' || arg === '--agent') {
      options.agent = options.agent || [];
      // Collect all following arguments until next flag
      while (i + 1 < args.length && !args[i + 1]!.startsWith('-')) {
        options.agent.push(args[++i]!);
      }
    }
  }

  return options;
}

/** Quote a token for POSIX shells while keeping each command on one line. */
function shellQuote(value: string): string {
  const clean = value.replace(/[\x00-\x1f\x7f]/g, '');
  if (/^[A-Za-z0-9-._/:@]+$/.test(clean)) return clean;
  return `'${clean.replace(/'/g, `'\\''`)}'`;
}

function getExportSourceArg(entry: ListLockEntry): string {
  if (entry.sourceType === 'github') {
    const url = entry.sourceUrl ?? '';
    if (!url || /^https?:\/\/github\.com\//i.test(url)) {
      return entry.source;
    }
  }
  return entry.sourceUrl ?? entry.source;
}

export function buildExportCommands(
  installedSkills: InstalledSkill[],
  getLockEntry: (skillName: string) => ListLockEntry | undefined,
  scope: boolean
): { commands: string[]; skipped: string[] } {
  const groups = new Map<string, Map<boolean, string[]>>();
  const skipped: string[] = [];

  for (const skill of installedSkills) {
    const entry = getLockEntry(skill.name);
    if (!entry) {
      skipped.push(`${sanitizeMetadata(skill.name)} (no recorded source)`);
      continue;
    }
    if (entry.sourceType === 'local' || entry.sourceType === 'node_modules') {
      skipped.push(
        `${sanitizeMetadata(skill.name)} (${entry.sourceType === 'local' ? 'local path' : 'node_modules'}: ${sanitizeMetadata(entry.source)})`
      );
      continue;
    }

    const exportEntry = {
      ...entry,
      source: getExportSourceArg(entry),
      sourceUrl: undefined,
    };
    const sourceArg = buildUpdateInstallSource(exportEntry);
    if (!sourceArg) {
      skipped.push(`${sanitizeMetadata(skill.name)} (missing source URL)`);
      continue;
    }

    const fullDepth = shouldUseFullDepthForUpdate(exportEntry);
    const sourceGroups = groups.get(sourceArg) ?? new Map<boolean, string[]>();
    const group = sourceGroups.get(fullDepth) ?? [];
    group.push(skill.name);
    sourceGroups.set(fullDepth, group);
    groups.set(sourceArg, sourceGroups);
  }

  const commands: string[] = [];
  const sortedSources = [...groups.keys()].sort((a, b) => a.localeCompare(b));
  for (const sourceArg of sortedSources) {
    const sourceGroups = groups.get(sourceArg);
    if (!sourceGroups) continue;
    for (const fullDepth of [false, true]) {
      const names = sourceGroups.get(fullDepth)?.sort();
      if (!names) continue;
      commands.push(
        `skills add ${shellQuote(sourceArg)} --skill ${names.map(shellQuote).join(' ')}${fullDepth ? ' --full-depth' : ''}${scope ? ' -g' : ''} -y`
      );
    }
  }

  return { commands, skipped: skipped.sort() };
}

export async function runList(args: string[]): Promise<void> {
  const options = parseListOptions(args);

  // Default to project only (local), use -g for global
  const scope = options.global === true ? true : false;

  if (options.export && options.json) {
    console.log(`${YELLOW}--export cannot be combined with --json${RESET}`);
    process.exit(1);
  }

  // Validate agent filter if provided
  let agentFilter: AgentType[] | undefined;
  if (options.agent && options.agent.length > 0) {
    const validAgents = Object.keys(agents);
    const invalidAgents = options.agent.filter((a) => !validAgents.includes(a));

    if (invalidAgents.length > 0) {
      console.log(`${YELLOW}Invalid agents: ${invalidAgents.join(', ')}${RESET}`);
      console.log(`${DIM}Valid agents: ${validAgents.join(', ')}${RESET}`);
      process.exit(1);
    }

    agentFilter = options.agent as AgentType[];
  }

  const installedSkills = await listInstalledSkills({
    global: scope,
    agentFilter,
  });

  const cwd = process.cwd();
  // Fetch lock entries to get source and plugin grouping info for the selected scope.
  const lockedSkills: Record<string, ListLockEntry> = scope
    ? await getAllLockedSkills()
    : (await readLocalLock(cwd)).skills;
  const lockEntriesBySanitizedName = new Map(
    Object.entries(lockedSkills).map(([name, entry]) => [sanitizeName(name), entry])
  );
  const getLockEntry = (skillName: string): ListLockEntry | undefined =>
    lockedSkills[skillName] ?? lockEntriesBySanitizedName.get(sanitizeName(skillName));

  // Keep stdout pipeable into sh.
  if (options.export) {
    const { commands, skipped } = buildExportCommands(installedSkills, getLockEntry, scope);
    for (const command of commands) {
      console.log(command);
    }
    for (const note of skipped) {
      console.error(`${YELLOW}Skipped ${note} — not portable to another machine${RESET}`);
    }
    if (commands.length === 0 && skipped.length === 0) {
      console.error(`${DIM}No ${scope ? 'global' : 'project'} skills found.${RESET}`);
    }
    return;
  }

  // JSON output mode: structured, no ANSI, untruncated agent lists
  if (options.json) {
    const jsonOutput = installedSkills.map((skill) => {
      const lockEntry = getLockEntry(skill.name);
      return {
        name: skill.name,
        path: skill.canonicalPath,
        scope: skill.scope,
        agents: skill.agents.map((a) => agents[a].displayName),
        source: lockEntry?.source ?? null,
        sourceUrl: lockEntry?.sourceUrl ?? null,
        sourceType: lockEntry?.sourceType ?? null,
      };
    });
    console.log(JSON.stringify(jsonOutput, null, 2));
    return;
  }

  const scopeLabel = scope ? 'Global' : 'Project';

  if (installedSkills.length === 0) {
    if (options.json) {
      console.log('[]');
      return;
    }
    console.log(`${DIM}No ${scopeLabel.toLowerCase()} skills found.${RESET}`);
    if (scope) {
      console.log(`${DIM}Try listing project skills without -g${RESET}`);
    } else {
      console.log(`${DIM}Try listing global skills with -g${RESET}`);
    }
    return;
  }

  function printSkill(
    skill: InstalledSkill,
    indent: boolean = false,
    maxNameLength: number = 0,
    maxPathLength: number = 0
  ): void {
    const prefix = indent ? '  ' : '';
    const shortPath = shortenPath(skill.canonicalPath, cwd);
    const agentNames = skill.agents.map((a) => agents[a].displayName);
    const agentInfo =
      skill.agents.length > 0 ? formatList(agentNames) : `${YELLOW}not linked${RESET}`;

    // Pad skill name and path for alignment
    const paddedName = sanitizeMetadata(skill.name).padEnd(maxNameLength);
    const paddedPath = shortPath.padEnd(maxPathLength);

    // Determine source from lock file
    const lockEntry = getLockEntry(skill.name);
    const source = lockEntry?.source ?? null;
    const sourceLabel = source ? sanitizeMetadata(source) : 'local';

    console.log(`${prefix}${CYAN}${paddedName}${RESET} ${DIM}${paddedPath}${RESET}`);
    console.log(
      `${prefix}  ${DIM}Agents:${RESET} ${agentInfo}  ${DIM}Source:${RESET} ${sourceLabel}`
    );
  }

  console.log(`${BOLD}${scopeLabel} Skills${RESET}`);
  console.log();

  // Group skills by plugin
  const groupedSkills: Record<string, InstalledSkill[]> = {};
  const ungroupedSkills: InstalledSkill[] = [];

  for (const skill of installedSkills) {
    const lockEntry = getLockEntry(skill.name);
    if (lockEntry?.pluginName) {
      const group = lockEntry.pluginName;
      if (!groupedSkills[group]) {
        groupedSkills[group] = [];
      }
      groupedSkills[group].push(skill);
    } else {
      ungroupedSkills.push(skill);
    }
  }

  const hasGroups = Object.keys(groupedSkills).length > 0;

  if (hasGroups) {
    // Print groups sorted alphabetically
    const sortedGroups = Object.keys(groupedSkills).sort();
    for (const group of sortedGroups) {
      // Convert kebab-case to Title Case for display header
      const title = group
        .split('-')
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');

      console.log(`${BOLD}${title}${RESET}`);
      const skills = groupedSkills[group];
      if (skills) {
        // Calculate max lengths for alignment within this group
        let maxNameLength = 0;
        let maxPathLength = 0;
        for (const skill of skills) {
          const nameLength = sanitizeMetadata(skill.name).length;
          const pathLength = shortenPath(skill.canonicalPath, cwd).length;
          if (nameLength > maxNameLength) maxNameLength = nameLength;
          if (pathLength > maxPathLength) maxPathLength = pathLength;
        }
        for (const skill of skills) {
          printSkill(skill, true, maxNameLength, maxPathLength);
        }
      }
      console.log();
    }

    // Print ungrouped skills if any exist
    if (ungroupedSkills.length > 0) {
      console.log(`${BOLD}General${RESET}`);
      // Calculate max lengths for alignment within ungrouped skills
      let maxNameLength = 0;
      let maxPathLength = 0;
      for (const skill of ungroupedSkills) {
        const nameLength = sanitizeMetadata(skill.name).length;
        const pathLength = shortenPath(skill.canonicalPath, cwd).length;
        if (nameLength > maxNameLength) maxNameLength = nameLength;
        if (pathLength > maxPathLength) maxPathLength = pathLength;
      }
      for (const skill of ungroupedSkills) {
        printSkill(skill, true, maxNameLength, maxPathLength);
      }
      console.log();
    }
  } else {
    // No groups, print flat list as before
    // Calculate max lengths for alignment in flat list
    let maxNameLength = 0;
    let maxPathLength = 0;
    for (const skill of installedSkills) {
      const nameLength = sanitizeMetadata(skill.name).length;
      const pathLength = shortenPath(skill.canonicalPath, cwd).length;
      if (nameLength > maxNameLength) maxNameLength = nameLength;
      if (pathLength > maxPathLength) maxPathLength = pathLength;
    }
    for (const skill of installedSkills) {
      printSkill(skill, false, maxNameLength, maxPathLength);
    }
    console.log();
  }
}
