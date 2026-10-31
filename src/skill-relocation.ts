export interface DiscoveredSkillLocation {
  name: string;
  skillPath: string;
}

export interface SkillLocationResolution {
  deletedSkills: string[];
  ambiguousSkills: string[];
  resolvedPaths: Map<string, string>;
}

export interface SkillLocationResolutionOptions {
  exactPathDisambiguates?: boolean;
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
 * An exact path wins when the installer can target that path directly. A
 * missing path is treated as a relocation only when exactly one discovered
 * skill has the same normalized name. Other ambiguous matches fail closed:
 * they are neither migrated nor offered for deletion.
 */
export function resolveSkillLocations(
  lockedSkillNames: string[],
  lockSkills: Record<string, { skillPath?: string }>,
  discovered: DiscoveredSkillLocation[],
  options: SkillLocationResolutionOptions = {}
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
    const lockedPathStillExists = discoveredPaths.has(normalizedLockedPath);

    if (lockedPathStillExists && options.exactPathDisambiguates) {
      resolvedPaths.set(name, normalizedLockedPath);
      continue;
    }

    // Sources that cannot target a subpath reinstall by skill name. For those
    // sources, even an exact locked path cannot guarantee which copy is used.
    if (candidates.length > 1) {
      ambiguousSkills.push(name);
      continue;
    }

    if (lockedPathStillExists) {
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
