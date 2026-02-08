#!/usr/bin/env node

import { spawn, spawnSync } from 'child_process';
import { writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'fs';
import { basename, join, dirname } from 'path';
import { homedir } from 'os';
import { createHash } from 'crypto';
import { fileURLToPath } from 'url';
import { runAdd, parseAddOptions, initTelemetry } from './add.ts';
import { runFind } from './find.ts';
import { runList } from './list.ts';
import { removeCommand, parseRemoveOptions } from './remove.ts';
import { track } from './telemetry.ts';
import { fetchSkillFolderHash, getGitHubToken } from './skill-lock.ts';

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
  '███████╗██╗   ██╗███╗   ██╗██╗  ██╗',
  '██╔════╝╚██╗ ██╔╝████╗  ██║██║ ██╔╝',
  '███████╗ ╚████╔╝ ██╔██╗ ██║█████╔╝ ',
  '╚════██║  ╚██╔╝  ██║╚██╗██║██╔═██╗ ',
  '███████║   ██║   ██║ ╚████║██║  ██╗',
  '╚══════╝   ╚═╝   ╚═╝  ╚═══╝╚═╝  ╚═╝',
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

function showHelp(): void {
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

function showRemoveHelp(): void {
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

function runInit(args: string[]): void {
  const cwd = process.cwd();

  // Parse --type flag
  let cognitiveType: 'skill' | 'agent' | 'prompt' = 'skill';
  const filteredArgs: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if ((arg === '-t' || arg === '--type') && i + 1 < args.length) {
      const typeVal = args[i + 1]!;
      if (typeVal === 'skill' || typeVal === 'agent' || typeVal === 'prompt') {
        cognitiveType = typeVal;
      }
      i++;
    } else if (arg && !arg.startsWith('-')) {
      filteredArgs.push(arg);
    }
  }

  const itemName = filteredArgs[0] || basename(cwd);
  const hasName = filteredArgs[0] !== undefined;

  const fileNames: Record<string, string> = {
    skill: 'SKILL.md',
    agent: 'AGENT.md',
    prompt: 'PROMPT.md',
  };
  const fileName = fileNames[cognitiveType]!;

  const itemDir = hasName ? join(cwd, itemName) : cwd;
  const itemFile = join(itemDir, fileName);
  const displayPath = hasName ? `${itemName}/${fileName}` : fileName;

  if (existsSync(itemFile)) {
    console.log(`${TEXT}${cognitiveType} already exists at ${DIM}${displayPath}${RESET}`);
    return;
  }

  if (hasName) {
    mkdirSync(itemDir, { recursive: true });
  }

  let content: string;
  if (cognitiveType === 'agent') {
    content = `---
name: ${itemName}
description: A brief description of this agent
---

# ${itemName}

Agent instructions here.

## Role

Describe the agent's role and capabilities.

## Instructions

1. First step
2. Second step
3. Additional steps as needed
`;
  } else if (cognitiveType === 'prompt') {
    content = `---
name: ${itemName}
description: A brief description of this prompt
---

# ${itemName}

Prompt template content here.

## Context

Describe when this prompt should be used.

## Template

Your prompt template goes here.
`;
  } else {
    content = `---
name: ${itemName}
description: A brief description of what this skill does
---

# ${itemName}

Instructions for the agent to follow when this skill is activated.

## When to use

Describe when this skill should be used.

## Instructions

1. First step
2. Second step
3. Additional steps as needed
`;
  }

  writeFileSync(itemFile, content);

  console.log(`${TEXT}Initialized ${cognitiveType}: ${DIM}${itemName}${RESET}`);
  console.log();
  console.log(`${DIM}Created:${RESET}`);
  console.log(`  ${displayPath}`);
  console.log();
  console.log(`${DIM}Next steps:${RESET}`);
  console.log(
    `  1. Edit ${TEXT}${displayPath}${RESET} to define your ${cognitiveType} instructions`
  );
  console.log(
    `  2. Update the ${TEXT}name${RESET} and ${TEXT}description${RESET} in the frontmatter`
  );
  console.log();
  console.log(`${DIM}Publishing:${RESET}`);
  console.log(
    `  ${DIM}GitHub:${RESET}  Push to a repo, then ${TEXT}npx synk add <owner>/<repo>${RESET}`
  );
  console.log(
    `  ${DIM}URL:${RESET}     Host the file, then ${TEXT}npx synk add https://example.com/${displayPath}${RESET}`
  );
  console.log();
}

// ============================================
// Check and Update Commands
// ============================================

const AGENTS_DIR = '.agents';
const LOCK_FILE = '.skill-lock.json';
const CHECK_UPDATES_API_URL = 'https://add-skill.vercel.sh/check-updates';
const CURRENT_LOCK_VERSION = 4; // Bumped from 3 to 4 for cognitiveType support

interface SkillLockEntry {
  source: string;
  sourceType: string;
  sourceUrl: string;
  skillPath?: string;
  /** GitHub tree SHA for the entire skill folder (v3) */
  skillFolderHash: string;
  installedAt: string;
  updatedAt: string;
}

interface SkillLockFile {
  version: number;
  skills: Record<string, SkillLockEntry>;
}

interface CheckUpdatesRequest {
  skills: Array<{
    name: string;
    source: string;
    path?: string;
    skillFolderHash: string;
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

function getSkillLockPath(): string {
  return join(homedir(), AGENTS_DIR, LOCK_FILE);
}

function readSkillLock(): SkillLockFile {
  const lockPath = getSkillLockPath();
  try {
    const content = readFileSync(lockPath, 'utf-8');
    const parsed = JSON.parse(content) as SkillLockFile;
    if (typeof parsed.version !== 'number' || !parsed.skills) {
      return { version: CURRENT_LOCK_VERSION, skills: {} };
    }
    // If old version, wipe and start fresh (backwards incompatible change)
    // v3 adds skillFolderHash - we want fresh installs to populate it
    if (parsed.version < CURRENT_LOCK_VERSION) {
      return { version: CURRENT_LOCK_VERSION, skills: {} };
    }
    return parsed;
  } catch {
    return { version: CURRENT_LOCK_VERSION, skills: {} };
  }
}

function writeSkillLock(lock: SkillLockFile): void {
  const lockPath = getSkillLockPath();
  const dir = join(homedir(), AGENTS_DIR);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(lockPath, JSON.stringify(lock, null, 2), 'utf-8');
}

async function runCheck(args: string[] = []): Promise<void> {
  console.log(`${TEXT}Checking for skill updates...${RESET}`);
  console.log();

  const lock = readSkillLock();
  const skillNames = Object.keys(lock.skills);

  if (skillNames.length === 0) {
    console.log(`${DIM}No skills tracked in lock file.${RESET}`);
    console.log(`${DIM}Install skills with${RESET} ${TEXT}npx synk add <package>${RESET}`);
    return;
  }

  // Get GitHub token from user's environment for higher rate limits
  const token = getGitHubToken();

  // Group skills by source (owner/repo) to batch GitHub API calls
  const skillsBySource = new Map<string, Array<{ name: string; entry: SkillLockEntry }>>();
  let skippedCount = 0;

  for (const skillName of skillNames) {
    const entry = lock.skills[skillName];
    if (!entry) continue;

    // Only check GitHub-sourced skills with folder hash
    if (entry.sourceType !== 'github' || !entry.skillFolderHash || !entry.skillPath) {
      skippedCount++;
      continue;
    }

    const existing = skillsBySource.get(entry.source) || [];
    existing.push({ name: skillName, entry });
    skillsBySource.set(entry.source, existing);
  }

  const totalSkills = skillNames.length - skippedCount;
  if (totalSkills === 0) {
    console.log(`${DIM}No GitHub skills to check.${RESET}`);
    return;
  }

  console.log(`${DIM}Checking ${totalSkills} skill(s) for updates...${RESET}`);

  const updates: Array<{ name: string; source: string }> = [];
  const errors: Array<{ name: string; source: string; error: string }> = [];

  // Check each source (one API call per repo)
  for (const [source, skills] of skillsBySource) {
    for (const { name, entry } of skills) {
      try {
        const latestHash = await fetchSkillFolderHash(source, entry.skillPath!, token);

        if (!latestHash) {
          errors.push({ name, source, error: 'Could not fetch from GitHub' });
          continue;
        }

        if (latestHash !== entry.skillFolderHash) {
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
    console.log(`${TEXT}✓ All skills are up to date${RESET}`);
  } else {
    console.log(`${TEXT}${updates.length} update(s) available:${RESET}`);
    console.log();
    for (const update of updates) {
      console.log(`  ${TEXT}↑${RESET} ${update.name}`);
      console.log(`    ${DIM}source: ${update.source}${RESET}`);
    }
    console.log();
    console.log(
      `${DIM}Run${RESET} ${TEXT}npx synk update${RESET} ${DIM}to update all skills${RESET}`
    );
  }

  if (errors.length > 0) {
    console.log();
    console.log(`${DIM}Could not check ${errors.length} skill(s) (may need reinstall)${RESET}`);
  }

  // Track telemetry
  track({
    event: 'check',
    skillCount: String(totalSkills),
    updatesAvailable: String(updates.length),
  });

  console.log();
}

async function runUpdate(): Promise<void> {
  console.log(`${TEXT}Checking for skill updates...${RESET}`);
  console.log();

  const lock = readSkillLock();
  const skillNames = Object.keys(lock.skills);

  if (skillNames.length === 0) {
    console.log(`${DIM}No skills tracked in lock file.${RESET}`);
    console.log(`${DIM}Install skills with${RESET} ${TEXT}npx synk add <package>${RESET}`);
    return;
  }

  // Get GitHub token from user's environment for higher rate limits
  const token = getGitHubToken();

  // Find skills that need updates by checking GitHub directly
  const updates: Array<{ name: string; source: string; entry: SkillLockEntry }> = [];
  let checkedCount = 0;

  for (const skillName of skillNames) {
    const entry = lock.skills[skillName];
    if (!entry) continue;

    // Only check GitHub-sourced skills with folder hash
    if (entry.sourceType !== 'github' || !entry.skillFolderHash || !entry.skillPath) {
      continue;
    }

    checkedCount++;

    try {
      const latestHash = await fetchSkillFolderHash(entry.source, entry.skillPath, token);

      if (latestHash && latestHash !== entry.skillFolderHash) {
        updates.push({ name: skillName, source: entry.source, entry });
      }
    } catch {
      // Skip skills that fail to check
    }
  }

  if (checkedCount === 0) {
    console.log(`${DIM}No skills to check.${RESET}`);
    return;
  }

  if (updates.length === 0) {
    console.log(`${TEXT}✓ All skills are up to date${RESET}`);
    console.log();
    return;
  }

  console.log(`${TEXT}Found ${updates.length} update(s)${RESET}`);
  console.log();

  // Reinstall each skill that has an update
  let successCount = 0;
  let failCount = 0;

  for (const update of updates) {
    console.log(`${TEXT}Updating ${update.name}...${RESET}`);

    // Build the URL with subpath to target the specific skill directory
    // e.g., https://github.com/owner/repo/tree/main/skills/my-skill
    let installUrl = update.entry.sourceUrl;
    if (update.entry.skillPath) {
      // Extract the skill folder path (remove /SKILL.md suffix)
      let skillFolder = update.entry.skillPath;
      if (skillFolder.endsWith('/SKILL.md')) {
        skillFolder = skillFolder.slice(0, -9);
      } else if (skillFolder.endsWith('SKILL.md')) {
        skillFolder = skillFolder.slice(0, -8);
      }
      if (skillFolder.endsWith('/')) {
        skillFolder = skillFolder.slice(0, -1);
      }

      // Convert git URL to tree URL with path
      // https://github.com/owner/repo.git -> https://github.com/owner/repo/tree/main/path
      installUrl = update.entry.sourceUrl.replace(/\.git$/, '').replace(/\/$/, '');
      installUrl = `${installUrl}/tree/main/${skillFolder}`;
    }

    // Use skills CLI to reinstall with -g -y flags
    const result = spawnSync('npx', ['-y', 'skills', 'add', installUrl, '-g', '-y'], {
      stdio: ['inherit', 'pipe', 'pipe'],
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
    console.log(`${TEXT}✓ Updated ${successCount} skill(s)${RESET}`);
  }
  if (failCount > 0) {
    console.log(`${DIM}Failed to update ${failCount} skill(s)${RESET}`);
  }

  // Track telemetry
  track({
    event: 'update',
    skillCount: String(updates.length),
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
    case 'i':
    case 'install':
    case 'a':
    case 'add': {
      showLogo();
      const { source, options } = parseAddOptions(restArgs);
      await runAdd(source, options);
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
      const { skills, options: removeOptions } = parseRemoveOptions(restArgs);
      await removeCommand(skills, removeOptions);
      break;
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
      console.log(`Run ${BOLD}synk --help${RESET} for usage.`);
  }
}

main();
