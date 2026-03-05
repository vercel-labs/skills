import {
  readGroupsConfig,
  createGroup,
  deleteGroup,
  addSkillToGroup,
  removeSkillFromGroup,
  getSkillsInGroup,
} from './groups.ts';

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[38;5;102m';
const TEXT = '\x1b[38;5;145m';
const CYAN = '\x1b[36m';
const YELLOW = '\x1b[33m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';

function showGroupsHelp(): void {
  console.log(`
${BOLD}Usage:${RESET} skills groups [subcommand] [options]

${BOLD}Subcommands:${RESET}
  ${TEXT}(none)${RESET}              List all groups and their skills
  show <group>        Show details of a specific group
  create <group>      Create a new empty group
  add <group> <skill> Add a skill to a group
  remove <group> <skill>  Remove a skill from a group (doesn't uninstall)
  delete <group>      Delete a group (doesn't uninstall skills)

${BOLD}Options:${RESET}
  --description, -d   Description for create subcommand

${BOLD}Examples:${RESET}
  ${DIM}$${RESET} skills groups
  ${DIM}$${RESET} skills groups show debug
  ${DIM}$${RESET} skills groups create deploy -d "Deployment skills"
  ${DIM}$${RESET} skills groups add debug logging-best-practices
  ${DIM}$${RESET} skills groups remove debug logging-best-practices
  ${DIM}$${RESET} skills groups delete deploy
`);
}

/**
 * Run the `skills groups` subcommand.
 */
export async function runGroups(args: string[]): Promise<void> {
  if (args.includes('--help') || args.includes('-h')) {
    showGroupsHelp();
    return;
  }

  const subcommand = args[0];

  if (!subcommand) {
    await listGroups();
    return;
  }

  switch (subcommand) {
    case 'show':
      await showGroup(args[1]);
      break;
    case 'create':
      await handleCreate(args.slice(1));
      break;
    case 'add':
      await handleAdd(args[1], args[2]);
      break;
    case 'remove':
      await handleRemove(args[1], args[2]);
      break;
    case 'delete':
      await handleDelete(args[1]);
      break;
    default:
      console.log(`${RED}Unknown subcommand: ${subcommand}${RESET}`);
      showGroupsHelp();
  }
}

async function listGroups(): Promise<void> {
  const config = await readGroupsConfig();
  if (!config || Object.keys(config.groups).length === 0) {
    console.log(`${DIM}No groups defined.${RESET}`);
    console.log(`${DIM}Create one with:${RESET} ${TEXT}npx skills groups create <name>${RESET}`);
    return;
  }

  console.log(`${BOLD}Skill Groups${RESET}`);
  console.log();

  for (const [name, group] of Object.entries(config.groups).sort(([a], [b]) =>
    a.localeCompare(b)
  )) {
    const desc = group.description ? ` ${DIM}— ${group.description}${RESET}` : '';
    console.log(`${CYAN}${name}${RESET}${desc}`);
    if (group.skills.length === 0) {
      console.log(`  ${DIM}(empty)${RESET}`);
    } else {
      for (const skill of group.skills.sort()) {
        console.log(`  ${TEXT}•${RESET} ${skill}`);
      }
    }
    console.log();
  }
}

async function showGroup(groupName?: string): Promise<void> {
  if (!groupName) {
    console.log(`${RED}Usage: skills groups show <group>${RESET}`);
    return;
  }

  const config = await readGroupsConfig();
  if (!config) {
    console.log(`${DIM}No groups config found.${RESET}`);
    return;
  }

  const skills = getSkillsInGroup(config, groupName);
  if (!skills) {
    console.log(`${YELLOW}Group "${groupName}" not found.${RESET}`);
    return;
  }

  const group = config.groups[groupName]!;
  console.log(`${BOLD}${groupName}${RESET}`);
  if (group.description) {
    console.log(`${DIM}${group.description}${RESET}`);
  }
  console.log();

  if (skills.length === 0) {
    console.log(`  ${DIM}(empty)${RESET}`);
  } else {
    for (const skill of skills.sort()) {
      console.log(`  ${TEXT}•${RESET} ${skill}`);
    }
  }
  console.log();
}

async function handleCreate(args: string[]): Promise<void> {
  const groupName = args[0];
  if (!groupName) {
    console.log(`${RED}Usage: skills groups create <group> [-d "description"]${RESET}`);
    return;
  }

  let description = '';
  const descIdx = args.indexOf('-d');
  const descLongIdx = args.indexOf('--description');
  const idx = descIdx !== -1 ? descIdx : descLongIdx;
  if (idx !== -1 && args[idx + 1]) {
    description = args[idx + 1]!;
  }

  const created = await createGroup(groupName, description);
  if (created) {
    console.log(`${GREEN}✓${RESET} Created group "${groupName}"`);
  } else {
    console.log(`${YELLOW}Group "${groupName}" already exists.${RESET}`);
  }
}

async function handleAdd(groupName?: string, skillName?: string): Promise<void> {
  if (!groupName || !skillName) {
    console.log(`${RED}Usage: skills groups add <group> <skill>${RESET}`);
    return;
  }

  const added = await addSkillToGroup(skillName, groupName);
  if (added) {
    console.log(`${GREEN}✓${RESET} Added "${skillName}" to group "${groupName}"`);
  } else {
    console.log(`${YELLOW}"${skillName}" is already in group "${groupName}".${RESET}`);
  }
}

async function handleRemove(groupName?: string, skillName?: string): Promise<void> {
  if (!groupName || !skillName) {
    console.log(`${RED}Usage: skills groups remove <group> <skill>${RESET}`);
    return;
  }

  const removed = await removeSkillFromGroup(skillName, groupName);
  if (removed) {
    console.log(`${GREEN}✓${RESET} Removed "${skillName}" from group "${groupName}"`);
  } else {
    console.log(
      `${YELLOW}Could not remove "${skillName}" from group "${groupName}" (not found).${RESET}`
    );
  }
}

async function handleDelete(groupName?: string): Promise<void> {
  if (!groupName) {
    console.log(`${RED}Usage: skills groups delete <group>${RESET}`);
    return;
  }

  const deleted = await deleteGroup(groupName);
  if (deleted) {
    const skillCount = deleted.skills.length;
    const note = skillCount > 0 ? ` (${skillCount} skill(s) ungrouped, not uninstalled)` : '';
    console.log(`${GREEN}✓${RESET} Deleted group "${groupName}"${note}`);
  } else {
    console.log(`${YELLOW}Group "${groupName}" not found.${RESET}`);
  }
}
