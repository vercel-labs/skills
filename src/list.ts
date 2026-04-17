import { homedir } from 'os';
import type { AgentType } from './types.ts';
import { agents } from './agents.ts';
import { listInstalledSkills, type InstalledSkill } from './installer.ts';
import { getAllLockedSkills, readGlobalManagementState } from './skill-lock.ts';
import { getGroupsForSkill } from './management-state.ts';
import { readLocalManagementState } from './local-lock.ts';

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
  groups?: boolean;
}

type ListSkillStatus = InstalledSkill['status'] | 'missing';

interface ManagedListSkill {
  name: string;
  path?: string;
  scope: 'project' | 'global';
  agents: string[];
  status: ListSkillStatus;
  groups: string[];
  isManager: boolean;
}

function getStatusPrefix(status: ListSkillStatus): string {
  switch (status) {
    case 'disabled':
      return '[-]';
    case 'inconsistent':
      return '[!]';
    case 'missing':
      return '[?]';
    default:
      return '[+]';
  }
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
    } else if (arg === '--groups') {
      options.groups = true;
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

export async function runList(args: string[]): Promise<void> {
  const options = parseListOptions(args);

  // Default to project only (local), use -g for global
  const scope = options.global === true ? true : false;

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
  const management = scope
    ? await readGlobalManagementState()
    : await readLocalManagementState(process.cwd());
  const managedSkills = buildManagedListSkills(
    installedSkills,
    management,
    scope ? 'global' : 'project'
  );

  if (options.groups) {
    const groupedOutput = buildGroupedSkillOutput(managedSkills, management.groups);
    const warnings = buildGroupWarnings(groupedOutput.groups, scope);

    if (options.json) {
      const groups: Record<string, ManagedListSkill[]> = {};
      for (const [groupName, skills] of groupedOutput.groups) {
        groups[groupName] = skills;
      }

      console.log(
        JSON.stringify(
          {
            groups,
            ungrouped: groupedOutput.ungrouped,
            managerSkill: management.managerSkill,
            warnings,
          },
          null,
          2
        )
      );
      return;
    }

    if (groupedOutput.groups.length === 0 && groupedOutput.ungrouped.length === 0) {
      console.log(`${DIM}No ${scope ? 'global' : 'project'} skills found.${RESET}`);
      if (scope) {
        console.log(`${DIM}Try listing project skills without -g${RESET}`);
      } else {
        console.log(`${DIM}Try listing global skills with -g${RESET}`);
      }
      return;
    }

    for (const [groupName, skills] of groupedOutput.groups) {
      console.log(`${groupName} (${countEnabled(skills)}/${skills.length} enabled)`);
      for (const skill of skills) {
        printGroupSkill(skill);
      }
      console.log();
    }

    if (groupedOutput.ungrouped.length > 0 || groupedOutput.groups.length > 0) {
      console.log(
        `UNGROUPED SKILLS (${countEnabled(groupedOutput.ungrouped)}/${groupedOutput.ungrouped.length} enabled)`
      );
      for (const skill of groupedOutput.ungrouped) {
        printGroupSkill(skill);
      }
      console.log();
    }

    if (warnings.length > 0) {
      console.log('Warnings:');
      for (const warning of warnings) {
        console.log(`  ${warning}`);
      }
      console.log();
    }

    return;
  }

  // JSON output mode: structured, no ANSI, untruncated agent lists
  if (options.json) {
    const jsonOutput = installedSkills.map((skill) => managedSkills.get(skill.name)!);
    console.log(JSON.stringify(jsonOutput, null, 2));
    return;
  }

  // Fetch lock entries to get plugin grouping info
  const lockedSkills = scope ? await getAllLockedSkills() : {};

  const cwd = process.cwd();
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

  function printSkill(skill: InstalledSkill, indent: boolean = false): void {
    const prefix = indent ? '  ' : '';
    const shortPath = shortenPath(skill.canonicalPath, cwd);
    const agentNames = skill.agents.map((a) => agents[a].displayName);
    const agentInfo =
      skill.agents.length > 0 ? formatList(agentNames) : `${YELLOW}not linked${RESET}`;
    const statusPrefix = getStatusPrefix(skill.status);
    console.log(`${prefix}${statusPrefix} ${CYAN}${skill.name}${RESET} ${DIM}${shortPath}${RESET}`);
    console.log(`${prefix}  ${DIM}Agents:${RESET} ${agentInfo}`);
  }

  console.log(`${BOLD}${scopeLabel} Skills${RESET}`);
  console.log();

  // Group skills by plugin
  const groupedSkills: Record<string, InstalledSkill[]> = {};
  const ungroupedSkills: InstalledSkill[] = [];

  for (const skill of installedSkills) {
    const lockEntry = lockedSkills[skill.name];
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
        for (const skill of skills) {
          printSkill(skill, true);
        }
      }
      console.log();
    }

    // Print ungrouped skills if any exist
    if (ungroupedSkills.length > 0) {
      console.log(`${BOLD}General${RESET}`);
      for (const skill of ungroupedSkills) {
        printSkill(skill, true);
      }
      console.log();
    }
  } else {
    // No groups, print flat list as before
    for (const skill of installedSkills) {
      printSkill(skill);
    }
    console.log();
  }
}

function buildManagedListSkills(
  installedSkills: InstalledSkill[],
  management: Awaited<ReturnType<typeof readLocalManagementState>>,
  scope: 'project' | 'global'
): Map<string, ManagedListSkill> {
  const managedSkills = new Map<string, ManagedListSkill>();

  for (const skill of installedSkills) {
    managedSkills.set(skill.name, {
      name: skill.name,
      path: skill.canonicalPath,
      scope,
      agents: skill.agents.map((agentType) => agents[agentType].displayName),
      status: skill.status,
      groups: getGroupsForSkill(management, skill.name),
      isManager: management.managerSkill === skill.name,
    });
  }

  for (const skillName of Object.values(management.groups).flat()) {
    if (!managedSkills.has(skillName)) {
      managedSkills.set(skillName, {
        name: skillName,
        scope,
        agents: [],
        status: 'missing',
        groups: getGroupsForSkill(management, skillName),
        isManager: management.managerSkill === skillName,
      });
    }
  }

  return managedSkills;
}

function buildGroupedSkillOutput(
  managedSkills: Map<string, ManagedListSkill>,
  groups: Record<string, string[]>
): {
  groups: Array<[string, ManagedListSkill[]]>;
  ungrouped: ManagedListSkill[];
} {
  const groupedSkillNames = new Set<string>();
  const groupedOutput: Array<[string, ManagedListSkill[]]> = [];

  for (const groupName of Object.keys(groups).sort()) {
    const skills = (groups[groupName] ?? [])
      .map((skillName) => managedSkills.get(skillName))
      .filter((skill): skill is ManagedListSkill => skill !== undefined)
      .sort((a, b) => a.name.localeCompare(b.name));

    for (const skill of skills) {
      groupedSkillNames.add(skill.name);
    }

    groupedOutput.push([groupName, skills]);
  }

  const ungrouped = Array.from(managedSkills.values())
    .filter((skill) => skill.status !== 'missing' && !groupedSkillNames.has(skill.name))
    .sort((a, b) => a.name.localeCompare(b.name));

  return { groups: groupedOutput, ungrouped };
}

function buildGroupWarnings(
  groups: Array<[string, ManagedListSkill[]]>,
  isGlobalScope: boolean
): string[] {
  const warnings = new Set<string>();
  const scopeFlag = isGlobalScope ? ' -g' : '';

  for (const [, skills] of groups) {
    for (const skill of skills) {
      if (skill.status === 'missing') {
        warnings.add(
          `${skill.name} is missing on disk. Run skills remove ${skill.name}${scopeFlag} to clean up stale metadata.`
        );
      } else if (skill.status === 'inconsistent') {
        warnings.add(`${skill.name} has an inconsistent installed state on disk.`);
      }
    }
  }

  return Array.from(warnings).sort();
}

function countEnabled(skills: ManagedListSkill[]): number {
  return skills.filter((skill) => skill.status === 'enabled').length;
}

function printGroupSkill(skill: ManagedListSkill): void {
  const suffix = skill.status === 'missing' ? ' (missing)' : '';
  console.log(`  ${getStatusPrefix(skill.status)} ${skill.name}${suffix}`);
}
