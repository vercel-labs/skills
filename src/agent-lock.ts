import { readFile, writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { createHash } from 'crypto';
import { execSync } from 'child_process';

const AGENTS_DIR = '.agents';
const LOCK_FILE = '.agent-lock.json';
const CURRENT_VERSION = 3; // Bumped from 2 to 3 for folder hash support (GitHub tree SHA)

/**
 * Represents a single installed agent entry in the lock file.
 */
export interface AgentLockEntry {
  /** Normalized source identifier (e.g., "owner/repo", "mintlify/bun.com") */
  source: string;
  /** The provider/source type (e.g., "github", "mintlify", "huggingface", "local") */
  sourceType: string;
  /** The original URL used to install the agent (for re-fetching updates) */
  sourceUrl: string;
  /** Subpath within the source repo, if applicable */
  agentPath?: string;
  /**
   * GitHub tree SHA for the entire agent folder.
   * This hash changes when ANY file in the agent folder changes.
   * Fetched via GitHub Trees API by the telemetry server.
   */
  agentFolderHash: string;
  /** ISO timestamp when the agent was first installed */
  installedAt: string;
  /** ISO timestamp when the agent was last updated */
  updatedAt: string;
  /** Name of the plugin this agent belongs to (if any) */
  pluginName?: string;
}

/**
 * Tracks dismissed prompts so they're not shown again.
 */
export interface DismissedPrompts {
  /** Dismissed the find-agents agent installation prompt */
  findAgentsPrompt?: boolean;
}

/**
 * The structure of the agent lock file.
 */
export interface AgentLockFile {
  /** Schema version for future migrations */
  version: number;
  /** Map of agent name to its lock entry */
  agents: Record<string, AgentLockEntry>;
  /** Tracks dismissed prompts */
  dismissed?: DismissedPrompts;
  /** Last selected agents for installation */
  lastSelectedTargets?: string[];
}

/**
 * Get the path to the global agent lock file.
 * Use $XDG_STATE_HOME/agents/.agent-lock.json if set.
 * otherwise fall back to ~/.agents/.agent-lock.json
 */
export function getAgentLockPath(): string {
  const xdgStateHome = process.env.XDG_STATE_HOME;
  if (xdgStateHome) {
    return join(xdgStateHome, 'agents', LOCK_FILE);
  }
  return join(homedir(), AGENTS_DIR, LOCK_FILE);
}

/**
 * Read the agent lock file.
 * Returns an empty lock file structure if the file doesn't exist.
 * Wipes the lock file if it's an old format (version < CURRENT_VERSION).
 */
export async function readAgentLock(): Promise<AgentLockFile> {
  const lockPath = getAgentLockPath();

  try {
    const content = await readFile(lockPath, 'utf-8');
    const parsed = JSON.parse(content) as AgentLockFile;

    // Validate version - wipe if old format
    if (typeof parsed.version !== 'number' || !parsed.agents) {
      return createEmptyLockFile();
    }

    // If old version, wipe and start fresh (backwards incompatible change)
    // v3 adds agentFolderHash - we want fresh installs to populate it
    if (parsed.version < CURRENT_VERSION) {
      return createEmptyLockFile();
    }

    return parsed;
  } catch (error) {
    // File doesn't exist or is invalid - return empty
    return createEmptyLockFile();
  }
}

/**
 * Write the agent lock file.
 * Creates the directory if it doesn't exist.
 */
export async function writeAgentLock(lock: AgentLockFile): Promise<void> {
  const lockPath = getAgentLockPath();

  // Ensure directory exists
  await mkdir(dirname(lockPath), { recursive: true });

  // Write with pretty formatting for human readability
  const content = JSON.stringify(lock, null, 2);
  await writeFile(lockPath, content, 'utf-8');
}

/**
 * Compute SHA-256 hash of content.
 */
export function computeContentHash(content: string): string {
  return createHash('sha256').update(content, 'utf-8').digest('hex');
}

/**
 * Get GitHub token from user's environment.
 * Tries in order:
 * 1. GITHUB_TOKEN environment variable
 * 2. GH_TOKEN environment variable
 * 3. gh CLI auth token (if gh is installed)
 *
 * @returns The token string or null if not available
 */
export function getGitHubToken(): string | null {
  // Check environment variables first
  if (process.env.GITHUB_TOKEN) {
    return process.env.GITHUB_TOKEN;
  }
  if (process.env.GH_TOKEN) {
    return process.env.GH_TOKEN;
  }

  // Try gh CLI
  try {
    const token = execSync('gh auth token', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    if (token) {
      return token;
    }
  } catch {
    // gh not installed or not authenticated
  }

  return null;
}

/**
 * Fetch the tree SHA (folder hash) for a agent folder using GitHub's Trees API.
 * This makes ONE API call to get the entire repo tree, then extracts the SHA
 * for the specific agent folder.
 *
 * @param ownerRepo - GitHub owner/repo (e.g., "vercel-labs/agent-agents")
 * @param agentPath - Path to agent folder or AGENT.md (e.g., "agents/react-best-practices/AGENT.md")
 * @param token - Optional GitHub token for authenticated requests (higher rate limits)
 * @returns The tree SHA for the agent folder, or null if not found
 */
export async function fetchAgentFolderHash(
  ownerRepo: string,
  agentPath: string,
  token?: string | null
): Promise<string | null> {
  // Normalize to forward slashes first (for GitHub API compatibility)
  let folderPath = agentPath.replace(/\\/g, '/');

  // Remove AGENT.md suffix to get folder path
  if (folderPath.endsWith('/AGENT.md')) {
    folderPath = folderPath.slice(0, -9);
  } else if (folderPath.endsWith('AGENT.md')) {
    folderPath = folderPath.slice(0, -8);
  }

  // Remove trailing slash
  if (folderPath.endsWith('/')) {
    folderPath = folderPath.slice(0, -1);
  }

  const branches = ['main', 'master'];

  for (const branch of branches) {
    try {
      const url = `https://api.github.com/repos/${ownerRepo}/git/trees/${branch}?recursive=1`;
      const headers: Record<string, string> = {
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'agents-cli',
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const response = await fetch(url, { headers });

      if (!response.ok) continue;

      const data = (await response.json()) as {
        sha: string;
        tree: Array<{ path: string; type: string; sha: string }>;
      };

      // If folderPath is empty, this is a root-level agent - use the root tree SHA
      if (!folderPath) {
        return data.sha;
      }

      // Find the tree entry for the agent folder
      const folderEntry = data.tree.find(
        (entry) => entry.type === 'tree' && entry.path === folderPath
      );

      if (folderEntry) {
        return folderEntry.sha;
      }
    } catch {
      continue;
    }
  }

  return null;
}

/**
 * Add or update a agent entry in the lock file.
 */
export async function addAgentToLock(
  agentName: string,
  entry: Omit<AgentLockEntry, 'installedAt' | 'updatedAt'>
): Promise<void> {
  const lock = await readAgentLock();
  const now = new Date().toISOString();

  const existingEntry = lock.agents[agentName];

  lock.agents[agentName] = {
    ...entry,
    installedAt: existingEntry?.installedAt ?? now,
    updatedAt: now,
  };

  await writeAgentLock(lock);
}

/**
 * Remove a agent from the lock file.
 */
export async function removeAgentFromLock(agentName: string): Promise<boolean> {
  const lock = await readAgentLock();

  if (!(agentName in lock.agents)) {
    return false;
  }

  delete lock.agents[agentName];
  await writeAgentLock(lock);
  return true;
}

/**
 * Get a agent entry from the lock file.
 */
export async function getAgentFromLock(agentName: string): Promise<AgentLockEntry | null> {
  const lock = await readAgentLock();
  return lock.agents[agentName] ?? null;
}

/**
 * Get all agents from the lock file.
 */
export async function getAllLockedAgents(): Promise<Record<string, AgentLockEntry>> {
  const lock = await readAgentLock();
  return lock.agents;
}

/**
 * Get agents grouped by source for batch update operations.
 */
export async function getAgentsBySource(): Promise<
  Map<string, { agents: string[]; entry: AgentLockEntry }>
> {
  const lock = await readAgentLock();
  const bySource = new Map<string, { agents: string[]; entry: AgentLockEntry }>();

  for (const [agentName, entry] of Object.entries(lock.agents)) {
    const existing = bySource.get(entry.source);
    if (existing) {
      existing.agents.push(agentName);
    } else {
      bySource.set(entry.source, { agents: [agentName], entry });
    }
  }

  return bySource;
}

/**
 * Create an empty lock file structure.
 */
function createEmptyLockFile(): AgentLockFile {
  return {
    version: CURRENT_VERSION,
    agents: {},
    dismissed: {},
  };
}

/**
 * Check if a prompt has been dismissed.
 */
export async function isPromptDismissed(promptKey: keyof DismissedPrompts): Promise<boolean> {
  const lock = await readAgentLock();
  return lock.dismissed?.[promptKey] === true;
}

/**
 * Mark a prompt as dismissed.
 */
export async function dismissPrompt(promptKey: keyof DismissedPrompts): Promise<void> {
  const lock = await readAgentLock();
  if (!lock.dismissed) {
    lock.dismissed = {};
  }
  lock.dismissed[promptKey] = true;
  await writeAgentLock(lock);
}

/**
 * Get the last selected agents.
 */
export async function getLastSelectedTargets(): Promise<string[] | undefined> {
  const lock = await readAgentLock();
  return lock.lastSelectedTargets;
}

/**
 * Save the selected agents to the lock file.
 */
export async function saveSelectedTargets(agents: string[]): Promise<void> {
  const lock = await readAgentLock();
  lock.lastSelectedTargets = agents;
  await writeAgentLock(lock);
}
