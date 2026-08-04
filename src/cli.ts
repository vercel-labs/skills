#!/usr/bin/env node

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { basename, join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { runAdd, parseAddOptions, initTelemetry } from './add.ts';
import { runFind } from './find.ts';
import { runInstallFromLock } from './install.ts';
import { runList } from './list.ts';
import { removeCommand, parseRemoveOptions } from './remove.ts';
import { runSync, parseSyncOptions } from './sync.ts';
import { flushTelemetry } from './telemetry.ts';
import { isRunningInAgent } from './detect-agent.ts';
import { runUpdate } from './update.ts';
import { runUse, parseUseOptions } from './use.ts';
import { t } from './messages.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));

function getVersion(): string {
  try {
    const pkgPath = join(__dirname, '..', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    return pkg.version;
  } catch {
    return '0.0.0';
  }
}

const VERSION = getVersion();
initTelemetry(VERSION);

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
// 256-color grays - visible on both light and dark backgrounds
const DIM = '\x1b[38;5;102m'; // darker gray for secondary text
const TEXT = '\x1b[38;5;145m'; // lighter gray for primary text

const LOGO_LINES = [
  '███████╗██╗  ██╗██╗██╗     ██╗     ███████╗',
  '██╔════╝██║ ██╔╝██║██║     ██║     ██╔════╝',
  '███████╗█████╔╝ ██║██║     ██║     ███████╗',
  '╚════██║██╔═██╗ ██║██║     ██║     ╚════██║',
  '███████║██║  ██╗██║███████╗███████╗███████║',
  '╚══════╝╚═╝  ╚═╝╚═╝╚══════╝╚══════╝╚══════╝',
];

// 256-color middle grays - visible on both light and dark backgrounds
const GRAYS = [
  '\x1b[38;5;250m', // lighter gray
  '\x1b[38;5;248m',
  '\x1b[38;5;245m', // mid gray
  '\x1b[38;5;243m',
  '\x1b[38;5;240m',
  '\x1b[38;5;238m', // darker gray
];

function showLogo(): void {
  console.log();
  LOGO_LINES.forEach((line, i) => {
    console.log(`${GRAYS[i]}${line}${RESET}`);
  });
}

function showBanner(): void {
  showLogo();
  console.log();
  console.log(`${DIM}${t('The open agent skills ecosystem')}${RESET}`);
  console.log();
  console.log(
    `  ${DIM}$${RESET} ${TEXT}npx skills add ${DIM}<package>${RESET}        ${DIM}${t('Add a new skill')}${RESET}`
  );
  console.log(
    `  ${DIM}$${RESET} ${TEXT}npx skills use ${DIM}<package>@<skill>${RESET} ${DIM}${t('Use a skill without installing')}${RESET}`
  );
  console.log(
    `  ${DIM}$${RESET} ${TEXT}npx skills remove${RESET}               ${DIM}${t('Remove installed skills')}${RESET}`
  );
  console.log(
    `  ${DIM}$${RESET} ${TEXT}npx skills list${RESET}                 ${DIM}${t('List installed skills')}${RESET}`
  );
  console.log(
    `  ${DIM}$${RESET} ${TEXT}npx skills find ${DIM}[query]${RESET}         ${DIM}${t('Search for skills')}${RESET}`
  );
  console.log();
  console.log(
    `  ${DIM}$${RESET} ${TEXT}npx skills update${RESET}               ${DIM}${t('Update installed skills')}${RESET}`
  );
  console.log();
  console.log(
    `  ${DIM}$${RESET} ${TEXT}npx skills experimental_install${RESET} ${DIM}${t('Restore from skills-lock.json')}${RESET}`
  );
  console.log(
    `  ${DIM}$${RESET} ${TEXT}npx skills init ${DIM}[name]${RESET}          ${DIM}${t('Create a new skill')}${RESET}`
  );
  console.log(
    `  ${DIM}$${RESET} ${TEXT}npx skills experimental_sync${RESET}    ${DIM}${t('Sync skills from node_modules')}${RESET}`
  );
  console.log();
  console.log(`${DIM}${t('try:')}${RESET} npx skills add vercel-labs/agent-skills`);
  console.log();
  console.log(`${t('Discover more skills at')} ${TEXT}https://skills.sh/${RESET}`);
  console.log();
}

function showHelp(): void {
  console.log(`
${BOLD}${t('Usage')}:${RESET} skills <command> [options]

${BOLD}${t('Manage Skills:')}${RESET}
  add <package>        ${t('Add a skill package (alias: a)')}
                       e.g. vercel-labs/agent-skills
                            https://github.com/vercel-labs/agent-skills
  use <package>@<skill>
                       ${t('Generate a prompt for using one skill without installing it')}
  remove [skills]      ${t('Remove installed skills')}
  list, ls             ${t('List installed skills')}
  find [query]         ${t('Search for skills interactively')}

${BOLD}${t('Find Options:')}${RESET}
  --owner <owner>        ${t('Search only repositories from a GitHub owner')}

${BOLD}${t('Updates:')}${RESET}
  update [skills...]   ${t('Update skills to latest versions (alias: upgrade)')}

${BOLD}${t('Update Options:')}${RESET}
  -g, --global           ${t('Update global skills only')}
  -p, --project          ${t('Update project skills only')}
  -y, --yes              ${t('Skip scope prompt (auto-detect: project if in a project, else global)')}

${BOLD}${t('Project:')}${RESET}
  experimental_install ${t('Restore skills from skills-lock.json')}
  init [name]          ${t('Initialize a skill (creates <name>/SKILL.md or ./SKILL.md)')}
  experimental_sync    ${t('Sync skills from node_modules into agent directories')}

${BOLD}${t('Add Options:')}${RESET}
  -g, --global           ${t('Install skill globally (user-level) instead of project-level')}
  -a, --agent <agents>   ${t("Specify agents to install to (use '*' for all agents)")}
  -s, --skill <skills>   ${t("Specify skill names to install (use '*' for all skills)")}
  -l, --list             ${t('List available skills in the repository without installing')}
  -y, --yes              ${t('Skip confirmation prompts')}
  --copy                 ${t('Copy files instead of symlinking to agent directories')}
  --metadata <json>      ${t('Attach valid JSON to the install telemetry event')}
  --subagent <names>     ${t("Install to Eve subagents (use 'root' for the root agent)")}
  --all                  ${t("Shorthand for --skill '*' --agent '*' -y")}
  --full-depth           ${t('Search all subdirectories even when a root SKILL.md exists')}

${BOLD}${t('Use Options:')}${RESET}
  -s, --skill <skill>    ${t('Specify the skill to use')}
  -a, --agent <agent>    ${t('Start one supported agent interactively')}
  --full-depth           ${t('Search all subdirectories even when a root SKILL.md exists')}
  --dangerously-accept-openclaw-risks
                         ${t('Allow unverified OpenClaw community skills')}

${BOLD}${t('Remove Options:')}${RESET}
  -g, --global           ${t('Remove from global scope')}
  -a, --agent <agents>   ${t("Remove from specific agents (use '*' for all agents)")}
  -s, --skill <skills>   ${t("Specify skills to remove (use '*' for all skills)")}
  -y, --yes              ${t('Skip confirmation prompts')}
  --all                  ${t("Shorthand for --skill '*' --agent '*' -y")}

${BOLD}${t('Experimental Sync Options:')}${RESET}
  -a, --agent <agents>   ${t("Specify agents to install to (use '*' for all agents)")}
  -y, --yes              ${t('Skip confirmation prompts')}

${BOLD}${t('List Options:')}${RESET}
  -g, --global           ${t('List global skills (default: project)')}
  -a, --agent <agents>   ${t('Filter by specific agents')}
  --json                 ${t('Output as JSON (machine-readable, no ANSI codes)')}

${BOLD}${t('Options:')}${RESET}
  --help, -h        ${t('Show this help message')}
  --version, -v     ${t('Show version number')}

${BOLD}${t('Examples:')}${RESET}
  ${DIM}$${RESET} skills add vercel-labs/agent-skills
  ${DIM}$${RESET} skills use vercel-labs/agent-skills@vercel-optimize | claude
  ${DIM}$${RESET} skills use vercel-labs/agent-skills --skill vercel-optimize --agent claude-code
  ${DIM}$${RESET} skills add vercel-labs/agent-skills -g
  ${DIM}$${RESET} skills add vercel-labs/agent-skills --agent claude-code cursor
  ${DIM}$${RESET} skills add vercel-labs/agent-skills --skill pr-review commit
  ${DIM}$${RESET} skills remove                        ${DIM}# interactive remove${RESET}
  ${DIM}$${RESET} skills remove web-design             ${DIM}# remove by name${RESET}
  ${DIM}$${RESET} skills rm --global frontend-design
  ${DIM}$${RESET} skills list                          ${DIM}# list project skills${RESET}
  ${DIM}$${RESET} skills ls -g                         ${DIM}# list global skills${RESET}
  ${DIM}$${RESET} skills ls -a claude-code             ${DIM}# filter by agent${RESET}
  ${DIM}$${RESET} skills ls --json                      ${DIM}# JSON output${RESET}
  ${DIM}$${RESET} skills find                          ${DIM}# interactive search${RESET}
  ${DIM}$${RESET} skills find typescript               ${DIM}# search by keyword${RESET}
  ${DIM}$${RESET} skills find react --owner vercel     ${DIM}# search within an owner${RESET}
  ${DIM}$${RESET} skills update
  ${DIM}$${RESET} skills update my-skill             ${DIM}# ${t('update a single skill')}${RESET}
  ${DIM}$${RESET} skills update -g                    ${DIM}# ${t('update global skills only')}${RESET}
  ${DIM}$${RESET} skills experimental_install            ${DIM}# ${t('restore from skills-lock.json')}${RESET}
  ${DIM}$${RESET} skills init my-skill
  ${DIM}$${RESET} skills experimental_sync              ${DIM}# ${t('sync from node_modules')}${RESET}
  ${DIM}$${RESET} skills experimental_sync -y           ${DIM}# ${t('sync without prompts')}${RESET}

${t('Discover more skills at')} ${TEXT}https://skills.sh/${RESET}
`);
}

function showRemoveHelp(): void {
  console.log(`
${BOLD}${t('Usage')}:${RESET} skills remove [skills...] [options]

${BOLD}${t('Description')}:${RESET}
  ${t('Remove installed skills from agents. If no skill names are provided, an interactive selection menu will be shown.')}

${BOLD}${t('Arguments:')}${RESET}
  skills            ${t('Optional skill names to remove (space-separated)')}

${BOLD}${t('Options:')}${RESET}
  -g, --global       ${t('Remove from global scope (~/) instead of project scope')}
  -a, --agent        ${t("Remove from specific agents (use '*' for all agents)")}
  -s, --skill        ${t("Specify skills to remove (use '*' for all skills)")}
  -y, --yes          ${t('Skip confirmation prompts')}
  --all              ${t("Shorthand for --skill '*' --agent '*' -y")}

${BOLD}${t('Examples:')}${RESET}
  ${DIM}$${RESET} skills remove                           ${DIM}# ${t('interactive selection')}${RESET}
  ${DIM}$${RESET} skills remove my-skill                   ${DIM}# ${t('remove specific skill')}${RESET}
  ${DIM}$${RESET} skills remove skill1 skill2 -y           ${DIM}# ${t('remove multiple skills')}${RESET}
  ${DIM}$${RESET} skills remove --global my-skill          ${DIM}# ${t('remove from global scope')}${RESET}
  ${DIM}$${RESET} skills rm --agent claude-code my-skill   ${DIM}# ${t('remove from specific agent')}${RESET}
  ${DIM}$${RESET} skills remove --all                      ${DIM}# ${t('remove all skills')}${RESET}
  ${DIM}$${RESET} skills remove --skill '*' -a cursor      ${DIM}# ${t('remove all skills from cursor')}${RESET}

${t('Discover more skills at')} ${TEXT}https://skills.sh/${RESET}
`);
}

function runInit(args: string[]): void {
  const cwd = process.cwd();
  const skillName = args[0] || basename(cwd);
  const hasName = args[0] !== undefined;

  const skillDir = hasName ? join(cwd, skillName) : cwd;
  const skillFile = join(skillDir, 'SKILL.md');
  const displayPath = hasName ? `${skillName}/SKILL.md` : 'SKILL.md';

  if (existsSync(skillFile)) {
    console.log(`${TEXT}${t('Skill already exists at {path}', { path: displayPath })}${RESET}`);
    return;
  }

  if (hasName) {
    mkdirSync(skillDir, { recursive: true });
  }

  const skillContent = `---
name: ${skillName}
description: A brief description of what this skill does
---

# ${skillName}

Instructions for the agent to follow when this skill is activated.

## When to use

Describe when this skill should be used.

## Instructions

1. First step
2. Second step
3. Additional steps as needed
`;

  writeFileSync(skillFile, skillContent);

  console.log(`${TEXT}${t('Initialized skill: {name}', { name: skillName })}${RESET}`);
  console.log();
  console.log(`${DIM}${t('Created:')}${RESET}`);
  console.log(`  ${displayPath}`);
  console.log();
  console.log(`${DIM}${t('Next steps:')}${RESET}`);
  console.log(`  1. ${t('Edit {path} to define your skill instructions', { path: displayPath })}`);
  console.log(
    `  2. ${t('Update the {name} and {description} in the frontmatter', { name: 'name', description: 'description' })}`
  );
  console.log();
  console.log(`${DIM}${t('Publishing:')}${RESET}`);
  console.log(
    `  ${DIM}${t('GitHub:')}${RESET}  ${t('Push to a repo, then')} ${TEXT}npx skills add <owner>/<repo>${RESET}`
  );
  console.log(
    `  ${DIM}${t('URL:')}${RESET}     ${t('Host the file, then')} ${TEXT}npx skills add https://example.com/${displayPath}${RESET}`
  );
  console.log();
  console.log(
    `${t('Browse existing skills for inspiration at')} ${TEXT}https://skills.sh/${RESET}`
  );
  console.log();
}

// ============================================
// Main
// ============================================

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const inAgent = await isRunningInAgent();

  if (args.length === 0) {
    if (!inAgent) {
      showBanner();
    }
    return;
  }

  const command = args[0];
  const restArgs = args.slice(1);

  // Subcommand --help / -h must short-circuit before dispatch so that running
  // e.g. `skills update --help` prints help instead of executing the update
  // flow. Without this pre-check, every subcommand handler that doesn't
  // inspect `--help` itself ends up running its side-effecting work.
  if (
    command !== '--help' &&
    command !== '-h' &&
    command !== '--version' &&
    command !== '-v' &&
    (restArgs.includes('--help') || restArgs.includes('-h'))
  ) {
    if (command === 'remove' || command === 'rm' || command === 'r') {
      showRemoveHelp();
    } else {
      showHelp();
    }
    return;
  }

  switch (command) {
    case 'find':
    case 'search':
    case 'f':
    case 's':
      if (!inAgent) showLogo();
      console.log();
      await runFind(restArgs);
      break;
    case 'init':
      if (!inAgent) showLogo();
      console.log();
      runInit(restArgs);
      break;
    case 'experimental_install': {
      if (!inAgent) showLogo();
      await runInstallFromLock(restArgs);
      break;
    }
    case 'i':
    case 'install':
    case 'a':
    case 'add': {
      if (!inAgent) showLogo();
      const { source: addSource, options: addOpts, errors } = parseAddOptions(restArgs);
      if (errors.length > 0) {
        for (const error of errors) console.error(t('Error: {message}', { message: error }));
        process.exitCode = 1;
        break;
      }
      await runAdd(addSource, addOpts);
      break;
    }
    case 'use': {
      const {
        source: useSource,
        options: useOptions,
        errors: useErrors,
      } = parseUseOptions(restArgs);
      await runUse(useSource, useOptions, useErrors);
      break;
    }
    case 'remove':
    case 'rm':
    case 'r': {
      const { skills, options: removeOptions } = parseRemoveOptions(restArgs);
      await removeCommand(skills, removeOptions);
      break;
    }
    case 'experimental_sync': {
      if (!inAgent) showLogo();
      const { options: syncOptions } = parseSyncOptions(restArgs);
      await runSync(restArgs, syncOptions);
      break;
    }
    case 'list':
    case 'ls':
      await runList(restArgs);
      break;
    case 'check':
    case 'update':
    case 'upgrade':
      await runUpdate(restArgs);
      break;
    case '--help':
    case '-h':
      showHelp();
      break;
    case '--version':
    case '-v':
      console.log(VERSION);
      break;

    default:
      console.log(t('Unknown command: {command}', { command: command! }));
      console.log(t('Run {cmd} for usage.', { cmd: `${BOLD}skills --help${RESET}` }));
      process.exitCode = 1;
  }
}

main().finally(() => flushTelemetry().then(() => process.exit(process.exitCode ?? 0)));
