import type { AgentType } from '../types.ts';
import { CuiActions } from './actions.ts';
import { CoreCuiBackend } from './core-backend.ts';
import { formatInstalledSkills, formatSkillDetails } from './list-view.ts';
import { cuiMultiSelectPrompt, cuiSelectPrompt } from './select-prompt.ts';
import {
  color,
  colors,
  confirmPrompt as terminalConfirmPrompt,
  inputPrompt as terminalInputPrompt,
  renderBox,
} from './terminal-ui.ts';
import type {
  CuiAgentOption,
  CuiInstalledSkill,
  CuiSearchResult,
  SkillLayer,
  SkillLayerFilter,
} from './types.ts';

const COMMAND_OPTIONS = [
  'List all skills',
  'List project skills',
  'List global skills',
  'Filter by agent',
  'Update skill',
  'Remove skill',
  'Move skill',
  'Search skills',
  'Install skill',
  'Exit',
] as const;

const MENU_OPTIONS = [
  'List all skills',
  'List project skills',
  'List global skills',
  'Filter by agent',
  'Search skills',
  'Install skill',
  'Exit',
] as const;

const SKILL_ACTIONS = ['Update skill', 'Remove skill', 'Move skill', 'Back', 'Exit'] as const;
const BULK_SKILL_ACTIONS = [
  'Update selected',
  'Remove selected',
  'Move selected',
  'Clear selection',
  'Back',
  'Exit',
] as const;

type CommandOption = (typeof COMMAND_OPTIONS)[number];
type MenuOption = (typeof COMMAND_OPTIONS)[number];
type SkillAction = (typeof SKILL_ACTIONS)[number];
type BulkSkillAction = (typeof BULK_SKILL_ACTIONS)[number];

export interface CuiCliOptions {
  skipConfirmation: boolean;
}

interface ListContext {
  layer: SkillLayerFilter;
  agents?: AgentType[];
  title: string;
}

export function parseCuiOptions(args: string[]): { options: CuiCliOptions; rest: string[] } {
  const rest: string[] = [];
  const options: CuiCliOptions = { skipConfirmation: false };

  for (const arg of args) {
    if (arg === '--no-confirmation') {
      options.skipConfirmation = true;
    } else {
      rest.push(arg);
    }
  }

  return { options, rest };
}

export function showCuiHelp(): void {
  console.log(`
Usage: skills cui [options]

Launch the guided terminal UI for managing skills.

Options:
  --no-confirmation   Skip confirmation prompts for destructive CUI actions
  --help, -h          Show this help message

Examples:
  skills cui
  skills cui --no-confirmation
`);
}

function center(text: string, width = 72): string {
  const padding = Math.max(0, Math.floor((width - text.length) / 2));
  return `${' '.repeat(padding)}${text}`;
}

function printWindow(title: string, instructions: string[], content: string[] = []): void {
  const body = [
    color(center('SKILLS COMMAND CENTER'), colors.cyan),
    color(
      'Discover, install, update, move, and remove agent skills from one guided terminal UI.',
      colors.gray
    ),
    color('Explore more skills at https://www.skills.sh/', colors.blue),
    '',
    ...instructions,
    ...(content.length > 0 ? ['', ...content] : []),
  ].join('\n');
  console.log(renderBox(title.toUpperCase(), body));
}

class CuiPromptCancel extends Error {
  constructor() {
    super('Cancelled');
    this.name = 'CuiPromptCancel';
  }
}

function isCancelError(error: unknown): boolean {
  return (
    error instanceof CuiPromptCancel || (error instanceof Error && error.message === 'Cancelled')
  );
}

async function selectPrompt<T>(config: Parameters<typeof cuiSelectPrompt<T>>[0]): Promise<T> {
  return cuiSelectPrompt<T>(config);
}

async function inputPrompt(config: Parameters<typeof terminalInputPrompt>[0]): Promise<string> {
  return terminalInputPrompt(config);
}

async function confirmPrompt(
  config: Parameters<typeof terminalConfirmPrompt>[0]
): Promise<boolean> {
  return terminalConfirmPrompt(config);
}

function parseMenuSelection(args: string[]): { selection?: MenuOption; values: string[] } {
  for (let size = Math.min(3, args.length); size >= 1; size--) {
    const candidate = args.slice(0, size).join(' ');
    if (COMMAND_OPTIONS.includes(candidate as CommandOption)) {
      return { selection: candidate as MenuOption, values: args.slice(size) };
    }
  }
  return { values: args };
}

async function promptMenu(status?: string): Promise<MenuOption | 'cancel'> {
  printWindow(
    'Main menu',
    [
      'Choose a command, then continue to the next relevant options.',
      'Skill-specific update, remove, and move actions are available after selecting a listed skill.',
      'Press Esc or choose Exit to quit.',
    ],
    status ? [color(`Status: ${status}`, colors.green)] : []
  );
  try {
    return await selectPrompt<MenuOption>({
      message: 'Command:',
      options: MENU_OPTIONS.map((option) => ({ label: option, value: option })),
    });
  } catch (error) {
    if (isCancelError(error)) return 'cancel';
    throw error;
  }
}

async function readField(args: string[], index: number, message: string): Promise<string> {
  if (args[index] !== undefined) return args[index]!;
  return inputPrompt({ message });
}

async function confirmAction(
  options: CuiCliOptions,
  args: string[],
  index: number,
  word: 'remove' | 'move',
  message: string
): Promise<boolean> {
  if (options.skipConfirmation) return true;
  if (args[index] !== undefined) return args[index] === word;
  return confirmPrompt({ message, defaultValue: false });
}

function parseLayer(value: string, fallback: SkillLayer = 'project'): SkillLayer {
  return value.trim() === 'global' ? 'global' : fallback;
}

function oppositeLayer(layer: SkillLayer): SkillLayer {
  return layer === 'project' ? 'global' : 'project';
}

function parseAgentSelection(value: string): AgentType[] {
  return value
    .split(',')
    .map((agent) => agent.trim())
    .filter(Boolean) as AgentType[];
}

async function defaultDetectedAgents(actions: CuiActions): Promise<AgentType[]> {
  const detected = (await actions.detectAgents?.()) ?? [];
  return detected.filter((agent: CuiAgentOption) => agent.detected).map((agent) => agent.id);
}

async function promptInstallOptions(
  actions: CuiActions,
  values: string[],
  source: string
): Promise<{ layer: SkillLayer; agents: AgentType[] }> {
  const layerInput = (
    await readField(values, 1, 'Layer (project or global, default project):')
  ).trim();
  const layer = parseLayer(layerInput || 'project');
  const detectedAgents = await defaultDetectedAgents(actions);
  const defaultAgents = detectedAgents.join(',');
  const agentInput = (
    await readField(
      values,
      2,
      `Agents comma-separated${defaultAgents ? ` (default ${defaultAgents})` : ''}:`
    )
  ).trim();
  const agents = parseAgentSelection(agentInput || defaultAgents);
  if (agents.length === 0) throw new Error(`Select at least one agent to install ${source}.`);
  return { layer, agents };
}

function formatSearchResults(results: CuiSearchResult[]): string[] {
  if (results.length === 0) return ['No matching skills found.'];
  return results.map((result) => {
    const installs = result.installs === undefined ? '' : ` — ${result.installs} install(s)`;
    return `- ${result.name} — ${result.source}${installs}`;
  });
}

async function installFromSource(
  actions: CuiActions,
  values: string[],
  source: string,
  skills?: string[]
): Promise<string> {
  const { layer, agents } = await promptInstallOptions(actions, values, source);
  const result = await actions.install({ source, layer, agents, skills });
  const message = result.message ?? `Installed from ${source}.`;
  console.log(message);
  return message;
}

async function showSearchFlow(
  actions: CuiActions,
  values: string[],
  interactive: boolean
): Promise<'continue' | 'exit'> {
  const query = (
    await readField(values, 0, 'Search keywords (leave blank for open search):')
  ).trim();
  const results = await actions.search({ query });
  printWindow(
    'Search skills',
    ['Review search results.', 'Select a result to install, or exit.'],
    formatSearchResults(results)
  );
  if (!interactive || results.length === 0) return 'continue';

  const selected = await selectPrompt<string>({
    message: 'Search result:',
    options: [
      ...results.map((result, index) => ({
        label: result.name,
        value: String(index),
        description: result.source,
      })),
      { label: 'Back', value: '__back' },
      { label: 'Exit', value: '__exit' },
    ],
  });

  if (selected === '__exit') return 'exit';
  if (selected === '__back') return 'continue';
  const result = results[Number(selected)];
  if (!result) return 'continue';
  await installFromSource(actions, [], result.source, [result.name]);
  return 'continue';
}

async function updateSkill(actions: CuiActions, skill: CuiInstalledSkill): Promise<string> {
  const result = await actions.update({ names: [skill.name], layer: skill.layer });
  const message = result.message ?? 'Update complete.';
  console.log(message);
  return message;
}

async function removeSkill(
  actions: CuiActions,
  options: CuiCliOptions,
  skill: CuiInstalledSkill
): Promise<string> {
  const ok = options.skipConfirmation
    ? true
    : await confirmPrompt({
        message: `Remove ${skill.name} from ${skill.layer}?`,
        defaultValue: false,
      });
  if (!ok) {
    console.log('Remove cancelled.');
    return 'Remove cancelled.';
  }
  const result = await actions.remove({
    names: [skill.name],
    layer: skill.layer,
    skipConfirmation: true,
  });
  const message = result.message ?? 'Remove complete.';
  console.log(message);
  return message;
}

async function moveSkill(
  actions: CuiActions,
  options: CuiCliOptions,
  skill: CuiInstalledSkill
): Promise<string> {
  const toLayer = oppositeLayer(skill.layer);
  const ok = options.skipConfirmation
    ? true
    : await confirmPrompt({ message: `Move ${skill.name} to ${toLayer}?`, defaultValue: false });
  if (!ok) {
    console.log('Move cancelled.');
    return 'Move cancelled.';
  }
  const result = await actions.move({
    name: skill.name,
    fromLayer: skill.layer,
    toLayer,
    skipConfirmation: true,
  });
  const message = result.message ?? (result.ok ? 'Move complete.' : 'Move failed.');
  console.log(message);
  return message;
}

function plural(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? '' : 's'}`;
}

function groupSkillsByLayer(skills: CuiInstalledSkill[]): Map<SkillLayer, CuiInstalledSkill[]> {
  const groups = new Map<SkillLayer, CuiInstalledSkill[]>();
  for (const skill of skills) {
    groups.set(skill.layer, [...(groups.get(skill.layer) ?? []), skill]);
  }
  return groups;
}

async function updateSelectedSkills(
  actions: CuiActions,
  skills: CuiInstalledSkill[]
): Promise<string> {
  for (const [layer, layerSkills] of groupSkillsByLayer(skills)) {
    await actions.update({
      names: layerSkills.map((skill) => skill.name),
      layer,
    });
  }
  const message = `Updated ${plural(skills.length, 'selected skill')}.`;
  console.log(message);
  return message;
}

async function removeSelectedSkills(
  actions: CuiActions,
  options: CuiCliOptions,
  skills: CuiInstalledSkill[]
): Promise<string> {
  const ok = options.skipConfirmation
    ? true
    : await confirmPrompt({
        message: `Remove ${plural(skills.length, 'selected skill')}?`,
        defaultValue: false,
      });
  if (!ok) {
    console.log('Remove selected cancelled.');
    return 'Remove selected cancelled.';
  }

  for (const [layer, layerSkills] of groupSkillsByLayer(skills)) {
    await actions.remove({
      names: layerSkills.map((skill) => skill.name),
      layer,
      skipConfirmation: true,
    });
  }
  const message = `Removed ${plural(skills.length, 'selected skill')}.`;
  console.log(message);
  return message;
}

function formatMoveSummary(skills: CuiInstalledSkill[]): string {
  const groups = groupSkillsByLayer(skills);
  const parts: string[] = [];
  const projectCount = groups.get('project')?.length ?? 0;
  const globalCount = groups.get('global')?.length ?? 0;
  if (projectCount > 0) parts.push(`${plural(projectCount, 'project skill')} to global`);
  if (globalCount > 0) parts.push(`${plural(globalCount, 'global skill')} to project`);
  return parts.join(' and ');
}

function findBulkMoveConflicts(
  selectedSkills: CuiInstalledSkill[],
  allSkills: CuiInstalledSkill[]
): string[] {
  return selectedSkills
    .filter((skill) =>
      allSkills.some(
        (candidate) =>
          candidate.name === skill.name && candidate.layer === oppositeLayer(skill.layer)
      )
    )
    .map((skill) => `${skill.name} already exists in ${oppositeLayer(skill.layer)}`);
}

async function moveSelectedSkills(
  actions: CuiActions,
  options: CuiCliOptions,
  skills: CuiInstalledSkill[],
  allSkills: CuiInstalledSkill[]
): Promise<string> {
  const conflicts = findBulkMoveConflicts(skills, allSkills);
  if (conflicts.length > 0) {
    const message = `Move selected blocked: ${conflicts.join('; ')}.`;
    console.log(message);
    return message;
  }

  const ok = options.skipConfirmation
    ? true
    : await confirmPrompt({
        message: `Move ${formatMoveSummary(skills)}?`,
        defaultValue: false,
      });
  if (!ok) {
    console.log('Move selected cancelled.');
    return 'Move selected cancelled.';
  }

  const failures: string[] = [];
  for (const skill of skills) {
    const result = await actions.move({
      name: skill.name,
      fromLayer: skill.layer,
      toLayer: oppositeLayer(skill.layer),
      skipConfirmation: true,
    });
    if (!result.ok) failures.push(result.message ?? `${skill.name} failed`);
  }

  const moved = skills.length - failures.length;
  const message =
    failures.length === 0
      ? `Moved ${plural(skills.length, 'selected skill')}.`
      : `Moved ${plural(moved, 'selected skill')}; ${failures.length} failed: ${failures.join('; ')}`;
  console.log(message);
  return message;
}

async function promptBulkSkillAction(
  actions: CuiActions,
  options: CuiCliOptions,
  skills: CuiInstalledSkill[],
  allSkills: CuiInstalledSkill[]
): Promise<'back' | 'clear' | 'exit' | { status: string }> {
  printWindow(
    'Bulk skill actions',
    [`Selected: ${plural(skills.length, 'skill')}`, 'Choose an action for all marked skills.'],
    skills.slice(0, 8).map((skill) => `- ${skill.name} (${skill.layer})`)
  );
  const action = await selectPrompt<BulkSkillAction>({
    message: 'Bulk action:',
    options: BULK_SKILL_ACTIONS.map((item) => ({ label: item, value: item })),
  });

  if (action === 'Exit') return 'exit';
  if (action === 'Back') return 'back';
  if (action === 'Clear selection') return 'clear';
  if (action === 'Update selected') return { status: await updateSelectedSkills(actions, skills) };
  if (action === 'Remove selected') {
    return { status: await removeSelectedSkills(actions, options, skills) };
  }
  if (action === 'Move selected')
    return { status: await moveSelectedSkills(actions, options, skills, allSkills) };
  return 'back';
}

async function promptSkillAction(
  actions: CuiActions,
  options: CuiCliOptions,
  skill: CuiInstalledSkill
): Promise<'back' | 'exit' | { status: string }> {
  printWindow(
    'Skill actions',
    ['Review skill details, then choose an action.'],
    formatSkillDetails(skill)
  );
  const action = await selectPrompt<SkillAction>({
    message: 'Next action:',
    options: SKILL_ACTIONS.map((item) => ({ label: item, value: item })),
  });

  if (action === 'Exit') return 'exit';
  if (action === 'Back') return 'back';
  if (action === 'Update skill') return { status: await updateSkill(actions, skill) };
  if (action === 'Remove skill') return { status: await removeSkill(actions, options, skill) };
  if (action === 'Move skill') return { status: await moveSkill(actions, options, skill) };
  return 'back';
}

async function showListFlow(
  actions: CuiActions,
  options: CuiCliOptions,
  context: ListContext,
  interactive: boolean
): Promise<'continue' | 'exit' | { status: string }> {
  const skills = await actions.list({ layer: context.layer, agents: context.agents });
  printWindow(
    context.title,
    [
      'Review installed skills.',
      'Press Space to mark skills for bulk actions, or Enter with no marks for one skill.',
    ],
    formatInstalledSkills(skills)
  );

  if (!interactive) return 'continue';
  if (skills.length === 0) return 'continue';

  while (true) {
    const result = await cuiMultiSelectPrompt<number>({
      message: 'Skill:',
      maxVisible: 10,
      options: [
        ...skills.map((skill, index) => ({
          label: skill.name,
          value: index,
          description: `${skill.layer} — ${skill.agents.join(', ') || 'not linked'}`,
        })),
        { label: 'Back', value: -1, description: 'Return to previous menu' },
        { label: 'Exit', value: -2, description: 'Quit the CUI' },
      ],
    });

    if (result.type === 'single') {
      if (result.value === -2) return 'exit';
      if (result.value === -1) return 'continue';
      const skill = skills[result.value];
      if (!skill) return 'continue';
      const actionResult = await promptSkillAction(actions, options, skill);
      if (actionResult === 'exit') return 'exit';
      if (typeof actionResult === 'object') return actionResult;
      return 'continue';
    }

    if (result.values.includes(-2)) return 'exit';
    if (result.values.includes(-1)) return 'continue';
    const selectedSkills = result.values
      .map((index) => skills[index])
      .filter((skill): skill is CuiInstalledSkill => Boolean(skill));
    if (selectedSkills.length === 0) return 'continue';
    const bulkResult = await promptBulkSkillAction(actions, options, selectedSkills, skills);
    if (bulkResult === 'exit') return 'exit';
    if (bulkResult === 'clear') continue;
    if (typeof bulkResult === 'object') return bulkResult;
    return 'continue';
  }
}

async function runSingleCommand(
  actions: CuiActions,
  options: CuiCliOptions,
  selection: MenuOption,
  values: string[]
): Promise<void> {
  if (selection === 'List all skills') {
    await showListFlow(actions, options, { layer: 'all', title: 'All skills' }, false);
  } else if (selection === 'List project skills') {
    await showListFlow(actions, options, { layer: 'project', title: 'Project skills' }, false);
  } else if (selection === 'List global skills') {
    await showListFlow(actions, options, { layer: 'global', title: 'Global skills' }, false);
  } else if (selection === 'Filter by agent') {
    const agent = (
      await readField(values, 0, 'Agent id (for example: claude-code, codex, cursor):')
    ).trim();
    await showListFlow(
      actions,
      options,
      { layer: 'all', agents: [agent as AgentType], title: `Skills for ${agent}` },
      false
    );
  } else if (selection === 'Update skill') {
    const name = (await readField(values, 0, 'Skill name:')).trim();
    const layerInput = (await readField(values, 1, 'Layer (project, global, or all):')).trim();
    const layer = layerInput === 'project' || layerInput === 'global' ? layerInput : 'all';
    const result = await actions.update({ names: [name], layer });
    console.log(result.message ?? 'Update complete.');
  } else if (selection === 'Remove skill') {
    const name = (await readField(values, 0, 'Skill name:')).trim();
    const layer = parseLayer(await readField(values, 1, 'Layer (project or global):'));
    const ok = await confirmAction(options, values, 2, 'remove', `Remove ${name}?`);
    if (!ok) {
      console.log('Remove cancelled.');
      return;
    }
    const result = await actions.remove({ names: [name], layer, skipConfirmation: true });
    console.log(result.message ?? 'Remove complete.');
  } else if (selection === 'Move skill') {
    const name = (await readField(values, 0, 'Skill name:')).trim();
    const fromLayer = parseLayer(await readField(values, 1, 'Current layer (project or global):'));
    const ok = await confirmAction(options, values, 2, 'move', `Move ${name} to the other layer?`);
    if (!ok) {
      console.log('Move cancelled.');
      return;
    }
    const result = await actions.move({
      name,
      fromLayer,
      toLayer: oppositeLayer(fromLayer),
      skipConfirmation: true,
    });
    console.log(result.message ?? 'Move complete.');
  } else if (selection === 'Search skills') {
    await showSearchFlow(actions, values, false);
  } else if (selection === 'Install skill') {
    const source = (
      await readField(values, 0, 'Folder, GitHub shorthand, git URL, or full URL:')
    ).trim();
    await installFromSource(actions, values, source);
  } else {
    console.log('Goodbye.');
  }
}

export async function runCui(args: string[] = []): Promise<void> {
  if (args.includes('--help') || args.includes('-h')) {
    showCuiHelp();
    return;
  }

  const { options, rest } = parseCuiOptions(args);
  const { selection: parsedSelection, values } = parseMenuSelection(rest);
  const actions = new CuiActions(new CoreCuiBackend());

  if (parsedSelection) {
    await runSingleCommand(actions, options, parsedSelection, values);
    if (options.skipConfirmation) {
      console.log('Confirmation prompts are disabled for destructive CUI actions.');
    }
    return;
  }

  let lastStatus: string | undefined;
  while (true) {
    const selection = await promptMenu(lastStatus);
    if (selection === 'cancel' || selection === 'Exit') {
      console.log('Goodbye.');
      return;
    }
    const result = await (async () => {
      if (selection === 'List all skills')
        return showListFlow(actions, options, { layer: 'all', title: 'All skills' }, true);
      if (selection === 'List project skills')
        return showListFlow(actions, options, { layer: 'project', title: 'Project skills' }, true);
      if (selection === 'List global skills')
        return showListFlow(actions, options, { layer: 'global', title: 'Global skills' }, true);
      if (selection === 'Filter by agent') {
        const agent = (
          await inputPrompt({ message: 'Agent id (for example: claude-code, codex, cursor):' })
        ).trim();
        return showListFlow(
          actions,
          options,
          { layer: 'all', agents: [agent as AgentType], title: `Skills for ${agent}` },
          true
        );
      }
      if (selection === 'Search skills') return showSearchFlow(actions, [], true);
      if (selection === 'Install skill') {
        const source = (
          await inputPrompt({ message: 'Folder, GitHub shorthand, git URL, or full URL:' })
        ).trim();
        lastStatus = await installFromSource(actions, [], source);
        return 'continue' as const;
      }
      await runSingleCommand(actions, options, selection, []);
      return 'continue' as const;
    })().catch((error) => {
      if (isCancelError(error)) {
        lastStatus = 'Command cancelled.';
        return 'continue' as const;
      }
      throw error;
    });
    if (result === 'exit') return;
    if (typeof result === 'object') lastStatus = result.status;
  }
}
