import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';

const GROUPS_FILE = 'skills.groups.json';

export interface SkillGroup {
  description: string;
  skills: string[];
}

export interface GroupsConfig {
  groups: Record<string, SkillGroup>;
}

/**
 * Get the path to the groups config file.
 */
export function getGroupsPath(cwd?: string): string {
  return join(cwd || process.cwd(), GROUPS_FILE);
}

/**
 * Read the groups config file.
 * Returns null if the file doesn't exist or is invalid.
 */
export async function readGroupsConfig(cwd?: string): Promise<GroupsConfig | null> {
  try {
    const content = await readFile(getGroupsPath(cwd), 'utf-8');
    const parsed = JSON.parse(content) as GroupsConfig;
    if (!parsed.groups || typeof parsed.groups !== 'object') {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Write the groups config file.
 * Groups are sorted alphabetically by name for deterministic output.
 */
export async function writeGroupsConfig(config: GroupsConfig, cwd?: string): Promise<void> {
  const sorted: Record<string, SkillGroup> = {};
  for (const key of Object.keys(config.groups).sort()) {
    const group = config.groups[key]!;
    sorted[key] = { description: group.description, skills: [...group.skills].sort() };
  }
  const output: GroupsConfig = { groups: sorted };
  const content = JSON.stringify(output, null, 2) + '\n';
  await writeFile(getGroupsPath(cwd), content, 'utf-8');
}

/**
 * Create a new group. Returns false if the group already exists.
 */
export async function createGroup(
  groupName: string,
  description: string,
  cwd?: string
): Promise<boolean> {
  const config = (await readGroupsConfig(cwd)) || { groups: {} };
  if (config.groups[groupName]) {
    return false;
  }
  config.groups[groupName] = { description, skills: [] };
  await writeGroupsConfig(config, cwd);
  return true;
}

/**
 * Delete a group. Returns the removed group or null if not found.
 */
export async function deleteGroup(groupName: string, cwd?: string): Promise<SkillGroup | null> {
  const config = await readGroupsConfig(cwd);
  if (!config || !config.groups[groupName]) {
    return null;
  }
  const removed = config.groups[groupName]!;
  delete config.groups[groupName];
  await writeGroupsConfig(config, cwd);
  return removed;
}

/**
 * Add a skill to a group. Creates the group if it doesn't exist.
 * Returns false if the skill is already in the group.
 */
export async function addSkillToGroup(
  skillName: string,
  groupName: string,
  cwd?: string
): Promise<boolean> {
  const config = (await readGroupsConfig(cwd)) || { groups: {} };
  if (!config.groups[groupName]) {
    config.groups[groupName] = { description: '', skills: [] };
  }
  const group = config.groups[groupName]!;
  if (group.skills.includes(skillName)) {
    return false;
  }
  group.skills.push(skillName);
  await writeGroupsConfig(config, cwd);
  return true;
}

/**
 * Remove a skill from a group.
 * Returns false if the group doesn't exist or the skill isn't in it.
 */
export async function removeSkillFromGroup(
  skillName: string,
  groupName: string,
  cwd?: string
): Promise<boolean> {
  const config = await readGroupsConfig(cwd);
  if (!config || !config.groups[groupName]) {
    return false;
  }
  const group = config.groups[groupName]!;
  const idx = group.skills.indexOf(skillName);
  if (idx === -1) {
    return false;
  }
  group.skills.splice(idx, 1);
  await writeGroupsConfig(config, cwd);
  return true;
}

/**
 * Find which group a skill belongs to.
 * Returns the group name or null.
 */
export function findGroupForSkill(config: GroupsConfig, skillName: string): string | null {
  for (const [name, group] of Object.entries(config.groups)) {
    if (group.skills.includes(skillName)) {
      return name;
    }
  }
  return null;
}

/**
 * Get all skill names in a group. Returns null if group doesn't exist.
 */
export function getSkillsInGroup(config: GroupsConfig, groupName: string): string[] | null {
  const group = config.groups[groupName];
  if (!group) return null;
  return [...group.skills];
}
