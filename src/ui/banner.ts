export const RESET = '\x1b[0m';
export const BOLD = '\x1b[1m';
// 256-color grays - visible on both light and dark backgrounds
export const DIM = '\x1b[38;5;102m'; // darker gray for secondary text
export const TEXT = '\x1b[38;5;145m'; // lighter gray for primary text

export const LOGO_LINES = [
  '███████╗██╗   ██╗███╗   ██╗██╗  ██╗',
  '██╔════╝╚██╗ ██╔╝████╗  ██║██║ ██╔╝',
  '███████╗ ╚████╔╝ ██╔██╗ ██║█████╔╝ ',
  '╚════██║  ╚██╔╝  ██║╚██╗██║██╔═██╗ ',
  '███████║   ██║   ██║ ╚████║██║  ██╗',
  '╚══════╝   ╚═╝   ╚═╝  ╚═══╝╚═╝  ╚═╝',
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
  console.log();
  LOGO_LINES.forEach((line, i) => {
    console.log(`${GRAYS[i]}${line}${RESET}`);
  });
}

export function showBanner(): void {
  showLogo();
  console.log();
  console.log(`${DIM}The open cognitive ecosystem for AI agents${RESET}`);
  console.log();
  console.log(
    `  ${DIM}$${RESET} ${TEXT}npx synk add ${DIM}<package>${RESET}     ${DIM}Install skills, agents, or prompts${RESET}`
  );
  console.log(
    `  ${DIM}$${RESET} ${TEXT}npx synk list${RESET}              ${DIM}List installed cognitives${RESET}`
  );
  console.log(
    `  ${DIM}$${RESET} ${TEXT}npx synk find ${DIM}[query]${RESET}      ${DIM}Search for skills${RESET}`
  );
  console.log(
    `  ${DIM}$${RESET} ${TEXT}npx synk check${RESET}             ${DIM}Check for updates${RESET}`
  );
  console.log(
    `  ${DIM}$${RESET} ${TEXT}npx synk update${RESET}            ${DIM}Update all cognitives${RESET}`
  );
  console.log(
    `  ${DIM}$${RESET} ${TEXT}npx synk remove${RESET}            ${DIM}Remove installed cognitives${RESET}`
  );
  console.log(
    `  ${DIM}$${RESET} ${TEXT}npx synk init ${DIM}[name]${RESET}       ${DIM}Create a new skill, agent, or prompt${RESET}`
  );
  console.log();
  console.log(`${DIM}try:${RESET} npx synk add vercel-labs/agent-skills`);
  console.log();
}

export function showHelp(): void {
  console.log(`
${BOLD}Usage:${RESET} synk <command> [options]

${BOLD}Commands:${RESET}
  add <package>     Add skills, agents, or prompts from a package
                    e.g. vercel-labs/agent-skills
                         https://github.com/vercel-labs/agent-skills
  remove [names]    Remove installed cognitives
  list, ls          List installed cognitives
  find [query]      Search for skills interactively
  init [name]       Initialize a cognitive (creates SKILL.md, AGENT.md, or PROMPT.md)
  check             Check for available updates
  update            Update all cognitives to latest versions

${BOLD}Add Options:${RESET}
  -g, --global           Install globally (user-level) instead of project-level
  -a, --agent <agents>   Specify agents to install to (use '*' for all agents)
  -s, --skill <skills>   Specify skill names to install (use '*' for all skills)
  -t, --type <type>      Filter by cognitive type: skill, agent, or prompt
  -l, --list             List available cognitives in the repository without installing
  -y, --yes              Skip confirmation prompts
  --all                  Shorthand for --skill '*' --agent '*' -y
  --full-depth           Search all subdirectories even when a root SKILL.md exists

${BOLD}Remove Options:${RESET}
  -g, --global           Remove from global scope
  -a, --agent <agents>   Remove from specific agents (use '*' for all agents)
  -s, --skill <skills>   Specify skills to remove (use '*' for all skills)
  -t, --type <type>      Filter by cognitive type: skill, agent, or prompt
  -y, --yes              Skip confirmation prompts
  --all                  Shorthand for --skill '*' --agent '*' -y

${BOLD}List Options:${RESET}
  -g, --global           List global cognitives (default: project)
  -a, --agent <agents>   Filter by specific agents
  -t, --type <type>      Filter by cognitive type: skill, agent, or prompt

${BOLD}Init Options:${RESET}
  -t, --type <type>      Type to create: skill (default), agent, or prompt

${BOLD}Options:${RESET}
  --help, -h        Show this help message
  --version, -v     Show version number

${BOLD}Examples:${RESET}
  ${DIM}$${RESET} synk add vercel-labs/agent-skills
  ${DIM}$${RESET} synk add vercel-labs/agent-skills -g
  ${DIM}$${RESET} synk add vercel-labs/agent-skills --type agent
  ${DIM}$${RESET} synk add vercel-labs/agent-skills --agent claude-code cursor
  ${DIM}$${RESET} synk add vercel-labs/agent-skills --skill pr-review commit
  ${DIM}$${RESET} synk remove                     ${DIM}# interactive remove${RESET}
  ${DIM}$${RESET} synk remove web-design          ${DIM}# remove by name${RESET}
  ${DIM}$${RESET} synk rm --global frontend-design
  ${DIM}$${RESET} synk list                       ${DIM}# list all installed cognitives${RESET}
  ${DIM}$${RESET} synk ls -g                      ${DIM}# list global cognitives only${RESET}
  ${DIM}$${RESET} synk ls --type agent             ${DIM}# list agents only${RESET}
  ${DIM}$${RESET} synk find                       ${DIM}# interactive search${RESET}
  ${DIM}$${RESET} synk find typescript            ${DIM}# search by keyword${RESET}
  ${DIM}$${RESET} synk init my-skill
  ${DIM}$${RESET} synk init --type agent my-agent
  ${DIM}$${RESET} synk init --type prompt my-prompt
  ${DIM}$${RESET} synk check
  ${DIM}$${RESET} synk update
`);
}

export function showRemoveHelp(): void {
  console.log(`
${BOLD}Usage:${RESET} synk remove [names...] [options]

${BOLD}Description:${RESET}
  Remove installed cognitives from agents. If no names are provided,
  an interactive selection menu will be shown.

${BOLD}Arguments:${RESET}
  names             Optional names to remove (space-separated)

${BOLD}Options:${RESET}
  -g, --global       Remove from global scope (~/) instead of project scope
  -a, --agent        Remove from specific agents (use '*' for all agents)
  -s, --skill        Specify skills to remove (use '*' for all skills)
  -t, --type         Filter by cognitive type: skill, agent, or prompt
  -y, --yes          Skip confirmation prompts
  --all              Shorthand for --skill '*' --agent '*' -y

${BOLD}Examples:${RESET}
  ${DIM}$${RESET} synk remove                             ${DIM}# interactive selection${RESET}
  ${DIM}$${RESET} synk remove my-skill                     ${DIM}# remove specific skill${RESET}
  ${DIM}$${RESET} synk remove skill1 skill2 -y             ${DIM}# remove multiple${RESET}
  ${DIM}$${RESET} synk remove --global my-agent            ${DIM}# remove from global scope${RESET}
  ${DIM}$${RESET} synk rm --agent claude-code my-skill     ${DIM}# remove from specific agent${RESET}
  ${DIM}$${RESET} synk remove --all                        ${DIM}# remove all${RESET}
  ${DIM}$${RESET} synk remove --type agent                 ${DIM}# remove only agents${RESET}
`);
}
