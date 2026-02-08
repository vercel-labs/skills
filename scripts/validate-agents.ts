#!/usr/bin/env node

import { homedir } from 'os';
import { agents } from '../src/services/registry/__generated__/agents.ts';

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

  for (const [key, config] of Object.entries(agents)) {
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
 * Checks for duplicate `dirs.skill.local` and `dirs.skill.global` values among agents.
 *
 * Iterates through the `agents` object, collecting all `dirs.skill.local` and normalized `dirs.skill.global`
 * paths. If any directory is associated with more than one agent, an error is reported listing the
 * conflicting agents.
 *
 * @remarks
 * - The `dirs.skill.global` path is normalized by replacing the user's home directory with `~`.
 * - Errors are reported using the `error` function.
 *
 * @throws Will call `error` if duplicate directories are found.
 */

function checkDuplicateSkillsDirs() {
  const skillsDirs = new Map<string, string[]>();
  const globalSkillsDirs = new Map<string, string[]>();

  for (const [key, config] of Object.entries(agents)) {
    const localSkills = config.dirs.skill.local;
    if (!skillsDirs.has(localSkills)) {
      skillsDirs.set(localSkills, []);
    }
    skillsDirs.get(localSkills)!.push(key);

    const globalPath = (config.dirs.skill.global ?? '').replace(homedir(), '~');
    if (!globalSkillsDirs.has(globalPath)) {
      globalSkillsDirs.set(globalPath, []);
    }
    globalSkillsDirs.get(globalPath)!.push(key);
  }

  for (const [dir, keys] of skillsDirs) {
    if (keys.length > 1) {
      error(`Duplicate dirs.skill.local "${dir}" found in agents: ${keys.join(', ')}`);
    }
  }

  for (const [dir, keys] of globalSkillsDirs) {
    if (keys.length > 1) {
      error(`Duplicate dirs.skill.global "${dir}" found in agents: ${keys.join(', ')}`);
    }
  }
}

console.log('Validating agents...\n');

checkDuplicateDisplayNames();
// It's fine to have duplicate skills dirs
// checkDuplicateSkillsDirs();

if (hasErrors) {
  console.log('\nValidation failed.');
  process.exit(1);
} else {
  console.log('All agents valid.');
}
