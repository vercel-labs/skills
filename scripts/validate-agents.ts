#!/usr/bin/env node

import { homedir } from 'os';
import { agents } from '../src/agents.ts';

let hasErrors = false;

function error(message: string) {
  console.error(message);
  hasErrors = true;
}

/**
 * Checks for duplicate `displayName` values among the agents.
 *
 * Iterates through the `agents` object, collecting all `displayName` values (case-insensitive)
 * and mapping them to their corresponding agent keys. If any `displayName` is associated with
 * more than one agent, an error is reported listing the duplicate names and their keys.
 *
 * @throws Will call the `error` function if duplicate display names are found.
 */

function checkDuplicateDisplayNames() {
  const displayNames = new Map<string, string[]>();

  for (const [key, config] of Object.entries(targets)) {
    const name = config.displayName.toLowerCase();
    if (!displayNames.has(name)) {
      displayNames.set(name, []);
    }
    displayNames.get(name)!.push(key);
  }

  for (const [name, keys] of displayNames) {
    if (keys.length > 1) {
      error(`Duplicate displayName "${name}" found in agents: ${keys.join(', ')}`);
    }
  }
}

/**
 * Checks for duplicate `agentsDir` and `globalAgentsDir` values among agents.
 *
 * Iterates through the `agents` object, collecting all `agentsDir` and normalized `globalAgentsDir`
 * paths. If any directory is associated with more than one agent, an error is reported listing the
 * conflicting agents.
 *
 * @remarks
 * - The `globalAgentsDir` path is normalized by replacing the user's home directory with `~`.
 * - Errors are reported using the `error` function.
 *
 * @throws Will call `error` if duplicate directories are found.
 */

function checkDuplicateSkillsDirs() {
  const agentsDirs = new Map<string, string[]>();
  const globalAgentsDirs = new Map<string, string[]>();

  for (const [key, config] of Object.entries(targets)) {
    if (!agentsDirs.has(config.agentsDir)) {
      agentsDirs.set(config.agentsDir, []);
    }
    agentsDirs.get(config.agentsDir)!.push(key);

    const globalPath = config.globalAgentsDir.replace(homedir(), '~');
    if (!globalAgentsDirs.has(globalPath)) {
      globalAgentsDirs.set(globalPath, []);
    }
    globalAgentsDirs.get(globalPath)!.push(key);
  }

  for (const [dir, keys] of agentsDirs) {
    if (keys.length > 1) {
      error(`Duplicate agentsDir "${dir}" found in agents: ${keys.join(', ')}`);
    }
  }

  for (const [dir, keys] of globalAgentsDirs) {
    if (keys.length > 1) {
      error(`Duplicate globalAgentsDir "${dir}" found in agents: ${keys.join(', ')}`);
    }
  }
}

console.log('Validating agents...\n');

checkDuplicateDisplayNames();
// It's fine to have duplicate agents dirs
// checkDuplicateSkillsDirs();

if (hasErrors) {
  console.log('\nValidation failed.');
  process.exit(1);
} else {
  console.log('All agents valid.');
}
