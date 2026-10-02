import { homedir } from 'os';
import { readdir } from 'fs/promises';
import { join } from 'path';
import type { AgentType } from './types.ts';
import { agents } from './agents.ts';
import {
  listInstalledSkills,
  sanitizeName,
  resolveInstallDir,
  type InstalledSkill,
} from './installer.ts';
import { hasSkillMd } from './skills.ts';
import { sanitizeMetadata } from './sanitize.ts';
import { getAllLockedSkills, getAllDirLocks, getDirLockedSkills } from './skill-lock.ts';
import {
  readLocalLock,
  getProjectSkillsDir,
  isProjectRelativeDir,
  resolveProjectSkillsDir,
} from './local-lock.ts';

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
  /** List skills in a custom install directory (`add --dir`). */
  dir?: string;
}

interface ListLockEntry {
  source: string;
  sourceUrl?: string;
  sourceType: string;
  pluginName?: string;
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
    } else if (arg === '--dir' || arg?.startsWith('--dir=')) {
      const value = arg === '--dir' ? args[i + 1] : arg.slice('--dir='.length);
      if (arg === '--dir' && value && !value.startsWith('-')) i++;
      if (value && !value.startsWith('-')) options.dir = value;
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

  const projectCwd = process.cwd();
  if (options.dir) {
    if (isProjectRelativeDir(options.dir)) {
      const projectDir = resolveProjectSkillsDir(options.dir, projectCwd);
      if (!projectDir) {
        console.log(`${YELLOW}--dir ${options.dir} is outside the project${RESET}`);
        process.exit(1);
      }
      await listDir(projectDir, options.json === true, 'project');
    } else {
      await listDir(resolveInstallDir(options.dir), options.json === true, 'user');
    }
    return;
  }

  // A project that pins skillsDir in skills-lock.json lists that directory.
  if (!options.global && !(options.agent && options.agent.length > 0)) {
    let projectSkillsDir: string | undefined;
    try {
      projectSkillsDir = await getProjectSkillsDir(projectCwd);
    } catch (error) {
      console.log(`${YELLOW}${error instanceof Error ? error.message : String(error)}${RESET}`);
      process.exit(1);
    }
    if (projectSkillsDir) {
      await listDir(projectSkillsDir, options.json === true, 'project');
      return;
    }
  }

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
      console.log();
      await printCustomDirsHint(cwd);
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

  if (scope) await printCustomDirsHint(cwd);
}

/**
 * Point at custom install directories (`add --dir`), which live outside the
 * agent directories and so are not part of the global listing itself.
 */
async function printCustomDirsHint(cwd: string): Promise<void> {
  const dirs = Object.entries(await getAllDirLocks());
  if (dirs.length === 0) return;
  console.log(`${BOLD}Custom Directories${RESET}`);
  for (const [dir, skills] of dirs.sort(([a], [b]) => a.localeCompare(b))) {
    const count = Object.keys(skills).length;
    console.log(
      `  ${CYAN}${shortenPath(dir, cwd)}${RESET} ${DIM}${count} skill(s) · skills ls --dir ${shortenPath(dir, cwd)}${RESET}`
    );
  }
  console.log();
}

/**
 * List skills in a custom install directory, with sources from the lock file.
 */
async function listDir(dir: string, json: boolean, scope: 'project' | 'user'): Promise<void> {
  const cwd = process.cwd();
  const lockSkills =
    scope === 'project' ? (await readLocalLock(cwd)).skills : await getDirLockedSkills(dir);
  const lockBySanitized = new Map(
    Object.entries(lockSkills).map(([name, entry]) => [sanitizeName(name), entry])
  );

  const skills: Array<{ name: string; path: string }> = [];
  try {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const path = join(dir, entry.name);
      if (await hasSkillMd(path)) skills.push({ name: entry.name, path });
    }
  } catch {
    // Missing directory lists as empty
  }
  skills.sort((a, b) => a.name.localeCompare(b.name));

  const withLock = skills.map((skill) => ({
    ...skill,
    lock: lockSkills[skill.name] ?? lockBySanitized.get(sanitizeName(skill.name)),
  }));

  if (json) {
    console.log(
      JSON.stringify(
        withLock.map(({ name, path, lock }) => ({
          name,
          path,
          scope: scope === 'project' ? 'project' : 'dir',
          agents: [],
          source: lock?.source ?? null,
          sourceUrl: lock?.sourceUrl ?? null,
          sourceType: lock?.sourceType ?? null,
        })),
        null,
        2
      )
    );
    return;
  }

  const label = shortenPath(dir, cwd);
  if (withLock.length === 0) {
    console.log(`${DIM}No skills found in ${label}.${RESET}`);
    return;
  }

  console.log(`${BOLD}Skills in ${label}${RESET}`);
  console.log();
  const maxNameLength = Math.max(...withLock.map((s) => sanitizeMetadata(s.name).length));
  for (const { name, lock } of withLock) {
    const source = lock?.source ? sanitizeMetadata(lock.source) : 'local';
    console.log(
      `${CYAN}${sanitizeMetadata(name).padEnd(maxNameLength)}${RESET}  ${DIM}Source:${RESET} ${source}`
    );
  }
  console.log();
}
