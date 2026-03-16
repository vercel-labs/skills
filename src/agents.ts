import { readdir, readFile, stat } from 'fs/promises';
import { join, basename, dirname, resolve, normalize, sep } from 'path';
import matter from 'gray-matter';
import type { Agent } from './types.ts';
import { getPluginAgentPaths, getPluginGroupings } from './plugin-manifest.ts';

const SKIP_DIRS = ['node_modules', '.git', 'dist', 'build', '__pycache__'];

/**
 * Check if internal agents should be installed.
 * Internal agents are hidden by default unless INSTALL_INTERNAL_AGENTS=1 is set.
 */
export function shouldInstallInternalAgents(): boolean {
  const envValue = process.env.INSTALL_INTERNAL_AGENTS;
  return envValue === '1' || envValue === 'true';
}

async function hasAgentMd(dir: string): Promise<boolean> {
  try {
    const agentPath = join(dir, 'AGENT.md');
    const stats = await stat(agentPath);
    return stats.isFile();
  } catch {
    return false;
  }
}

export async function parseAgentMd(
  agentMdPath: string,
  options?: { includeInternal?: boolean }
): Promise<Agent | null> {
  try {
    const content = await readFile(agentMdPath, 'utf-8');
    const { data } = matter(content);

    if (!data.name || !data.description) {
      return null;
    }

    // Ensure name and description are strings (YAML can parse numbers, booleans, etc.)
    if (typeof data.name !== 'string' || typeof data.description !== 'string') {
      return null;
    }

    // Skip internal agents unless:
    // 1. INSTALL_INTERNAL_AGENTS=1 is set, OR
    // 2. includeInternal option is true (e.g., when user explicitly requests a agent)
    const isInternal = data.metadata?.internal === true;
    if (isInternal && !shouldInstallInternalAgents() && !options?.includeInternal) {
      return null;
    }

    return {
      name: data.name,
      description: data.description,
      path: dirname(agentMdPath),
      rawContent: content,
      metadata: data.metadata,
    };
  } catch {
    return null;
  }
}

async function findAgentDirs(dir: string, depth = 0, maxDepth = 5): Promise<string[]> {
  if (depth > maxDepth) return [];

  try {
    const [hasAgent, entries] = await Promise.all([
      hasAgentMd(dir),
      readdir(dir, { withFileTypes: true }).catch(() => []),
    ]);

    const currentDir = hasAgent ? [dir] : [];

    // Search subdirectories in parallel
    const subDirResults = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory() && !SKIP_DIRS.includes(entry.name))
        .map((entry) => findAgentDirs(join(dir, entry.name), depth + 1, maxDepth))
    );

    return [...currentDir, ...subDirResults.flat()];
  } catch {
    return [];
  }
}

export interface DiscoverAgentsOptions {
  /** Include internal agents (e.g., when user explicitly requests a agent by name) */
  includeInternal?: boolean;
  /** Search all subdirectories even when a root AGENT.md exists */
  fullDepth?: boolean;
}

/**
 * Validates that a resolved subpath stays within the base directory.
 * Prevents path traversal attacks where subpath contains ".." segments
 * that would escape the cloned repository directory.
 */
export function isSubpathSafe(basePath: string, subpath: string): boolean {
  const normalizedBase = normalize(resolve(basePath));
  const normalizedTarget = normalize(resolve(join(basePath, subpath)));

  return normalizedTarget.startsWith(normalizedBase + sep) || normalizedTarget === normalizedBase;
}

export async function discoverAgents(
  basePath: string,
  subpath?: string,
  options?: DiscoverAgentsOptions
): Promise<Agent[]> {
  const agents: Agent[] = [];
  const seenNames = new Set<string>();

  // Validate subpath doesn't escape basePath (prevent path traversal)
  if (subpath && !isSubpathSafe(basePath, subpath)) {
    throw new Error(
      `Invalid subpath: "${subpath}" resolves outside the repository directory. Subpath must not contain ".." segments that escape the base path.`
    );
  }

  const searchPath = subpath ? join(basePath, subpath) : basePath;

  // Get plugin groupings to map agents to their parent plugin
  // We search for plugin definitions from the base search path
  const pluginGroupings = await getPluginGroupings(searchPath);

  // Helper to assign plugin name if available
  const enhanceAgent = (agent: Agent) => {
    const resolvedPath = resolve(agent.path);
    if (pluginGroupings.has(resolvedPath)) {
      agent.pluginName = pluginGroupings.get(resolvedPath);
    }
    return agent;
  };

  // If pointing directly at a agent, add it (and return early unless fullDepth is set)
  if (await hasAgentMd(searchPath)) {
    let agent = await parseAgentMd(join(searchPath, 'AGENT.md'), options);
    if (agent) {
      agent = enhanceAgent(agent);
      agents.push(agent);
      seenNames.add(agent.name);
      // Only return early if fullDepth is not set
      if (!options?.fullDepth) {
        return agents;
      }
    }
  }

  // Search common agent locations first
  const prioritySearchDirs = [
    searchPath,
    join(searchPath, 'agents'),
    join(searchPath, 'agents/.curated'),
    join(searchPath, 'agents/.experimental'),
    join(searchPath, 'agents/.system'),
    join(searchPath, '.agent/agents'),
    join(searchPath, '.agents/agents'),
    join(searchPath, '.claude/agents'),
    join(searchPath, '.cline/agents'),
    join(searchPath, '.codebuddy/agents'),
    join(searchPath, '.codex/agents'),
    join(searchPath, '.commandcode/agents'),
    join(searchPath, '.continue/agents'),

    join(searchPath, '.github/agents'),
    join(searchPath, '.goose/agents'),
    join(searchPath, '.iflow/agents'),
    join(searchPath, '.junie/agents'),
    join(searchPath, '.kilocode/agents'),
    join(searchPath, '.kiro/agents'),
    join(searchPath, '.mux/agents'),
    join(searchPath, '.neovate/agents'),
    join(searchPath, '.opencode/agents'),
    join(searchPath, '.openhands/agents'),
    join(searchPath, '.pi/agents'),
    join(searchPath, '.qoder/agents'),
    join(searchPath, '.roo/agents'),
    join(searchPath, '.trae/agents'),
    join(searchPath, '.windsurf/agents'),
    join(searchPath, '.zencoder/agents'),
  ];

  // Add agent paths declared in plugin manifests
  prioritySearchDirs.push(...(await getPluginAgentPaths(searchPath)));

  for (const dir of prioritySearchDirs) {
    try {
      const entries = await readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const agentDir = join(dir, entry.name);
          if (await hasAgentMd(agentDir)) {
            let agent = await parseAgentMd(join(agentDir, 'AGENT.md'), options);
            if (agent && !seenNames.has(agent.name)) {
              agent = enhanceAgent(agent);
              agents.push(agent);
              seenNames.add(agent.name);
            }
          }
        }
      }
    } catch {
      // Directory doesn't exist
    }
  }

  // Fall back to recursive search if nothing found, or if fullDepth is set
  if (agents.length === 0 || options?.fullDepth) {
    const allAgentDirs = await findAgentDirs(searchPath);

    for (const agentDir of allAgentDirs) {
      let agent = await parseAgentMd(join(agentDir, 'AGENT.md'), options);
      if (agent && !seenNames.has(agent.name)) {
        agent = enhanceAgent(agent);
        agents.push(agent);
        seenNames.add(agent.name);
      }
    }
  }

  return agents;
}

export function getAgentDisplayName(agent: Agent): string {
  return agent.name || basename(agent.path);
}

/**
 * Filter agents based on user input (case-insensitive direct matching).
 * Multi-word agent names must be quoted on the command line.
 */
export function filterAgents(agents: Agent[], inputNames: string[]): Agent[] {
  const normalizedInputs = inputNames.map((n) => n.toLowerCase());

  return agents.filter((agent) => {
    const name = agent.name.toLowerCase();
    const displayName = getAgentDisplayName(agent).toLowerCase();

    return normalizedInputs.some((input) => input === name || input === displayName);
  });
}
