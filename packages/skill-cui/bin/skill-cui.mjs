#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { colors, confirmPrompt, inputPrompt, renderBox, selectPrompt } from '../lib/terminal-ui.mjs';

const execFileAsync = promisify(execFile);
const MENU_OPTIONS = [
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
];
const SKILL_ACTIONS = ['Update skill', 'Remove skill', 'Move skill', 'Back', 'Exit'];

function parseOptions(args) {
  const rest = [];
  const options = { skipConfirmation: false };
  for (const arg of args) {
    if (arg === '--no-confirmation') options.skipConfirmation = true;
    else rest.push(arg);
  }
  return { options, rest };
}

function showHelp() {
  console.log(`
Usage: skill-cui [options]

Launch the standalone terminal UI for the skills CLI.

The standalone CUI invokes the public npx skills command and parses structured output where
available. It does not import private internals from the skills package.

Options:
  --no-confirmation   Skip confirmation prompts for destructive CUI actions
  --help, -h          Show this help message

Examples:
  npx skill-cui
  npx skill-cui --no-confirmation
`);
}

function center(text, width = 72) {
  const padding = Math.max(0, Math.floor((width - text.length) / 2));
  return `${' '.repeat(padding)}${text}`;
}

function printWindow(title, instructions, content = []) {
  const body = [
    colors.cyan(center('SKILLS COMMAND CENTER')),
    colors.gray('Discover, install, update, move, and remove agent skills from one guided terminal UI.'),
    colors.blue('Explore more skills at https://www.skills.sh/'),
    '',
    ...instructions,
    ...(content.length ? ['', ...content] : []),
  ].join('\n');
  console.log(renderBox(title.toUpperCase(), body));
}

function parseMenuSelection(args) {
  for (let size = Math.min(3, args.length); size >= 1; size--) {
    const candidate = args.slice(0, size).join(' ');
    if (MENU_OPTIONS.includes(candidate)) return { selection: candidate, values: args.slice(size) };
  }
  return { values: args };
}

async function promptMenu() {
  printWindow('Main menu', [
    'Choose a command, then continue to the next relevant options.',
    'Use Update skill here for the guided equivalent of `npx skills update`.',
    'Exit is always available.',
  ]);
  return selectPrompt({
    message: 'Command:',
    options: MENU_OPTIONS.map((option) => ({ label: option, value: option })),
  });
}

async function runSkills(args) {
  try {
    return await execFileAsync('npx', ['-y', 'skills', ...args], {
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 1024 * 1024 * 10,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const stderr = typeof error.stderr === 'string' ? error.stderr : '';
    throw new Error(`Failed to run npx skills ${args.join(' ')}: ${stderr || message}`);
  }
}

async function listSkills(layer, agent) {
  const args = ['list', '--json'];
  if (layer === 'global') args.push('--global');
  if (agent) args.push('--agent', agent);
  const { stdout } = await runSkills(args);
  const parsed = JSON.parse(stdout || '[]');
  return parsed.map((skill) => ({ ...skill, layer }));
}

async function listByLayerFilter(layer, agent) {
  if (layer === 'project') return listSkills('project', agent);
  if (layer === 'global') return listSkills('global', agent);
  return [...(await listSkills('project', agent)), ...(await listSkills('global', agent))];
}

async function updateSkill(name, layer) {
  const args = ['update', name, '--yes'];
  if (layer === 'project') args.push('--project');
  if (layer === 'global') args.push('--global');
  await runSkills(args);
}

async function removeSkill(name, layer, skipConfirmation) {
  const args = ['remove', name];
  if (layer === 'global') args.push('--global');
  if (skipConfirmation) args.push('--yes');
  await runSkills(args);
}

async function moveSkill(name, fromLayer, skipConfirmation) {
  const [skill] = (await listSkills(fromLayer)).filter((item) => item.name === name);
  if (!skill?.path) throw new Error(`Could not find ${name} in ${fromLayer} skills.`);
  const toLayer = fromLayer === 'project' ? 'global' : 'project';
  const addArgs = ['add', skill.path, '--yes'];
  if (toLayer === 'global') addArgs.push('--global');
  for (const agent of skill.agentIds ?? []) addArgs.push('--agent', agent);
  await runSkills(addArgs);
  await removeSkill(name, fromLayer, skipConfirmation);
  return toLayer;
}

function parseAgentSelection(value) {
  return value
    .split(',')
    .map((agent) => agent.trim())
    .filter(Boolean);
}

async function installFromSource(values, source) {
  const layerInput = (
    await readField(values, 1, 'Layer (project or global, default project):')
  ).trim();
  const agentInput = (await readField(values, 2, 'Agents comma-separated:')).trim();
  const agents = parseAgentSelection(agentInput);
  if (agents.length === 0) throw new Error(`Select at least one agent to install ${source}.`);

  const args = ['add', source, '--yes'];
  if (layerInput === 'global') args.push('--global');
  for (const agent of agents) args.push('--agent', agent);
  await runSkills(args);
  console.log(`Installed from ${source}.`);
}

function formatSkills(skills, layers = ['project', 'global']) {
  const lines = [];
  for (const layer of layers) {
    const layerSkills = skills.filter((skill) => skill.layer === layer);
    const label = layer === 'project' ? 'Project' : 'Global';
    lines.push(`${label} skills (${layerSkills.length})`);
    if (layerSkills.length === 0) {
      lines.push(`  No ${layer} skills found.`);
      continue;
    }
    for (const skill of layerSkills.sort((a, b) => a.name.localeCompare(b.name))) {
      const agents = skill.agents?.length ? skill.agents.join(', ') : 'not linked';
      const path = skill.path ? ` — ${skill.path}` : '';
      lines.push(`  - ${skill.name} [${agents}]${path}`);
    }
  }
  return lines;
}

function printLines(lines) {
  for (const line of lines) console.log(line);
}

async function readField(args, index, message) {
  if (args[index] !== undefined) return args[index];
  return inputPrompt({ message });
}

async function confirmAction(options, args, index, word, message) {
  if (options.skipConfirmation) return true;
  if (args[index] !== undefined) return args[index] === word;
  return confirmPrompt({ message, defaultValue: false });
}

function parseLayer(value, fallback = 'project') {
  return value.trim() === 'global' ? 'global' : fallback;
}

function oppositeLayer(layer) {
  return layer === 'project' ? 'global' : 'project';
}

async function promptSkillAction(options, skill) {
  printWindow('Skill actions', [`Selected: ${skill.name}`, `Layer: ${skill.layer}`]);
  const action = await selectPrompt({
    message: 'Next action:',
    options: SKILL_ACTIONS.map((item) => ({ label: item, value: item })),
  });
  if (action === 'Exit') return 'exit';
  if (action === 'Back') return 'back';
  if (action === 'Update skill') {
    await updateSkill(skill.name, skill.layer);
    console.log('Update complete.');
  }
  if (action === 'Remove skill') {
    const ok =
      options.skipConfirmation ||
      (await confirmPrompt({ message: `Remove ${skill.name}?`, defaultValue: false }));
    if (!ok) console.log('Remove cancelled.');
    else {
      await removeSkill(skill.name, skill.layer, true);
      console.log('Remove complete.');
    }
  }
  if (action === 'Move skill') {
    const toLayer = oppositeLayer(skill.layer);
    const ok =
      options.skipConfirmation ||
      (await confirmPrompt({ message: `Move ${skill.name} to ${toLayer}?`, defaultValue: false }));
    if (!ok) console.log('Move cancelled.');
    else console.log(`Moved to ${await moveSkill(skill.name, skill.layer, true)}.`);
  }
  return 'back';
}

async function showListFlow(options, context, interactive) {
  const skills = await listByLayerFilter(context.layer, context.agent);
  printWindow(
    context.title,
    ['Review installed skills.', 'Select one skill for update/remove/move, or exit.'],
    formatSkills(skills)
  );
  if (!interactive || skills.length === 0) return 'continue';
  const selected = await selectPrompt({
    message: 'Skill:',
    options: [
      ...skills.map((skill) => ({
        label: skill.name,
        value: skill.name,
        description: `${skill.layer} — ${skill.agents?.join(', ') || 'not linked'}`,
      })),
      { label: 'Back', value: '__back' },
      { label: 'Exit', value: '__exit' },
    ],
  });
  if (selected === '__exit') return 'exit';
  if (selected === '__back') return 'continue';
  const skill = skills.find((item) => item.name === selected);
  if (!skill) return 'continue';
  return (await promptSkillAction(options, skill)) === 'exit' ? 'exit' : 'continue';
}

async function runSingleCommand(options, selection, values) {
  if (selection === 'List all skills') {
    await showListFlow(options, { layer: 'all', title: 'All skills' }, false);
  } else if (selection === 'List project skills') {
    await showListFlow(options, { layer: 'project', title: 'Project skills' }, false);
  } else if (selection === 'List global skills') {
    await showListFlow(options, { layer: 'global', title: 'Global skills' }, false);
  } else if (selection === 'Filter by agent') {
    const agent = (
      await readField(values, 0, 'Agent id (for example: claude-code, codex, cursor):')
    ).trim();
    await showListFlow(options, { layer: 'all', agent, title: `Skills for ${agent}` }, false);
  } else if (selection === 'Update skill') {
    const name = (await readField(values, 0, 'Skill name:')).trim();
    const layer = (await readField(values, 1, 'Layer (project, global, or all):')).trim();
    await updateSkill(name, layer);
    console.log('Update complete.');
  } else if (selection === 'Remove skill') {
    const name = (await readField(values, 0, 'Skill name:')).trim();
    const layer = parseLayer(await readField(values, 1, 'Layer (project or global):'));
    const ok = await confirmAction(options, values, 2, 'remove', `Remove ${name}?`);
    if (!ok) {
      console.log('Remove cancelled.');
      return;
    }
    await removeSkill(name, layer, true);
    console.log('Remove complete.');
  } else if (selection === 'Move skill') {
    const name = (await readField(values, 0, 'Skill name:')).trim();
    const fromLayer = parseLayer(await readField(values, 1, 'Current layer (project or global):'));
    const ok = await confirmAction(options, values, 2, 'move', `Move ${name} to the other layer?`);
    if (!ok) {
      console.log('Move cancelled.');
      return;
    }
    console.log(`Moved to ${await moveSkill(name, fromLayer, true)}.`);
  } else if (selection === 'Search skills') {
    const query = (await readField(values, 0, 'Search keywords:')).trim();
    if (!query) {
      console.log(
        'Standalone search requires keywords. Run `npx skills find` for open interactive search.'
      );
      return;
    }
    const { stdout } = await runSkills(['find', query]);
    console.log(stdout || 'Search complete.');
  } else if (selection === 'Install skill') {
    const source = (
      await readField(values, 0, 'Folder, GitHub shorthand, git URL, or full URL:')
    ).trim();
    await installFromSource(values, source);
  } else {
    console.log('Goodbye.');
  }
}

async function main() {
  const rawArgs = process.argv.slice(2);
  if (rawArgs.includes('--help') || rawArgs.includes('-h')) {
    showHelp();
    return;
  }

  const { options, rest } = parseOptions(rawArgs);
  const { selection: parsedSelection, values } = parseMenuSelection(rest);
  if (parsedSelection) {
    await runSingleCommand(options, parsedSelection, values);
    if (options.skipConfirmation)
      console.log('Confirmation prompts are disabled for destructive CUI actions.');
    return;
  }

  while (true) {
    const selection = await promptMenu();
    if (selection === 'Exit') {
      console.log('Goodbye.');
      return;
    }
    const result = await (async () => {
      if (selection === 'List all skills')
        return showListFlow(options, { layer: 'all', title: 'All skills' }, true);
      if (selection === 'List project skills')
        return showListFlow(options, { layer: 'project', title: 'Project skills' }, true);
      if (selection === 'List global skills')
        return showListFlow(options, { layer: 'global', title: 'Global skills' }, true);
      if (selection === 'Filter by agent') {
        const agent = (
          await inputPrompt({ message: 'Agent id (for example: claude-code, codex, cursor):' })
        ).trim();
        return showListFlow(options, { layer: 'all', agent, title: `Skills for ${agent}` }, true);
      }
      if (selection === 'Search skills') {
        const query = (await inputPrompt({ message: 'Search keywords:' })).trim();
        if (!query) {
          console.log(
            'Standalone search requires keywords. Run `npx skills find` for open interactive search.'
          );
          return 'continue';
        }
        const { stdout } = await runSkills(['find', query]);
        console.log(stdout || 'Search complete.');
        return 'continue';
      }
      if (selection === 'Install skill') {
        const source = (
          await inputPrompt({ message: 'Folder, GitHub shorthand, git URL, or full URL:' })
        ).trim();
        await installFromSource([], source);
        return 'continue';
      }
      await runSingleCommand(options, selection, []);
      return 'continue';
    })();
    if (result === 'exit') return;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
