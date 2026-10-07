export interface DiscoveredSkillLocation {
  name: string;
  skillPath: string;
}

export interface SkillLocationResolution {
  deletedSkills: string[];
  ambiguousSkills: string[];
  resolvedPaths: Map<string, string>;
}

function normalizeSkillName(name: string): string {
  return name.toLowerCase().replace(/[\s_]+/g, '-');
}

function normalizeSkillPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+/g, '/');
}

/**
 * Resolve locked skills against their currently discovered locations.
 *
 * Exact paths always win. A missing path is treated as a relocation only when
 * exactly one discovered skill has the same normalized name. Ambiguous matches
 * fail closed: they are neither migrated nor offered for deletion.
 */
export function resolveSkillLocations(
  lockedSkillNames: string[],
  lockSkills: Record<string, { skillPath?: string }>,
  discovered: DiscoveredSkillLocation[]
): SkillLocationResolution {
  const discoveredPaths = new Set(discovered.map((skill) => normalizeSkillPath(skill.skillPath)));
  const pathsByName = new Map<string, Set<string>>();

  for (const skill of discovered) {
    const key = normalizeSkillName(skill.name);
    const paths = pathsByName.get(key) ?? new Set<string>();
    paths.add(normalizeSkillPath(skill.skillPath));
    pathsByName.set(key, paths);
  }

  const deletedSkills: string[] = [];
  const ambiguousSkills: string[] = [];
  const resolvedPaths = new Map<string, string>();

  for (const name of lockedSkillNames) {
    const lockedPath = lockSkills[name]?.skillPath;
    if (!lockedPath) continue;

    const normalizedLockedPath = normalizeSkillPath(lockedPath);
    const candidates = [...(pathsByName.get(normalizeSkillName(name)) ?? [])];

    // Update reinstallation ultimately selects by skill name. If more than one
    // current location has that name, even an exact locked path is not enough
    // to guarantee that every source type will reinstall the same one.
    if (candidates.length > 1) {
      ambiguousSkills.push(name);
      continue;
    }

    if (discoveredPaths.has(normalizedLockedPath)) {
      resolvedPaths.set(name, normalizedLockedPath);
      continue;
    }

    if (candidates.length === 1) {
      resolvedPaths.set(name, candidates[0]!);
    } else {
      deletedSkills.push(name);
    }
  }

  return { deletedSkills, ambiguousSkills, resolvedPaths };
}
