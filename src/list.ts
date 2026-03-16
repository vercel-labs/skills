import { homedir } from 'os';
import type { TargetType } from './types.ts';
import { targets } from './targets.ts';
import { listInstalledAgents, type InstalledAgent } from './installer.ts';
import { getAllLockedAgents } from './agent-lock.ts';

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[38;5;102m';
const TEXT = '\x1b[38;5;145m';
const CYAN = '\x1b[36m';
const YELLOW = '\x1b[33m';

interface ListOptions {
  global?: boolean;
  target?: string[];
  json?: boolean;
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
    } else if (arg === '-t' || arg === '--target') {
      options.target = options.target || [];
      // Collect all following arguments until next flag
      while (i + 1 < args.length && !args[i + 1]!.startsWith('-')) {
        options.target.push(args[++i]!);
      }
    }
  }

  return options;
}

export async function runList(args: string[]): Promise<void> {
  const options = parseListOptions(args);

  // Default to project only (local), use -g for global
  const scope = options.global === true ? true : false;

  // Validate agent filter if provided
  let targetFilter: TargetType[] | undefined;
  if (options.target && options.target.length > 0) {
    const validAgents = Object.keys(targets);
    const invalidAgents = options.target.filter((a) => !validAgents.includes(a));

    if (invalidAgents.length > 0) {
      console.log(`${YELLOW}Invalid agents: ${invalidAgents.join(', ')}${RESET}`);
      console.log(`${DIM}Valid agents: ${validAgents.join(', ')}${RESET}`);
      process.exit(1);
    }

    targetFilter = options.target as TargetType[];
  }

  const installedAgents = await listInstalledAgents({
    global: scope,
    targetFilter,
  });

  // JSON output mode: structured, no ANSI, untruncated agent lists
  if (options.json) {
    const jsonOutput = installedAgents.map((agent) => ({
      name: agent.name,
      path: agent.canonicalPath,
      scope: agent.scope,
      agents: agent.agents.map((a) => targets[a].displayName),
    }));
    console.log(JSON.stringify(jsonOutput, null, 2));
    return;
  }

  // Fetch lock entries to get plugin grouping info
  const lockedSkills = await getAllLockedAgents();

  const cwd = process.cwd();
  const scopeLabel = scope ? 'Global' : 'Project';

  if (installedAgents.length === 0) {
    if (options.json) {
      console.log('[]');
      return;
    }
    console.log(`${DIM}No ${scopeLabel.toLowerCase()} agents found.${RESET}`);
    if (scope) {
      console.log(`${DIM}Try listing project agents without -g${RESET}`);
    } else {
      console.log(`${DIM}Try listing global agents with -g${RESET}`);
    }
    return;
  }

  function printSkill(agent: InstalledAgent, indent: boolean = false): void {
    const prefix = indent ? '  ' : '';
    const shortPath = shortenPath(agent.canonicalPath, cwd);
    const agentNames = agent.agents.map((a) => targets[a].displayName);
    const agentInfo =
      agent.agents.length > 0 ? formatList(agentNames) : `${YELLOW}not linked${RESET}`;
    console.log(`${prefix}${CYAN}${agent.name}${RESET} ${DIM}${shortPath}${RESET}`);
    console.log(`${prefix}  ${DIM}Agents:${RESET} ${agentInfo}`);
  }

  console.log(`${BOLD}${scopeLabel} Agents${RESET}`);
  console.log();

  // Group agents by plugin
  const groupedSkills: Record<string, InstalledAgent[]> = {};
  const ungroupedSkills: InstalledAgent[] = [];

  for (const agent of installedAgents) {
    const lockEntry = lockedSkills[agent.name];
    if (lockEntry?.pluginName) {
      const group = lockEntry.pluginName;
      if (!groupedSkills[group]) {
        groupedSkills[group] = [];
      }
      groupedSkills[group].push(agent);
    } else {
      ungroupedSkills.push(agent);
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
      const agents = groupedSkills[group];
      if (agents) {
        for (const agent of agents) {
          printSkill(agent, true);
        }
      }
      console.log();
    }

    // Print ungrouped agents if any exist
    if (ungroupedSkills.length > 0) {
      console.log(`${BOLD}General${RESET}`);
      for (const agent of ungroupedSkills) {
        printSkill(agent, true);
      }
      console.log();
    }
  } else {
    // No groups, print flat list as before
    for (const agent of installedAgents) {
      printSkill(agent);
    }
    console.log();
  }
}
