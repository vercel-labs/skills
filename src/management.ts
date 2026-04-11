import { readdir } from 'fs/promises';
import { dirname, join } from 'path';
import { agents, isUniversalAgent } from './agents.ts';
import { getInstalledSkillSnapshot, setInstalledSkillState } from './management-filesystem.ts';
import { normalizeGroupName, type ManagementState } from './management-state.ts';
import { readLocalManagementState, writeLocalManagementState } from './local-lock.ts';
import { getCanonicalSkillsDir, sanitizeName } from './installer.ts';
import { readGlobalManagementState, writeGlobalManagementState } from './skill-lock.ts';
import type { AgentType } from './types.ts';

type ToggleAction = 'enable' | 'disable';
type SelectorType = 'skills' | 'group' | 'all';

interface ScopeOptions {
  global?: boolean;
  cwd?: string;
}

interface ToggleParseResult {
  global?: boolean;
  selectorType?: SelectorType;
  skills: string[];
  groups: string[];
  all?: boolean;
}

interface MutationResult {
  applied: string[];
  skipped: Array<{ name: string; reason: string }>;
  failed: Array<{ name: string; reason: string }>;
}

export async function runToggleCommand(action: ToggleAction, args: string[]): Promise<void> {
  const parsed = parseToggleCommandArgs(args);
  const selectorCount =
    Number(parsed.skills.length > 0) +
    Number(parsed.groups.length > 0) +
    Number(Boolean(parsed.all));

  if (selectorCount !== 1 || !parsed.selectorType) {
    failCli(
      'Management commands require exactly one selector type: skill names, --group, or --all.'
    );
  }

  const scope: ScopeOptions = { global: parsed.global, cwd: process.cwd() };
  const management = await readManagementState(scope);
  const managerSkill = management.managerSkill;
  const targets = new Set<string>();
  const result: MutationResult = { applied: [], skipped: [], failed: [] };

  if (parsed.selectorType === 'skills') {
    for (const skillName of parsed.skills) {
      targets.add(sanitizeName(skillName));
    }
  } else if (parsed.selectorType === 'group') {
    for (const rawGroupName of parsed.groups) {
      const groupName = normalizeGroupName(rawGroupName);
      if (!groupName) {
        result.failed.push({ name: rawGroupName, reason: 'Invalid group name.' });
        continue;
      }

      const members = management.groups[groupName];
      if (!members) {
        result.failed.push({ name: groupName, reason: 'Group does not exist.' });
        continue;
      }

      for (const member of members) {
        targets.add(member);
      }
    }
  } else {
    for (const skillName of await listInstalledSkillNames(scope)) {
      targets.add(skillName);
    }
  }

  for (const skillName of Array.from(targets).sort()) {
    const snapshot = await getInstalledSkillSnapshot(skillName, scope);

    if (action === 'disable' && managerSkill === skillName) {
      if (parsed.selectorType === 'skills') {
        result.failed.push({
          name: skillName,
          reason: 'The protected manager skill cannot be disabled.',
        });
      } else {
        result.skipped.push({ name: skillName, reason: 'Skipped protected manager skill.' });
      }
      continue;
    }

    if (
      action === 'enable' &&
      managerSkill === skillName &&
      parsed.selectorType !== 'skills' &&
      snapshot.status === 'enabled'
    ) {
      result.skipped.push({ name: skillName, reason: 'Manager skill is already enabled.' });
      continue;
    }

    try {
      await setInstalledSkillState(skillName, action === 'enable' ? 'enabled' : 'disabled', scope);
      result.applied.push(skillName);
    } catch (error) {
      result.failed.push({
        name: skillName,
        reason: error instanceof Error ? error.message : 'Unknown error.',
      });
    }
  }

  printMutationResult(action === 'enable' ? 'Enabled' : 'Disabled', result, {
    emptyMessage: `No skills to ${action}.`,
  });
}

export async function runGroupCommand(args: string[]): Promise<void> {
  const [subcommand, ...rest] = args;

  switch (subcommand) {
    case 'create':
      await runGroupCreate(rest);
      return;
    case 'delete':
      await runGroupDelete(rest);
      return;
    case 'add':
      await runGroupAdd(rest);
      return;
    case 'remove':
      await runGroupRemove(rest);
      return;
    default:
      failCli('Usage: skills group <create|delete|add|remove> ...');
  }
}

export async function runManagerCommand(args: string[]): Promise<void> {
  const [subcommand, ...rest] = args;

  switch (subcommand) {
    case 'set':
      await runManagerSet(rest);
      return;
    case 'show':
      await runManagerShow(rest);
      return;
    case 'clear':
      await runManagerClear(rest);
      return;
    default:
      failCli('Usage: skills manager <set|show|clear> ...');
  }
}

function parseToggleCommandArgs(args: string[]): ToggleParseResult {
  const parsed: ToggleParseResult = {
    skills: [],
    groups: [],
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;

    if (arg === '-g' || arg === '--global') {
      parsed.global = true;
      continue;
    }

    if (arg === '--all') {
      parsed.all = true;
      parsed.selectorType = 'all';
      continue;
    }

    if (arg === '--group') {
      parsed.selectorType = 'group';
      while (i + 1 < args.length && !args[i + 1]!.startsWith('-')) {
        parsed.groups.push(args[++i]!);
      }
      continue;
    }

    if (arg?.startsWith('-')) {
      failCli(`Unknown option: ${arg}`);
    }

    parsed.selectorType = 'skills';
    parsed.skills.push(arg);
  }

  return parsed;
}

async function runGroupCreate(args: string[]): Promise<void> {
  const { global, values } = parseSimpleGlobalArgs(args);
  if (values.length === 0) {
    failCli('Usage: skills group create <group...> [-g]');
  }

  const scope: ScopeOptions = { global, cwd: process.cwd() };
  const management = await readManagementState(scope);
  const result: MutationResult = { applied: [], skipped: [], failed: [] };

  for (const rawGroupName of values) {
    const groupName = normalizeGroupName(rawGroupName);
    if (!groupName) {
      result.failed.push({ name: rawGroupName, reason: 'Invalid group name.' });
      continue;
    }

    if (groupName in management.groups) {
      result.failed.push({ name: groupName, reason: 'Group already exists.' });
      continue;
    }

    management.groups[groupName] = [];
    result.applied.push(groupName);
  }

  await writeManagementState(management, scope);
  printMutationResult('Created groups', result, { emptyMessage: 'No groups were created.' });
}

async function runGroupDelete(args: string[]): Promise<void> {
  const { global, values } = parseSimpleGlobalArgs(args);
  if (values.length === 0) {
    failCli('Usage: skills group delete <group...> [-g]');
  }

  const scope: ScopeOptions = { global, cwd: process.cwd() };
  const management = await readManagementState(scope);
  const result: MutationResult = { applied: [], skipped: [], failed: [] };

  for (const rawGroupName of values) {
    const groupName = normalizeGroupName(rawGroupName);
    if (!groupName) {
      result.failed.push({ name: rawGroupName, reason: 'Invalid group name.' });
      continue;
    }

    if (!(groupName in management.groups)) {
      result.failed.push({ name: groupName, reason: 'Group does not exist.' });
      continue;
    }

    delete management.groups[groupName];
    result.applied.push(groupName);
  }

  await writeManagementState(management, scope);
  printMutationResult('Deleted groups', result, { emptyMessage: 'No groups were deleted.' });
}

async function runGroupAdd(args: string[]): Promise<void> {
  const parsed = parseGroupSkillArgs(args, 'add');
  const scope: ScopeOptions = { global: parsed.global, cwd: process.cwd() };
  const management = await readManagementState(scope);

  if (!(parsed.groupName in management.groups)) {
    failCli(`Group "${parsed.groupName}" does not exist.`);
  }

  const result: MutationResult = { applied: [], skipped: [], failed: [] };
  const managerSkill = management.managerSkill;
  const members = new Set(management.groups[parsed.groupName] ?? []);

  for (const skillName of parsed.skillNames) {
    if (managerSkill === skillName) {
      result.failed.push({
        name: skillName,
        reason: 'The protected manager skill cannot be added to a group.',
      });
      continue;
    }

    const snapshot = await getInstalledSkillSnapshot(skillName, scope);
    if (snapshot.status === 'missing') {
      result.failed.push({ name: skillName, reason: 'Skill is not installed in this scope.' });
      continue;
    }

    const previousSize = members.size;
    members.add(skillName);
    if (members.size > previousSize) {
      result.applied.push(skillName);
    }
  }

  management.groups[parsed.groupName] = Array.from(members).sort();
  await writeManagementState(management, scope);

  printMutationResult(`Updated group ${parsed.groupName}`, result, {
    emptyMessage: `No skills were added to ${parsed.groupName}.`,
  });
}

async function runGroupRemove(args: string[]): Promise<void> {
  const parsed = parseGroupSkillArgs(args, 'remove');
  const scope: ScopeOptions = { global: parsed.global, cwd: process.cwd() };
  const management = await readManagementState(scope);

  if (!(parsed.groupName in management.groups)) {
    failCli(`Group "${parsed.groupName}" does not exist.`);
  }

  const result: MutationResult = { applied: [], skipped: [], failed: [] };
  const members = new Set(management.groups[parsed.groupName] ?? []);

  for (const skillName of parsed.skillNames) {
    if (!members.has(skillName)) {
      result.failed.push({ name: skillName, reason: 'Skill is not in this group.' });
      continue;
    }

    members.delete(skillName);
    result.applied.push(skillName);
  }

  management.groups[parsed.groupName] = Array.from(members).sort();
  await writeManagementState(management, scope);

  printMutationResult(`Updated group ${parsed.groupName}`, result, {
    emptyMessage: `No skills were removed from ${parsed.groupName}.`,
  });
}

async function runManagerSet(args: string[]): Promise<void> {
  const { global, values } = parseSimpleGlobalArgs(args);
  if (values.length !== 1) {
    failCli('Usage: skills manager set <skill> [-g]');
  }

  const skillName = sanitizeName(values[0]!);
  const scope: ScopeOptions = { global, cwd: process.cwd() };
  const snapshot = await getInstalledSkillSnapshot(skillName, scope);
  if (snapshot.status === 'missing') {
    failCli(`Skill "${skillName}" is not installed in this scope.`);
  }

  if (snapshot.status !== 'enabled') {
    try {
      await setInstalledSkillState(skillName, 'enabled', scope);
    } catch (error) {
      failCli(error instanceof Error ? error.message : 'Failed to enable manager skill.');
    }
  }

  const management = await readManagementState(scope);
  const removedGroups: string[] = [];
  const groups: ManagementState['groups'] = {};

  for (const [groupName, members] of Object.entries(management.groups)) {
    const nextMembers = members.filter((member) => member !== skillName);
    if (nextMembers.length !== members.length) {
      removedGroups.push(groupName);
    }
    groups[groupName] = nextMembers;
  }

  await writeManagementState(
    {
      groups,
      managerSkill: skillName,
    },
    scope
  );

  console.log(`Manager skill set to ${skillName}.`);
  if (removedGroups.length > 0) {
    console.log(`Removed ${skillName} from groups: ${removedGroups.sort().join(', ')}.`);
  }
}

async function runManagerShow(args: string[]): Promise<void> {
  const { global, values } = parseSimpleGlobalArgs(args);
  if (values.length > 0) {
    failCli('Usage: skills manager show [-g]');
  }

  const scope: ScopeOptions = { global, cwd: process.cwd() };
  const management = await readManagementState(scope);
  if (!management.managerSkill) {
    console.log('Manager skill: not set.');
    return;
  }

  const snapshot = await getInstalledSkillSnapshot(management.managerSkill, scope);
  if (snapshot.status === 'missing') {
    console.log(`Manager skill: ${management.managerSkill} (missing on disk).`);
    return;
  }

  console.log(`Manager skill: ${management.managerSkill}.`);
}

async function runManagerClear(args: string[]): Promise<void> {
  const { global, values } = parseSimpleGlobalArgs(args);
  if (values.length > 0) {
    failCli('Usage: skills manager clear [-g]');
  }

  const scope: ScopeOptions = { global, cwd: process.cwd() };
  const management = await readManagementState(scope);
  await writeManagementState({ groups: management.groups }, scope);
  console.log('Manager skill cleared.');
}

function parseSimpleGlobalArgs(args: string[]): { global?: boolean; values: string[] } {
  const values: string[] = [];
  let global = false;

  for (const arg of args) {
    if (arg === '-g' || arg === '--global') {
      global = true;
      continue;
    }

    if (arg.startsWith('-')) {
      failCli(`Unknown option: ${arg}`);
    }

    values.push(arg);
  }

  return { global, values };
}

function parseGroupSkillArgs(
  args: string[],
  verb: 'add' | 'remove'
): { global?: boolean; groupName: string; skillNames: string[] } {
  let global = false;
  const positionals: string[] = [];
  const skills: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;

    if (arg === '-g' || arg === '--global') {
      global = true;
      continue;
    }

    if (arg === '-s' || arg === '--skill') {
      while (i + 1 < args.length && !args[i + 1]!.startsWith('-')) {
        skills.push(sanitizeName(args[++i]!));
      }
      continue;
    }

    if (arg.startsWith('-')) {
      failCli(`Unknown option: ${arg}`);
    }

    positionals.push(arg);
  }

  if (positionals.length !== 1 || skills.length === 0) {
    failCli(`Usage: skills group ${verb} <group> --skill <skill...> [-g]`);
  }

  const groupName = normalizeGroupName(positionals[0]!);
  if (!groupName) {
    failCli('Invalid group name.');
  }

  return {
    global,
    groupName,
    skillNames: Array.from(new Set(skills)).sort(),
  };
}

async function listInstalledSkillNames(options: ScopeOptions): Promise<string[]> {
  const cwd = options.cwd || process.cwd();
  const roots = new Set<string>();
  const canonicalRoot = getCanonicalSkillsDir(Boolean(options.global), cwd);
  roots.add(canonicalRoot);
  roots.add(getDisabledSkillsDir(canonicalRoot));

  const seenAgentRoots = new Set<string>();
  for (const [agentType, agent] of Object.entries(agents) as [
    AgentType,
    (typeof agents)[AgentType],
  ][]) {
    if (isUniversalAgent(agentType)) {
      continue;
    }

    const skillsRoot = options.global ? agent.globalSkillsDir : join(cwd, agent.skillsDir);
    if (!skillsRoot || seenAgentRoots.has(skillsRoot)) {
      continue;
    }

    seenAgentRoots.add(skillsRoot);
    roots.add(skillsRoot);
    roots.add(getDisabledSkillsDir(skillsRoot));
  }

  const names = new Set<string>();
  for (const root of roots) {
    const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.isDirectory() || entry.isSymbolicLink()) {
        names.add(entry.name);
      }
    }
  }

  return Array.from(names).sort();
}

async function readManagementState(options: ScopeOptions): Promise<ManagementState> {
  if (options.global) {
    return readGlobalManagementState();
  }
  return readLocalManagementState(options.cwd);
}

async function writeManagementState(
  management: ManagementState,
  options: ScopeOptions
): Promise<void> {
  if (options.global) {
    await writeGlobalManagementState(management);
    return;
  }
  await writeLocalManagementState(management, options.cwd);
}

function getDisabledSkillsDir(skillsRoot: string): string {
  return join(dirname(skillsRoot), 'disabled_skills');
}

function printMutationResult(
  verb: string,
  result: MutationResult,
  options: { emptyMessage: string }
): void {
  if (result.applied.length === 0 && result.skipped.length === 0 && result.failed.length === 0) {
    console.log(options.emptyMessage);
    return;
  }

  if (result.applied.length > 0) {
    console.log(`${verb} ${result.applied.length} item(s): ${result.applied.join(', ')}`);
  }

  if (result.skipped.length > 0) {
    console.log(`Skipped ${result.skipped.length} item(s):`);
    for (const entry of result.skipped) {
      console.log(`  - ${entry.name}: ${entry.reason}`);
    }
  }

  if (result.failed.length > 0) {
    console.log(`Failed ${result.failed.length} item(s):`);
    for (const entry of result.failed) {
      console.log(`  - ${entry.name}: ${entry.reason}`);
    }
    process.exit(1);
  }
}

function failCli(message: string): never {
  console.log(message);
  process.exit(1);
}
