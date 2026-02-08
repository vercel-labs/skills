import { access, readdir, stat } from 'fs/promises';
import { join } from 'path';
import type { AgentType, CognitiveType } from '../../core/types.ts';
import { COGNITIVE_FILE_NAMES } from '../../core/types.ts';
import { agents, detectInstalledAgents, getCognitiveDir } from '../registry/index.ts';
import { parseCognitiveMd } from '../discovery/index.ts';
import { sanitizeName, getCanonicalDir, isPathSafe } from './paths.ts';

export interface InstalledCognitive {
  name: string;
  description: string;
  path: string;
  canonicalPath: string;
  scope: 'project' | 'global';
  agents: AgentType[];
  cognitiveType: CognitiveType;
}

/** @deprecated Use InstalledCognitive */
export type InstalledSkill = InstalledCognitive;

/**
 * Lists all installed cognitives (skills, agents, prompts) from canonical locations.
 * Scans .agents/skills/, .agents/agents/, .agents/prompts/ directories and
 * looks for the corresponding file (SKILL.md, AGENT.md, PROMPT.md) in each.
 * @param options - Options for listing cognitives
 * @returns Array of installed cognitives with metadata
 */
export async function listInstalledCognitives(
  options: {
    global?: boolean;
    cwd?: string;
    agentFilter?: AgentType[];
    typeFilter?: CognitiveType[];
  } = {}
): Promise<InstalledCognitive[]> {
  const cwd = options.cwd || process.cwd();
  const typesToScan: CognitiveType[] =
    options.typeFilter ?? (Object.keys(COGNITIVE_FILE_NAMES) as CognitiveType[]);
  // Use a Map to deduplicate by scope:type:name
  const cognitivesMap: Map<string, InstalledCognitive> = new Map();

  // Detect which agents are actually installed
  const detectedAgents = await detectInstalledAgents();
  const agentFilter = options.agentFilter;
  const agentsToCheck = agentFilter
    ? detectedAgents.filter((a) => agentFilter.includes(a))
    : detectedAgents;

  // Determine which scopes to scan
  const scopeTypes: Array<{ global: boolean }> = [];
  if (options.global === undefined) {
    scopeTypes.push({ global: false }, { global: true });
  } else {
    scopeTypes.push({ global: options.global });
  }

  for (const cognitiveType of typesToScan) {
    const fileName = COGNITIVE_FILE_NAMES[cognitiveType];
    const scopes: Array<{ global: boolean; path: string; agentType?: AgentType }> = [];

    // Build list of directories to scan: canonical + each installed agent's directory
    //
    // Scanning workflow:
    //
    //   detectInstalledAgents()
    //            |
    //            v
    //   for each scope (project / global)
    //            |
    //            +-->  scan canonical dir -->  .agents/<type>, ~/.agents/<type>
    //            |
    //            +-->  scan each installed agent's dir -->  .cursor/<type>, .claude/<type>, ...
    //            |
    //            v
    //   deduplicate by cognitive name
    //
    // Trade-off: More readdir() calls, but most non-existent dirs fail fast.
    // Cognitives in agent-specific dirs skip the expensive "check all agents" loop.
    //
    for (const { global: isGlobal } of scopeTypes) {
      // Add canonical directory
      scopes.push({ global: isGlobal, path: getCanonicalDir(cognitiveType, isGlobal, cwd) });

      // Add each installed agent's directory for this cognitive type
      for (const agentType of agentsToCheck) {
        const globalDir = getCognitiveDir(agentType, cognitiveType, 'global');
        if (isGlobal && globalDir === undefined) {
          continue;
        }
        const localDir = getCognitiveDir(agentType, cognitiveType, 'local')!;
        const agentDir = isGlobal ? globalDir! : join(cwd, localDir);
        // Avoid duplicate paths
        if (!scopes.some((s) => s.path === agentDir && s.global === isGlobal)) {
          scopes.push({ global: isGlobal, path: agentDir, agentType });
        }
      }
    }

    for (const scope of scopes) {
      try {
        const entries = await readdir(scope.path, { withFileTypes: true });

        for (const entry of entries) {
          if (!entry.isDirectory()) {
            continue;
          }

          const cognitiveDir = join(scope.path, entry.name);
          const mdPath = join(cognitiveDir, fileName);

          // Check if the cognitive file exists
          try {
            await stat(mdPath);
          } catch {
            // Cognitive file doesn't exist, skip this directory
            continue;
          }

          // Parse the cognitive file
          const parsed = await parseCognitiveMd(mdPath, cognitiveType);
          if (!parsed) {
            continue;
          }

          const scopeKey = scope.global ? 'global' : 'project';
          const cognitiveKey = `${scopeKey}:${cognitiveType}:${parsed.name}`;

          // If scanning an agent-specific directory, attribute directly to that agent
          if (scope.agentType) {
            if (cognitivesMap.has(cognitiveKey)) {
              const existing = cognitivesMap.get(cognitiveKey)!;
              if (!existing.agents.includes(scope.agentType)) {
                existing.agents.push(scope.agentType);
              }
            } else {
              cognitivesMap.set(cognitiveKey, {
                name: parsed.name,
                description: parsed.description,
                path: cognitiveDir,
                canonicalPath: cognitiveDir,
                scope: scopeKey,
                agents: [scope.agentType],
                cognitiveType,
              });
            }
            continue;
          }

          // For canonical directory, check which agents have this cognitive
          const sanitizedName = sanitizeName(parsed.name);
          const installedAgents: AgentType[] = [];

          for (const agentType of agentsToCheck) {
            const globalDir = getCognitiveDir(agentType, cognitiveType, 'global');

            if (scope.global && globalDir === undefined) {
              continue;
            }

            const localDir = getCognitiveDir(agentType, cognitiveType, 'local')!;
            const agentBase = scope.global ? globalDir! : join(cwd, localDir);
            let found = false;

            // Try exact directory name matches
            const possibleNames = Array.from(
              new Set([
                entry.name,
                sanitizedName,
                parsed.name
                  .toLowerCase()
                  .replace(/\s+/g, '-')
                  .replace(/[\/\\:\0]/g, ''),
              ])
            );

            for (const possibleName of possibleNames) {
              const agentCognitiveDir = join(agentBase, possibleName);
              if (!isPathSafe(agentBase, agentCognitiveDir)) continue;

              try {
                await access(agentCognitiveDir);
                found = true;
                break;
              } catch {
                // Try next name
              }
            }

            // Fallback: scan all directories and check cognitive files
            // Handles cases where directory names don't match
            if (!found) {
              try {
                const agentEntries = await readdir(agentBase, { withFileTypes: true });
                for (const agentEntry of agentEntries) {
                  if (!agentEntry.isDirectory()) continue;

                  const candidateDir = join(agentBase, agentEntry.name);
                  if (!isPathSafe(agentBase, candidateDir)) continue;

                  try {
                    const candidateMdPath = join(candidateDir, fileName);
                    await stat(candidateMdPath);
                    const candidateParsed = await parseCognitiveMd(candidateMdPath, cognitiveType);
                    if (candidateParsed && candidateParsed.name === parsed.name) {
                      found = true;
                      break;
                    }
                  } catch {
                    // Not a valid cognitive directory
                  }
                }
              } catch {
                // Agent base directory doesn't exist
              }
            }

            if (found) {
              installedAgents.push(agentType);
            }
          }

          if (cognitivesMap.has(cognitiveKey)) {
            // Merge agents
            const existing = cognitivesMap.get(cognitiveKey)!;
            for (const agent of installedAgents) {
              if (!existing.agents.includes(agent)) {
                existing.agents.push(agent);
              }
            }
          } else {
            cognitivesMap.set(cognitiveKey, {
              name: parsed.name,
              description: parsed.description,
              path: cognitiveDir,
              canonicalPath: cognitiveDir,
              scope: scopeKey,
              agents: installedAgents,
              cognitiveType,
            });
          }
        }
      } catch {
        // Directory doesn't exist, skip
      }
    }
  }

  return Array.from(cognitivesMap.values());
}

/**
 * Lists all installed skills from canonical locations (backward-compatible wrapper).
 * @param options - Options for listing skills
 * @returns Array of installed skills with metadata
 */
export async function listInstalledSkills(
  options: {
    global?: boolean;
    cwd?: string;
    agentFilter?: AgentType[];
  } = {}
): Promise<InstalledSkill[]> {
  return listInstalledCognitives({ ...options, typeFilter: ['skill'] });
}

/**
 * Check if a cognitive (skill, agent, or prompt) is installed for a specific agent.
 */
export async function isCognitiveInstalled(
  name: string,
  agentType: AgentType,
  cognitiveType: CognitiveType,
  options: { global?: boolean; cwd?: string } = {}
): Promise<boolean> {
  const sanitized = sanitizeName(name);

  // Check if agent supports global installation for this cognitive type
  const globalDir = getCognitiveDir(agentType, cognitiveType, 'global');
  if (options.global && globalDir === undefined) {
    return false;
  }

  const localDir = getCognitiveDir(agentType, cognitiveType, 'local')!;
  const targetBase = options.global ? globalDir! : join(options.cwd || process.cwd(), localDir);

  const cognitiveDir = join(targetBase, sanitized);

  if (!isPathSafe(targetBase, cognitiveDir)) {
    return false;
  }

  try {
    await access(cognitiveDir);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if a skill is installed for a specific agent (backward-compatible wrapper).
 */
export async function isSkillInstalled(
  skillName: string,
  agentType: AgentType,
  options: { global?: boolean; cwd?: string; cognitiveType?: CognitiveType } = {}
): Promise<boolean> {
  return isCognitiveInstalled(skillName, agentType, options.cognitiveType ?? 'skill', options);
}
