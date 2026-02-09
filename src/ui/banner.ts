import pc from 'picocolors';
import { logger } from '../utils/logger.ts';

export const LOGO_LINES = [
  ' ██████╗ ██████╗  ██████╗ ███╗   ██╗██╗████████╗',
  '██╔════╝██╔═══██╗██╔════╝ ████╗  ██║██║╚══██╔══╝',
  '██║     ██║   ██║██║  ███╗██╔██╗ ██║██║   ██║   ',
  '██║     ██║   ██║██║   ██║██║╚██╗██║██║   ██║   ',
  '╚██████╗╚██████╔╝╚██████╔╝██║ ╚████║██║   ██║   ',
  ' ╚═════╝ ╚═════╝  ╚═════╝ ╚═╝  ╚═══╝╚═╝   ╚═╝   ',
];

// 256-color middle grays - visible on both light and dark backgrounds
export const GRAYS = [
  '\x1b[38;5;250m', // lighter gray
  '\x1b[38;5;248m',
  '\x1b[38;5;245m', // mid gray
  '\x1b[38;5;243m',
  '\x1b[38;5;240m',
  '\x1b[38;5;238m', // darker gray
];

export function showLogo(): void {
  logger.line();
  LOGO_LINES.forEach((line, i) => {
    logger.gradient(line, GRAYS[i]!);
  });
}

export function showBanner(): void {
  showLogo();
  logger.line();
  logger.dim('The open cognitive ecosystem for AI agents');
  logger.line();
  logger.command('npx cognit add <package>', 'Install skills, agents, or prompts');
  logger.command('npx cognit list', 'List installed cognitives');
  logger.command('npx cognit find [query]', 'Search for skills');
  logger.command('npx cognit check', 'Check for updates');
  logger.command('npx cognit update', 'Update all cognitives');
  logger.command('npx cognit remove', 'Remove installed cognitives');
  logger.command('npx cognit init [name]', 'Create a new skill, agent, or prompt');
  logger.line();
  logger.log(`${pc.dim('try:')} npx cognit add vercel-labs/agent-skills`);
  logger.line();
}

export function showHelp(): void {
  logger.log(`
${pc.bold('Usage:')} cognit <command> [options]

${pc.bold('Commands:')}
  add <package>     Add skills, agents, or prompts from a package
                    e.g. vercel-labs/agent-skills
                         https://github.com/vercel-labs/agent-skills
  remove [names]    Remove installed cognitives
  list, ls          List installed cognitives
  find [query]      Search for skills interactively
  init [name]       Initialize a cognitive (creates SKILL.md, AGENT.md, or PROMPT.md)
  check             Check for available updates
  update            Update all cognitives to latest versions

${pc.bold('Add Options:')}
  -g, --global           Install globally (user-level) instead of project-level
  -a, --agent <agents>   Specify agents to install to (use '*' for all agents)
  -s, --skill <skills>   Specify skill names to install (use '*' for all skills)
  -t, --type <type>      Filter by cognitive type: skill, agent, or prompt
  -l, --list             List available cognitives in the repository without installing
  -y, --yes              Skip confirmation prompts
  --all                  Shorthand for --skill '*' --agent '*' -y
  --full-depth           Search all subdirectories even when a root SKILL.md exists

${pc.bold('Remove Options:')}
  -g, --global           Remove from global scope
  -a, --agent <agents>   Remove from specific agents (use '*' for all agents)
  -s, --skill <skills>   Specify skills to remove (use '*' for all skills)
  -t, --type <type>      Filter by cognitive type: skill, agent, or prompt
  -y, --yes              Skip confirmation prompts
  --all                  Shorthand for --skill '*' --agent '*' -y

${pc.bold('List Options:')}
  -g, --global           List global cognitives (default: project)
  -a, --agent <agents>   Filter by specific agents
  -t, --type <type>      Filter by cognitive type: skill, agent, or prompt

${pc.bold('Init Options:')}
  -t, --type <type>      Type to create: skill (default), agent, or prompt

${pc.bold('Options:')}
  --help, -h        Show this help message
  --version, -v     Show version number

${pc.bold('Examples:')}
  ${pc.dim('$')} cognit add vercel-labs/agent-skills
  ${pc.dim('$')} cognit add vercel-labs/agent-skills -g
  ${pc.dim('$')} cognit add vercel-labs/agent-skills --type agent
  ${pc.dim('$')} cognit add vercel-labs/agent-skills --agent claude-code cursor
  ${pc.dim('$')} cognit add vercel-labs/agent-skills --skill pr-review commit
  ${pc.dim('$')} cognit remove                     ${pc.dim('# interactive remove')}
  ${pc.dim('$')} cognit remove web-design          ${pc.dim('# remove by name')}
  ${pc.dim('$')} cognit rm --global frontend-design
  ${pc.dim('$')} cognit list                       ${pc.dim('# list all installed cognitives')}
  ${pc.dim('$')} cognit ls -g                      ${pc.dim('# list global cognitives only')}
  ${pc.dim('$')} cognit ls --type agent             ${pc.dim('# list agents only')}
  ${pc.dim('$')} cognit find                       ${pc.dim('# interactive search')}
  ${pc.dim('$')} cognit find typescript            ${pc.dim('# search by keyword')}
  ${pc.dim('$')} cognit init my-skill
  ${pc.dim('$')} cognit init --type agent my-agent
  ${pc.dim('$')} cognit init --type prompt my-prompt
  ${pc.dim('$')} cognit check
  ${pc.dim('$')} cognit update
`);
}

export function showRemoveHelp(): void {
  logger.log(`
${pc.bold('Usage:')} cognit remove [names...] [options]

${pc.bold('Description:')}
  Remove installed cognitives from agents. If no names are provided,
  an interactive selection menu will be shown.

${pc.bold('Arguments:')}
  names             Optional names to remove (space-separated)

${pc.bold('Options:')}
  -g, --global       Remove from global scope (~/) instead of project scope
  -a, --agent        Remove from specific agents (use '*' for all agents)
  -s, --skill        Specify skills to remove (use '*' for all skills)
  -t, --type         Filter by cognitive type: skill, agent, or prompt
  -y, --yes          Skip confirmation prompts
  --all              Shorthand for --skill '*' --agent '*' -y

${pc.bold('Examples:')}
  ${pc.dim('$')} cognit remove                             ${pc.dim('# interactive selection')}
  ${pc.dim('$')} cognit remove my-skill                     ${pc.dim('# remove specific skill')}
  ${pc.dim('$')} cognit remove skill1 skill2 -y             ${pc.dim('# remove multiple')}
  ${pc.dim('$')} cognit remove --global my-agent            ${pc.dim('# remove from global scope')}
  ${pc.dim('$')} cognit rm --agent claude-code my-skill     ${pc.dim('# remove from specific agent')}
  ${pc.dim('$')} cognit remove --all                        ${pc.dim('# remove all')}
  ${pc.dim('$')} cognit remove --type agent                 ${pc.dim('# remove only agents')}
`);
}
