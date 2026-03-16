#!/usr/bin/env node

import { spawn, spawnSync } from 'child_process';
import { writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'fs';
import { basename, join, dirname } from 'path';
import { homedir } from 'os';
import { createHash } from 'crypto';
import { fileURLToPath } from 'url';
import { runAdd, parseAddOptions, initTelemetry } from './add.ts';
import { runFind } from './find.ts';
import { runInstallFromLock } from './install.ts';
import { runList } from './list.ts';
import { removeCommand, parseRemoveOptions } from './remove.ts';
import { runSync, parseSyncOptions } from './sync.ts';
import { track } from './telemetry.ts';
import { fetchAgentFolderHash, getGitHubToken } from './agent-lock.ts';

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
  ' █████╗  ██████╗ ███████╗███╗   ██╗████████╗███████╗',
  '██╔══██╗██╔════╝ ██╔════╝████╗  ██║╚══██╔══╝██╔════╝',
  '███████║██║  ███╗█████╗  ██╔██╗ ██║   ██║   ███████╗',
  '██╔══██║██║   ██║██╔══╝  ██║╚██╗██║   ██║   ╚════██║',
  '██║  ██║╚██████╔╝███████╗██║ ╚████║   ██║   ███████║',
  '╚═╝  ╚═╝ ╚═════╝ ╚══════╝╚═╝  ╚═══╝   ╚═╝   ╚══════╝',
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
  console.log(`${DIM}The open agent distribution ecosystem${RESET}`);
  console.log();
  console.log(
    `  ${DIM}$${RESET} ${TEXT}npx agents add ${DIM}<package>${RESET}        ${DIM}Add a new agent${RESET}`
  );
  console.log(
    `  ${DIM}$${RESET} ${TEXT}npx agents remove${RESET}               ${DIM}Remove installed agents${RESET}`
  );
  console.log(
    `  ${DIM}$${RESET} ${TEXT}npx agents list${RESET}                 ${DIM}List installed agents${RESET}`
  );
  console.log(
    `  ${DIM}$${RESET} ${TEXT}npx agents find ${DIM}[query]${RESET}         ${DIM}Search for agents${RESET}`
  );
  console.log();
  console.log(
    `  ${DIM}$${RESET} ${TEXT}npx agents check${RESET}                ${DIM}Check for updates${RESET}`
  );
  console.log(
    `  ${DIM}$${RESET} ${TEXT}npx agents update${RESET}               ${DIM}Update all agents${RESET}`
  );
  console.log();
  console.log(
    `  ${DIM}$${RESET} ${TEXT}npx agents experimental_install${RESET} ${DIM}Restore from agents-lock.json${RESET}`
  );
  console.log(
    `  ${DIM}$${RESET} ${TEXT}npx agents init ${DIM}[name]${RESET}          ${DIM}Create a new agent${RESET}`
  );
  console.log(
    `  ${DIM}$${RESET} ${TEXT}npx agents experimental_sync${RESET}    ${DIM}Sync agents from node_modules${RESET}`
  );
  console.log();
  console.log(`${DIM}try:${RESET} npx agents add owner/repo`);
  console.log();
  console.log(`Discover more agents at ${TEXT}https://agents.sh/${RESET}`);
  console.log();
}

function showHelp(): void {
  console.log(`
${BOLD}Usage:${RESET} agents <command> [options]

${BOLD}Manage Agents:${RESET}
  add <package>        Add an agent package (alias: a)
                       e.g. owner/repo
                            https://github.com/owner/repo
  remove [agents]      Remove installed agents
  list, ls             List installed agents
  find [query]         Search for agents interactively

${BOLD}Updates:${RESET}
  check                Check for available agent updates
  update               Update all agents to latest versions

${BOLD}Project:${RESET}
  experimental_install Restore agents from agents-lock.json
  init [name]          Initialize an agent (creates <name>/AGENT.md or ./AGENT.md)
  experimental_sync    Sync agents from node_modules into target directories

${BOLD}Add Options:${RESET}
  -g, --global           Install agent globally (user-level) instead of project-level
  -t, --target <targets> Specify targets to install to (use '*' for all targets)
  -a, --agent <agents>   Specify agent names to install (use '*' for all agents)
  -l, --list             List available agents in the repository without installing
  -y, --yes              Skip confirmation prompts
  --copy                 Copy files instead of symlinking to target directories
  --all                  Shorthand for --agent '*' --target '*' -y
  --full-depth           Search all subdirectories even when a root AGENT.md exists

${BOLD}Remove Options:${RESET}
  -g, --global           Remove from global scope
  -t, --target <targets> Remove from specific targets (use '*' for all targets)
  -a, --agent <agents>   Specify agents to remove (use '*' for all agents)
  -y, --yes              Skip confirmation prompts
  --all                  Shorthand for --agent '*' --target '*' -y

${BOLD}Experimental Sync Options:${RESET}
  -t, --target <targets> Specify targets to install to (use '*' for all targets)
  -y, --yes              Skip confirmation prompts

${BOLD}List Options:${RESET}
  -g, --global           List global agents (default: project)
  -t, --target <targets> Filter by specific targets
  --json                 Output as JSON (machine-readable, no ANSI codes)

${BOLD}Options:${RESET}
  --help, -h        Show this help message
  --version, -v     Show version number

${BOLD}Examples:${RESET}
  ${DIM}$${RESET} agents add owner/repo
  ${DIM}$${RESET} agents add owner/repo -g
  ${DIM}$${RESET} agents add owner/repo --target claude-code cursor
  ${DIM}$${RESET} agents add owner/repo --agent pr-review commit
  ${DIM}$${RESET} agents remove                        ${DIM}# interactive remove${RESET}
  ${DIM}$${RESET} agents remove web-design             ${DIM}# remove by name${RESET}
  ${DIM}$${RESET} agents rm --global frontend-design
  ${DIM}$${RESET} agents list                          ${DIM}# list project agents${RESET}
  ${DIM}$${RESET} agents ls -g                         ${DIM}# list global agents${RESET}
  ${DIM}$${RESET} agents ls -t claude-code             ${DIM}# filter by target${RESET}
  ${DIM}$${RESET} agents ls --json                      ${DIM}# JSON output${RESET}
  ${DIM}$${RESET} agents find                          ${DIM}# interactive search${RESET}
  ${DIM}$${RESET} agents find typescript               ${DIM}# search by keyword${RESET}
  ${DIM}$${RESET} agents check
  ${DIM}$${RESET} agents update
  ${DIM}$${RESET} agents experimental_install            ${DIM}# restore from agents-lock.json${RESET}
  ${DIM}$${RESET} agents init my-agent
  ${DIM}$${RESET} agents experimental_sync              ${DIM}# sync from node_modules${RESET}
  ${DIM}$${RESET} agents experimental_sync -y           ${DIM}# sync without prompts${RESET}

Discover more agents at ${TEXT}https://agents.sh/${RESET}
`);
}

function showRemoveHelp(): void {
  console.log(`
${BOLD}Usage:${RESET} agents remove [agents...] [options]

${BOLD}Description:${RESET}
  Remove installed agents from targets. If no agent names are provided,
  an interactive selection menu will be shown.

${BOLD}Arguments:${RESET}
  agents            Optional agent names to remove (space-separated)

${BOLD}Options:${RESET}
  -g, --global       Remove from global scope (~/) instead of project scope
  -t, --target       Remove from specific targets (use '*' for all targets)
  -a, --agent        Specify agents to remove (use '*' for all agents)
  -y, --yes          Skip confirmation prompts
  --all              Shorthand for --agent '*' --target '*' -y

${BOLD}Examples:${RESET}
  ${DIM}$${RESET} agents remove                           ${DIM}# interactive selection${RESET}
  ${DIM}$${RESET} agents remove my-agent                   ${DIM}# remove specific agent${RESET}
  ${DIM}$${RESET} agents remove agent1 agent2 -y           ${DIM}# remove multiple agents${RESET}
  ${DIM}$${RESET} agents remove --global my-agent          ${DIM}# remove from global scope${RESET}
  ${DIM}$${RESET} agents rm --target claude-code my-agent  ${DIM}# remove from specific target${RESET}
  ${DIM}$${RESET} agents remove --all                      ${DIM}# remove all agents${RESET}
  ${DIM}$${RESET} agents remove --agent '*' -t cursor      ${DIM}# remove all agents from cursor${RESET}

Discover more agents at ${TEXT}https://agents.sh/${RESET}
`);
}

function runInit(args: string[]): void {
  const cwd = process.cwd();
  const agentName = args[0] || basename(cwd);
  const hasName = args[0] !== undefined;

  const agentDir = hasName ? join(cwd, agentName) : cwd;
  const agentFile = join(agentDir, 'AGENT.md');
  const displayPath = hasName ? `${agentName}/AGENT.md` : 'AGENT.md';

  if (existsSync(agentFile)) {
    console.log(`${TEXT}Agent already exists at ${DIM}${displayPath}${RESET}`);
    return;
  }

  if (hasName) {
    mkdirSync(agentDir, { recursive: true });
  }

  const agentContent = `---
name: ${agentName}
description: A brief description of what this agent does
---

# ${agentName}

Instructions for the agent to follow when this agent is activated.

## When to use

Describe when this agent should be used.

## Instructions

1. First step
2. Second step
3. Additional steps as needed
`;

  writeFileSync(agentFile, agentContent);

  console.log(`${TEXT}Initialized agent: ${DIM}${agentName}${RESET}`);
  console.log();
  console.log(`${DIM}Created:${RESET}`);
  console.log(`  ${displayPath}`);
  console.log();
  console.log(`${DIM}Next steps:${RESET}`);
  console.log(`  1. Edit ${TEXT}${displayPath}${RESET} to define your agent instructions`);
  console.log(
    `  2. Update the ${TEXT}name${RESET} and ${TEXT}description${RESET} in the frontmatter`
  );
  console.log();
  console.log(`${DIM}Publishing:${RESET}`);
  console.log(
    `  ${DIM}GitHub:${RESET}  Push to a repo, then ${TEXT}npx agents add <owner>/<repo>${RESET}`
  );
  console.log(
    `  ${DIM}URL:${RESET}     Host the file, then ${TEXT}npx agents add https://example.com/${displayPath}${RESET}`
  );
  console.log();
  console.log(`Browse existing agents for inspiration at ${TEXT}https://agents.sh/${RESET}`);
  console.log();
}

// ============================================
// Check and Update Commands
// ============================================

const AGENTS_DIR = '.agents';
const LOCK_FILE = '.agent-lock.json';
const CHECK_UPDATES_API_URL = 'https://add-agent.vercel.sh/check-updates';
const CURRENT_LOCK_VERSION = 3; // Bumped from 2 to 3 for folder hash support

interface AgentLockEntry {
  source: string;
  sourceType: string;
  sourceUrl: string;
  agentPath?: string;
  /** GitHub tree SHA for the entire agent folder (v3) */
  agentFolderHash: string;
  installedAt: string;
  updatedAt: string;
}

interface AgentLockFile {
  version: number;
  agents: Record<string, AgentLockEntry>;
}

interface CheckUpdatesRequest {
  agents: Array<{
    name: string;
    source: string;
    path?: string;
    agentFolderHash: string;
  }>;
}

interface CheckUpdatesResponse {
  updates: Array<{
    name: string;
    source: string;
    currentHash: string;
    latestHash: string;
  }>;
  errors?: Array<{
    name: string;
    source: string;
    error: string;
  }>;
}

function getAgentLockPath(): string {
  const xdgStateHome = process.env.XDG_STATE_HOME;
  if (xdgStateHome) {
    return join(xdgStateHome, 'agents', LOCK_FILE);
  }
  return join(homedir(), AGENTS_DIR, LOCK_FILE);
}

function readAgentLock(): AgentLockFile {
  const lockPath = getAgentLockPath();
  try {
    const content = readFileSync(lockPath, 'utf-8');
    const parsed = JSON.parse(content) as AgentLockFile;
    if (typeof parsed.version !== 'number' || !parsed.agents) {
      return { version: CURRENT_LOCK_VERSION, agents: {} };
    }
    // If old version, wipe and start fresh (backwards incompatible change)
    // v3 adds agentFolderHash - we want fresh installs to populate it
    if (parsed.version < CURRENT_LOCK_VERSION) {
      return { version: CURRENT_LOCK_VERSION, agents: {} };
    }
    return parsed;
  } catch {
    return { version: CURRENT_LOCK_VERSION, agents: {} };
  }
}

function writeAgentLock(lock: AgentLockFile): void {
  const lockPath = getAgentLockPath();
  const dir = dirname(lockPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(lockPath, JSON.stringify(lock, null, 2), 'utf-8');
}

interface SkippedAgent {
  name: string;
  reason: string;
  sourceUrl: string;
}

/**
 * Determine why a agent cannot be checked for updates automatically.
 */
function getSkipReason(entry: AgentLockEntry): string {
  if (entry.sourceType === 'local') {
    return 'Local path';
  }
  if (entry.sourceType === 'git') {
    return 'Git URL (hash tracking not supported)';
  }
  if (!entry.agentFolderHash) {
    return 'No version hash available';
  }
  if (!entry.agentPath) {
    return 'No agent path recorded';
  }
  return 'No version tracking';
}

/**
 * Print a list of agents that cannot be checked automatically,
 * with the reason and a manual update command for each.
 */
function printSkippedAgents(skipped: SkippedAgent[]): void {
  if (skipped.length === 0) return;
  console.log();
  console.log(`${DIM}${skipped.length} agent(s) cannot be checked automatically:${RESET}`);
  for (const agent of skipped) {
    console.log(`  ${TEXT}•${RESET} ${agent.name} ${DIM}(${agent.reason})${RESET}`);
    console.log(`    ${DIM}To update: ${TEXT}npx agents add ${agent.sourceUrl} -g -y${RESET}`);
  }
}

async function runCheck(args: string[] = []): Promise<void> {
  console.log(`${TEXT}Checking for agent updates...${RESET}`);
  console.log();

  const lock = readAgentLock();
  const agentNames = Object.keys(lock.agents);

  if (agentNames.length === 0) {
    console.log(`${DIM}No agents tracked in lock file.${RESET}`);
    console.log(`${DIM}Install agents with${RESET} ${TEXT}npx agents add <package>${RESET}`);
    return;
  }

  // Get GitHub token from user's environment for higher rate limits
  const token = getGitHubToken();

  // Group agents by source (owner/repo) to batch GitHub API calls
  const agentsBySource = new Map<string, Array<{ name: string; entry: AgentLockEntry }>>();
  const skipped: SkippedAgent[] = [];

  for (const agentName of agentNames) {
    const entry = lock.agents[agentName];
    if (!entry) continue;

    // Only check agents with folder hash and agent path
    if (!entry.agentFolderHash || !entry.agentPath) {
      skipped.push({ name: agentName, reason: getSkipReason(entry), sourceUrl: entry.sourceUrl });
      continue;
    }

    const existing = agentsBySource.get(entry.source) || [];
    existing.push({ name: agentName, entry });
    agentsBySource.set(entry.source, existing);
  }

  const totalAgents = agentNames.length - skipped.length;
  if (totalAgents === 0) {
    console.log(`${DIM}No GitHub agents to check.${RESET}`);
    printSkippedAgents(skipped);
    return;
  }

  console.log(`${DIM}Checking ${totalAgents} agent(s) for updates...${RESET}`);

  const updates: Array<{ name: string; source: string }> = [];
  const errors: Array<{ name: string; source: string; error: string }> = [];

  // Check each source (one API call per repo)
  for (const [source, agents] of agentsBySource) {
    for (const { name, entry } of agents) {
      try {
        const latestHash = await fetchAgentFolderHash(source, entry.agentPath!, token);

        if (!latestHash) {
          errors.push({ name, source, error: 'Could not fetch from GitHub' });
          continue;
        }

        if (latestHash !== entry.agentFolderHash) {
          updates.push({ name, source });
        }
      } catch (err) {
        errors.push({
          name,
          source,
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }
  }

  console.log();

  if (updates.length === 0) {
    console.log(`${TEXT}✓ All agents are up to date${RESET}`);
  } else {
    console.log(`${TEXT}${updates.length} update(s) available:${RESET}`);
    console.log();
    for (const update of updates) {
      console.log(`  ${TEXT}↑${RESET} ${update.name}`);
      console.log(`    ${DIM}source: ${update.source}${RESET}`);
    }
    console.log();
    console.log(
      `${DIM}Run${RESET} ${TEXT}npx agents update${RESET} ${DIM}to update all agents${RESET}`
    );
  }

  if (errors.length > 0) {
    console.log();
    console.log(`${DIM}Could not check ${errors.length} agent(s) (may need reinstall)${RESET}`);
  }

  printSkippedAgents(skipped);

  // Track telemetry
  track({
    event: 'check',
    agentCount: String(totalAgents),
    updatesAvailable: String(updates.length),
  });

  console.log();
}

async function runUpdate(): Promise<void> {
  console.log(`${TEXT}Checking for agent updates...${RESET}`);
  console.log();

  const lock = readAgentLock();
  const agentNames = Object.keys(lock.agents);

  if (agentNames.length === 0) {
    console.log(`${DIM}No agents tracked in lock file.${RESET}`);
    console.log(`${DIM}Install agents with${RESET} ${TEXT}npx agents add <package>${RESET}`);
    return;
  }

  // Get GitHub token from user's environment for higher rate limits
  const token = getGitHubToken();

  // Find agents that need updates by checking GitHub directly
  const updates: Array<{ name: string; source: string; entry: AgentLockEntry }> = [];
  const skipped: SkippedAgent[] = [];

  for (const agentName of agentNames) {
    const entry = lock.agents[agentName];
    if (!entry) continue;

    // Only check agents with folder hash and agent path
    if (!entry.agentFolderHash || !entry.agentPath) {
      skipped.push({ name: agentName, reason: getSkipReason(entry), sourceUrl: entry.sourceUrl });
      continue;
    }

    try {
      const latestHash = await fetchAgentFolderHash(entry.source, entry.agentPath, token);

      if (latestHash && latestHash !== entry.agentFolderHash) {
        updates.push({ name: agentName, source: entry.source, entry });
      }
    } catch {
      // Skip agents that fail to check
    }
  }

  const checkedCount = agentNames.length - skipped.length;

  if (checkedCount === 0) {
    console.log(`${DIM}No agents to check.${RESET}`);
    printSkippedAgents(skipped);
    return;
  }

  if (updates.length === 0) {
    console.log(`${TEXT}✓ All agents are up to date${RESET}`);
    console.log();
    return;
  }

  console.log(`${TEXT}Found ${updates.length} update(s)${RESET}`);
  console.log();

  // Reinstall each agent that has an update
  let successCount = 0;
  let failCount = 0;

  for (const update of updates) {
    console.log(`${TEXT}Updating ${update.name}...${RESET}`);

    // Build the URL with subpath to target the specific agent directory
    // e.g., https://github.com/owner/repo/tree/main/agents/my-agent
    let installUrl = update.entry.sourceUrl;
    if (update.entry.agentPath) {
      // Extract the agent folder path (remove /AGENT.md suffix)
      let agentFolder = update.entry.agentPath;
      if (agentFolder.endsWith('/AGENT.md')) {
        agentFolder = agentFolder.slice(0, -9);
      } else if (agentFolder.endsWith('AGENT.md')) {
        agentFolder = agentFolder.slice(0, -8);
      }
      if (agentFolder.endsWith('/')) {
        agentFolder = agentFolder.slice(0, -1);
      }

      // Convert git URL to tree URL with path
      // https://github.com/owner/repo.git -> https://github.com/owner/repo/tree/main/path
      installUrl = update.entry.sourceUrl.replace(/\.git$/, '').replace(/\/$/, '');
      installUrl = `${installUrl}/tree/main/${agentFolder}`;
    }

    // Use agents CLI to reinstall with -g -y flags
    const result = spawnSync('npx', ['-y', 'agents', 'add', installUrl, '-g', '-y'], {
      stdio: ['inherit', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
    });

    if (result.status === 0) {
      successCount++;
      console.log(`  ${TEXT}✓${RESET} Updated ${update.name}`);
    } else {
      failCount++;
      console.log(`  ${DIM}✗ Failed to update ${update.name}${RESET}`);
    }
  }

  console.log();
  if (successCount > 0) {
    console.log(`${TEXT}✓ Updated ${successCount} agent(s)${RESET}`);
  }
  if (failCount > 0) {
    console.log(`${DIM}Failed to update ${failCount} agent(s)${RESET}`);
  }

  // Track telemetry
  track({
    event: 'update',
    agentCount: String(updates.length),
    successCount: String(successCount),
    failCount: String(failCount),
  });

  console.log();
}

// ============================================
// Main
// ============================================

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    showBanner();
    return;
  }

  const command = args[0];
  const restArgs = args.slice(1);

  switch (command) {
    case 'find':
    case 'search':
    case 'f':
    case 's':
      showLogo();
      console.log();
      await runFind(restArgs);
      break;
    case 'init':
      showLogo();
      console.log();
      runInit(restArgs);
      break;
    case 'experimental_install': {
      showLogo();
      await runInstallFromLock(restArgs);
      break;
    }
    case 'i':
    case 'install':
    case 'a':
    case 'add': {
      showLogo();
      const { source: addSource, options: addOpts } = parseAddOptions(restArgs);
      await runAdd(addSource, addOpts);
      break;
    }
    case 'remove':
    case 'rm':
    case 'r':
      // Check for --help or -h flag
      if (restArgs.includes('--help') || restArgs.includes('-h')) {
        showRemoveHelp();
        break;
      }
      const { agents, options: removeOptions } = parseRemoveOptions(restArgs);
      await removeCommand(agents, removeOptions);
      break;
    case 'experimental_sync': {
      showLogo();
      const { options: syncOptions } = parseSyncOptions(restArgs);
      await runSync(restArgs, syncOptions);
      break;
    }
    case 'list':
    case 'ls':
      await runList(restArgs);
      break;
    case 'check':
      runCheck(restArgs);
      break;
    case 'update':
    case 'upgrade':
      runUpdate();
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
      console.log(`Unknown command: ${command}`);
      console.log(`Run ${BOLD}agents --help${RESET} for usage.`);
  }
}

main();
