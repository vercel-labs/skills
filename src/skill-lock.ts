import { readFile, writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { createHash } from 'crypto';
import { execSync } from 'child_process';

const AGENTS_DIR = '.agents';
const LOCK_FILE = '.skill-lock.json';
const CURRENT_VERSION = 3; // Bumped from 2 to 3 for folder hash support (GitHub tree SHA)

/**
 * Represents a single installed skill entry in the lock file.
 */
export interface SkillLockEntry {
  /** Normalized source identifier (e.g., "owner/repo", "mintlify/bun.com") */
  source: string;
  /** The provider/source type (e.g., "github", "mintlify", "huggingface", "local") */
  sourceType: string;
  /** The original URL used to install the skill (for re-fetching updates) */
  sourceUrl: string;
  /** Subpath within the source repo, if applicable */
  skillPath?: string;
  /** Namespace for organizing skills (optional) */
  namespace?: string;
  /**
   * GitHub tree SHA for the entire skill folder.
   * This hash changes when ANY file in the skill folder changes.
   * Fetched via GitHub Trees API by the telemetry server.
   */
  skillFolderHash: string;
  /** ISO timestamp when the skill was first installed */
  installedAt: string;
  /** ISO timestamp when the skill was last updated */
  updatedAt: string;
}

/**
 * Tracks dismissed prompts so they're not shown again.
 */
export interface DismissedPrompts {
  /** Dismissed the find-skills skill installation prompt */
  findSkillsPrompt?: boolean;
}

/** Skill lock key format: `scope:namespace:name` or `legacy:name` for backward compat */
export type SkillLockKey = `${string}:${string}`;

/** Parse a lock key into [scope, namespace, name] or null if invalid */
export function parseLockKey(key: string): [string?, string?, string?] | null {
  if (!key || key === '') return null;
  // Handle legacy format: just "name" -> [undefined, undefined, name]
  if (!key.includes(':')) return [undefined, undefined, key];
  // Handle scope:namespace:name format - split into max 3 parts
  const parts = key.split(':');
  if (parts.length === 2) return [parts[0], undefined, parts[1]];
  if (parts.length === 3) return [parts[0], parts[1], parts[2]];
  return null;
}

/** Build a lock key from scope, namespace, and name */
export function makeLockKey(
  scope: string | undefined,
  namespace: string | undefined,
  name: string
): SkillLockKey {
  const ns = namespace ?? 'legacy';
  if (scope) return `${scope}:${ns}:${name}`;
  return `${ns}:${name}`;
}

/**
 * Find all lock entries matching a given skill name, regardless of scope/namespace.
 * Returns array of [lockKey, entry] pairs.
 * Used by merge-with-namespace to find entries by name when keys are scope:namespace:name format.
 */
export function findSkillEntriesByName(
  skills: Record<SkillLockKey, SkillLockEntry>,
  name: string
): Array<[SkillLockKey, SkillLockEntry]> {
  const matches: Array<[SkillLockKey, SkillLockEntry]> = [];
  for (const [key, entry] of Object.entries(skills)) {
    const parsedKey = parseLockKey(key);
    if (parsedKey && parsedKey[2] === name) {
      matches.push([key as SkillLockKey, entry]);
    }
  }
  return matches;
}

/**
 * The structure of the skill lock file.
 */
export interface SkillLockFile {
  /** Schema version for future migrations */
  version: number;
  /** Map of lock key (scope:namespace:name) to its lock entry */
  skills: Record<SkillLockKey, SkillLockEntry>;
  /** Tracks dismissed prompts */
  dismissed?: DismissedPrompts;
  /** Last selected agents for installation */
  lastSelectedAgents?: string[];
}

/**
 * Get the path to the global skill lock file.
 * Located at ~/.agents/.skill-lock.json
 */
export function getSkillLockPath(): string {
  return join(homedir(), AGENTS_DIR, LOCK_FILE);
}

/**
 * Read the skill lock file.
 * Returns an empty lock file structure if the file doesn't exist.
 * Wipes the lock file if it's an old format (version < CURRENT_VERSION).
 */
export async function readSkillLock(): Promise<SkillLockFile> {
  const lockPath = getSkillLockPath();

  try {
    const content = await readFile(lockPath, 'utf-8');
    const parsed = JSON.parse(content) as SkillLockFile;

    // Validate version - wipe if old format
    if (typeof parsed.version !== 'number' || !parsed.skills) {
      return createEmptyLockFile();
    }

    // If old version, wipe and start fresh (backwards incompatible change)
    // v3 adds skillFolderHash - we want fresh installs to populate it
    if (parsed.version < CURRENT_VERSION) {
      return createEmptyLockFile();
    }

    // Auto-migrate old format keys (plain name -> legacy:name)
    // This handles the transition from flat lock entries to namespace-aware keys
    const migratedSkills: Record<SkillLockKey, SkillLockEntry> = {};
    let needsMigration = false;

    for (const [key, entry] of Object.entries(parsed.skills)) {
      const parsedKey = parseLockKey(key);
      if (parsedKey && parsedKey[0] === undefined && parsedKey[1] === undefined) {
        // Old format: just "name" -> migrate to "legacy:name"
        const newKey = makeLockKey(undefined, 'legacy', parsedKey[2]!);
        migratedSkills[newKey] = entry as SkillLockEntry;
        needsMigration = true;
      } else {
        migratedSkills[key as SkillLockKey] = entry as SkillLockEntry;
      }
    }

    if (needsMigration) {
      parsed.skills = migratedSkills;
      // Persist migration back to disk
      try {
        await writeSkillLock(parsed);
      } catch {
        // Best-effort migration; don't fail reads if write fails
      }
    }

    return parsed;
  } catch (error) {
    // File doesn't exist or is invalid - return empty
    return createEmptyLockFile();
  }
}

/**
 * Write the skill lock file.
 * Creates the directory if it doesn't exist.
 */
export async function writeSkillLock(lock: SkillLockFile): Promise<void> {
  const lockPath = getSkillLockPath();

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
 * Fetch the tree SHA (folder hash) for a skill folder using GitHub's Trees API.
 * This makes ONE API call to get the entire repo tree, then extracts the SHA
 * for the specific skill folder.
 *
 * @param ownerRepo - GitHub owner/repo (e.g., "vercel-labs/agent-skills")
 * @param skillPath - Path to skill folder or SKILL.md (e.g., "skills/react-best-practices/SKILL.md")
 * @param token - Optional GitHub token for authenticated requests (higher rate limits)
 * @returns The tree SHA for the skill folder, or null if not found
 */
export async function fetchSkillFolderHash(
  ownerRepo: string,
  skillPath: string,
  token?: string | null
): Promise<string | null> {
  // Normalize to forward slashes first (for GitHub API compatibility)
  let folderPath = skillPath.replace(/\\/g, '/');

  // Remove SKILL.md suffix to get folder path
  if (folderPath.endsWith('/SKILL.md')) {
    folderPath = folderPath.slice(0, -9);
  } else if (folderPath.endsWith('SKILL.md')) {
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
        'User-Agent': 'skills-cli',
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

      // If folderPath is empty, this is a root-level skill - use the root tree SHA
      if (!folderPath) {
        return data.sha;
      }

      // Find the tree entry for the skill folder
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
 * Add or update a skill entry in the lock file.
 * Uses scope:namespace:name as the lock key to prevent collisions.
 * Default scope is 'project'; pass 'global' for global installation.
 */
export async function addSkillToLock(
  skillName: string,
  entry: Omit<SkillLockEntry, 'installedAt' | 'updatedAt'>,
  scope: string = 'project'
): Promise<void> {
  const lock = await readSkillLock();
  const now = new Date().toISOString();

  const lockKey = makeLockKey(scope, entry.namespace, skillName);
  const existingEntry = lock.skills[lockKey];

  lock.skills[lockKey] = {
    ...entry,
    installedAt: existingEntry?.installedAt ?? now,
    updatedAt: now,
  };

  await writeSkillLock(lock);
}

/**
 * Remove a skill from the lock file.
 * Accepts either the full lock key (`scope:namespace:name`) or just the skill name.
 * When just a name is provided, it will look for any namespace match and remove the first one found.
 */
export async function removeSkillFromLock(skillName: string): Promise<boolean> {
  const lock = await readSkillLock();

  // Try exact match first
  if (skillName in lock.skills) {
    delete lock.skills[skillName as SkillLockKey];
    await writeSkillLock(lock);
    return true;
  }

  // Try to find a matching key by namespace:name pattern
  for (const key of Object.keys(lock.skills)) {
    const parsedKey = parseLockKey(key);
    if (parsedKey && parsedKey[2] === skillName) {
      delete lock.skills[key as SkillLockKey];
      await writeSkillLock(lock);
      return true;
    }
  }

  return false;
}

/**
 * Get a skill entry from the lock file.
 * Accepts either the full lock key (`scope:namespace:name`) or just the skill name.
 * When just a name is provided, returns the first matching entry found across all namespaces.
 */
export async function getSkillFromLock(skillName: string): Promise<SkillLockEntry | null> {
  const lock = await readSkillLock();

  // Try exact match first
  if (skillName in lock.skills) {
    return lock.skills[skillName as SkillLockKey] ?? null;
  }

  // Try to find a matching key by namespace:name pattern
  for (const [key, entry] of Object.entries(lock.skills)) {
    const parsedKey = parseLockKey(key);
    if (parsedKey && parsedKey[2] === skillName) {
      return entry ?? null;
    }
  }

  return null;
}

/**
 * Get all skills from the lock file.
 */
export async function getAllLockedSkills(): Promise<Record<string, SkillLockEntry>> {
  const lock = await readSkillLock();
  return lock.skills;
}

/**
 * Get skills grouped by source for batch update operations.
 */
export async function getSkillsBySource(): Promise<
  Map<string, { skills: string[]; entry: SkillLockEntry }>
> {
  const lock = await readSkillLock();
  const bySource = new Map<string, { skills: string[]; entry: SkillLockEntry }>();

  for (const [skillName, entry] of Object.entries(lock.skills)) {
    const existing = bySource.get(entry.source);
    if (existing) {
      existing.skills.push(skillName);
    } else {
      bySource.set(entry.source, { skills: [skillName], entry });
    }
  }

  return bySource;
}

/**
 * Create an empty lock file structure.
 */
function createEmptyLockFile(): SkillLockFile {
  return {
    version: CURRENT_VERSION,
    skills: {},
    dismissed: {},
  };
}

/**
 * Check if a prompt has been dismissed.
 */
export async function isPromptDismissed(promptKey: keyof DismissedPrompts): Promise<boolean> {
  const lock = await readSkillLock();
  return lock.dismissed?.[promptKey] === true;
}

/**
 * Mark a prompt as dismissed.
 */
export async function dismissPrompt(promptKey: keyof DismissedPrompts): Promise<void> {
  const lock = await readSkillLock();
  if (!lock.dismissed) {
    lock.dismissed = {};
  }
  lock.dismissed[promptKey] = true;
  await writeSkillLock(lock);
}

/**
 * Get the last selected agents.
 */
export async function getLastSelectedAgents(): Promise<string[] | undefined> {
  const lock = await readSkillLock();
  return lock.lastSelectedAgents;
}

/**
 * Save the selected agents to the lock file.
 */
export async function saveSelectedAgents(agents: string[]): Promise<void> {
  const lock = await readSkillLock();
  lock.lastSelectedAgents = agents;
  await writeSkillLock(lock);
}
