export interface ManagementState {
  groups: Record<string, string[]>;
  managerSkill?: string;
}

export function createEmptyManagementState(): ManagementState {
  return { groups: {} };
}

export function normalizeManagementState(input: unknown): ManagementState {
  if (!isRecord(input)) {
    return createEmptyManagementState();
  }

  const dedupedGroups = new Map<string, Set<string>>();
  if (isRecord(input.groups)) {
    for (const [rawGroupName, rawMembers] of Object.entries(input.groups)) {
      const groupName = normalizeGroupName(rawGroupName);
      if (!groupName) continue;

      const members = dedupeAndSortStrings(rawMembers);
      const existingMembers = dedupedGroups.get(groupName) ?? new Set<string>();
      for (const member of members) {
        existingMembers.add(member);
      }
      dedupedGroups.set(groupName, existingMembers);
    }
  }

  const groups: Record<string, string[]> = {};
  for (const groupName of Array.from(dedupedGroups.keys()).sort()) {
    groups[groupName] = Array.from(dedupedGroups.get(groupName) ?? []).sort();
  }

  const managerSkill =
    typeof input.managerSkill === 'string' && input.managerSkill.trim().length > 0
      ? input.managerSkill.trim()
      : undefined;

  return managerSkill ? { groups, managerSkill } : { groups };
}

export function getGroupsForSkill(management: ManagementState, skillName: string): string[] {
  return Object.entries(normalizeManagementState(management).groups)
    .filter(([, members]) => members.includes(skillName))
    .map(([groupName]) => groupName)
    .sort();
}

export function scrubSkillFromManagement(
  management: ManagementState,
  skillName: string
): ManagementState {
  const normalized = normalizeManagementState(management);
  const groups: Record<string, string[]> = {};

  for (const [groupName, members] of Object.entries(normalized.groups)) {
    groups[groupName] = members.filter((member) => member !== skillName);
  }

  if (normalized.managerSkill === skillName) {
    return { groups };
  }

  return normalized.managerSkill ? { groups, managerSkill: normalized.managerSkill } : { groups };
}

function dedupeAndSortStrings(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalized = value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  return Array.from(new Set(normalized)).sort();
}

export function normalizeGroupName(groupName: string): string {
  return groupName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._]+/g, '-')
    .replace(/^[.\-]+|[.\-]+$/g, '');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
