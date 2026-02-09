import { readFile, writeFile, mkdir, rename, stat } from 'fs/promises';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { createHash } from 'crypto';
import { execSync } from 'child_process';
import type { CognitiveType } from '../../core/types.ts';
import { COGNITIVE_FILE_NAMES } from '../../core/types.ts';

const AGENTS_DIR = '.agents';
const LOCK_FILE = '.cognit-lock.json';
const OLD_LOCK_FILES = ['.synk-lock.json', '.skill-lock.json'];
const CURRENT_VERSION = 4; // Bumped from 3 to 4 for cognitiveType support

/**
 * Represents a single installed cognitive entry in the lock file.
 */
export interface CognitiveLockEntry {
  /** Normalized source identifier (e.g., "owner/repo", "mintlify/bun.com") */
  source: string;
  /** The provider/source type (e.g., "github", "mintlify", "huggingface", "local") */
  sourceType: string;
  /** The original URL used to install the cognitive (for re-fetching updates) */
  sourceUrl: string;
  /** Subpath within the source repo, if applicable */
  cognitivePath?: string;
  /**
   * GitHub tree SHA for the entire cognitive folder.
   * This hash changes when ANY file in the cognitive folder changes.
   * Fetched via GitHub Trees API by the telemetry server.
   */
  cognitiveFolderHash: string;
  /** ISO timestamp when the cognitive was first installed */
  installedAt: string;
  /** ISO timestamp when the cognitive was last updated */
  updatedAt: string;
  /** The cognitive type of this entry. Defaults to 'skill' when absent. */
  cognitiveType?: CognitiveType;
}

/** @deprecated Use CognitiveLockEntry */
export type SkillLockEntry = CognitiveLockEntry;

/**
 * Tracks dismissed prompts so they're not shown again.
 */
export interface DismissedPrompts {
  /** Dismissed the find-skills skill installation prompt */
  findSkillsPrompt?: boolean;
}

/**
 * The structure of the lock file.
 */
export interface CognitiveLockFile {
  /** Schema version for future migrations */
  version: number;
  /** Map of cognitive name to its lock entry */
  cognitives: Record<string, CognitiveLockEntry>;
  /** Tracks dismissed prompts */
  dismissed?: DismissedPrompts;
  /** Last selected agents for installation */
  lastSelectedAgents?: string[];
}

/** @deprecated Use CognitiveLockFile */
export type SkillLockFile = CognitiveLockFile;

/**
 * Get the path to the global lock file.
 * Located at ~/.agents/.cognit-lock.json
 */
export function getLockFilePath(): string {
  return join(homedir(), AGENTS_DIR, LOCK_FILE);
}

/** @deprecated Use getLockFilePath */
export const getSkillLockPath = getLockFilePath;

/**
 * Migrate old .skill-lock.json or .synk-lock.json to .cognit-lock.json if needed.
 */
async function migrateLockFileIfNeeded(): Promise<void> {
  const newPath = join(homedir(), AGENTS_DIR, LOCK_FILE);

  try {
    await stat(newPath);
    // New file already exists, no migration needed
    return;
  } catch {
    // New file doesn't exist, check for old files
  }

  for (const oldFile of OLD_LOCK_FILES) {
    const oldPath = join(homedir(), AGENTS_DIR, oldFile);
    try {
      await stat(oldPath);
      // Old file exists, rename it
      await rename(oldPath, newPath);
      return;
    } catch {
      // Old file doesn't exist, try next
    }
  }
}

/**
 * Read the lock file.
 * Returns an empty lock file structure if the file doesn't exist.
 * Wipes the lock file if it's an old format (version < CURRENT_VERSION).
 * Handles migration from old .skill-lock.json and old field names.
 */
export async function readLockFile(): Promise<CognitiveLockFile> {
  await migrateLockFileIfNeeded();
  const lockPath = getLockFilePath();

  try {
    const content = await readFile(lockPath, 'utf-8');
    const parsed = JSON.parse(content) as Record<string, unknown>;

    // Validate version
    if (typeof parsed.version !== 'number') {
      return createEmptyLockFile();
    }

    // If old version, wipe and start fresh (backwards incompatible change)
    if ((parsed.version as number) < CURRENT_VERSION) {
      return createEmptyLockFile();
    }

    // Migration: accept old 'skills' key if 'cognitives' is absent
    const cognitives = (parsed.cognitives ?? parsed.skills ?? {}) as Record<
      string,
      Record<string, unknown>
    >;

    // Migrate individual entry fields: skillPath -> cognitivePath, skillFolderHash -> cognitiveFolderHash
    const migratedCognitives: Record<string, CognitiveLockEntry> = {};
    for (const [name, entry] of Object.entries(cognitives)) {
      migratedCognitives[name] = {
        source: entry.source as string,
        sourceType: entry.sourceType as string,
        sourceUrl: entry.sourceUrl as string,
        cognitivePath: (entry.cognitivePath ?? entry.skillPath) as string | undefined,
        cognitiveFolderHash: (entry.cognitiveFolderHash ?? entry.skillFolderHash) as string,
        installedAt: entry.installedAt as string,
        updatedAt: entry.updatedAt as string,
        cognitiveType: entry.cognitiveType as CognitiveType | undefined,
      };
    }

    return {
      version: parsed.version as number,
      cognitives: migratedCognitives,
      dismissed: parsed.dismissed as DismissedPrompts | undefined,
      lastSelectedAgents: parsed.lastSelectedAgents as string[] | undefined,
    };
  } catch (error) {
    // File doesn't exist or is invalid - return empty
    return createEmptyLockFile();
  }
}

/** @deprecated Use readLockFile */
export const readSkillLock = readLockFile;

/**
 * Write the lock file.
 * Creates the directory if it doesn't exist.
 */
export async function writeLockFile(lock: CognitiveLockFile): Promise<void> {
  const lockPath = getLockFilePath();

  // Ensure directory exists
  await mkdir(dirname(lockPath), { recursive: true });

  // Write with pretty formatting for human readability
  const content = JSON.stringify(lock, null, 2);
  await writeFile(lockPath, content, 'utf-8');
}

/** @deprecated Use writeLockFile */
export const writeSkillLock = writeLockFile;

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
 * Fetch the tree SHA (folder hash) for a cognitive folder using GitHub's Trees API.
 * This makes ONE API call to get the entire repo tree, then extracts the SHA
 * for the specific cognitive folder.
 *
 * @param ownerRepo - GitHub owner/repo (e.g., "vercel-labs/agent-skills")
 * @param cognitivePath - Path to cognitive folder or file (e.g., "skills/react-best-practices/SKILL.md")
 * @param token - Optional GitHub token for authenticated requests (higher rate limits)
 * @returns The tree SHA for the cognitive folder, or null if not found
 */
export async function fetchCognitiveFolderHash(
  ownerRepo: string,
  cognitivePath: string,
  token?: string | null
): Promise<string | null> {
  // Normalize to forward slashes first (for GitHub API compatibility)
  let folderPath = cognitivePath.replace(/\\/g, '/');

  // Remove cognitive file name suffix to get folder path
  for (const fileName of Object.values(COGNITIVE_FILE_NAMES)) {
    if (folderPath.endsWith('/' + fileName)) {
      folderPath = folderPath.slice(0, -(fileName.length + 1));
      break;
    } else if (folderPath.endsWith(fileName)) {
      folderPath = folderPath.slice(0, -fileName.length);
      break;
    }
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
        'User-Agent': 'cognit-cli',
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

      // If folderPath is empty, this is a root-level cognitive - use the root tree SHA
      if (!folderPath) {
        return data.sha;
      }

      // Find the tree entry for the cognitive folder
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

/** @deprecated Use fetchCognitiveFolderHash */
export const fetchSkillFolderHash = fetchCognitiveFolderHash;

/**
 * Add or update a cognitive entry in the lock file with an explicit cognitive type.
 */
export async function addCognitiveToLock(
  name: string,
  cognitiveType: CognitiveType,
  entry: Omit<CognitiveLockEntry, 'installedAt' | 'updatedAt' | 'cognitiveType'>
): Promise<void> {
  const lock = await readLockFile();
  const now = new Date().toISOString();

  const existingEntry = lock.cognitives[name];

  lock.cognitives[name] = {
    ...entry,
    cognitiveType,
    installedAt: existingEntry?.installedAt ?? now,
    updatedAt: now,
  };

  await writeLockFile(lock);
}

/**
 * Add or update a skill entry in the lock file.
 * Convenience wrapper around addCognitiveToLock with cognitiveType 'skill'.
 */
export async function addSkillToLock(
  skillName: string,
  entry: Omit<CognitiveLockEntry, 'installedAt' | 'updatedAt' | 'cognitiveType'>
): Promise<void> {
  return addCognitiveToLock(skillName, 'skill', entry);
}

/**
 * Remove a cognitive from the lock file.
 */
export async function removeCognitiveFromLock(name: string): Promise<boolean> {
  const lock = await readLockFile();

  if (!(name in lock.cognitives)) {
    return false;
  }

  delete lock.cognitives[name];
  await writeLockFile(lock);
  return true;
}

/** @deprecated Use removeCognitiveFromLock */
export const removeSkillFromLock = removeCognitiveFromLock;

/**
 * Get a cognitive entry from the lock file.
 */
export async function getCognitiveFromLock(name: string): Promise<CognitiveLockEntry | null> {
  const lock = await readLockFile();
  return lock.cognitives[name] ?? null;
}

/** @deprecated Use getCognitiveFromLock */
export const getSkillFromLock = getCognitiveFromLock;

/**
 * Get all cognitives from the lock file.
 */
export async function getAllLockedCognitives(): Promise<Record<string, CognitiveLockEntry>> {
  const lock = await readLockFile();
  return lock.cognitives;
}

/** @deprecated Use getAllLockedCognitives */
export const getAllLockedSkills = getAllLockedCognitives;

/**
 * Get cognitives grouped by source for batch update operations.
 */
export async function getCognitivesBySource(): Promise<
  Map<string, { skills: string[]; entry: CognitiveLockEntry }>
> {
  const lock = await readLockFile();
  const bySource = new Map<string, { skills: string[]; entry: CognitiveLockEntry }>();

  for (const [name, entry] of Object.entries(lock.cognitives)) {
    const existing = bySource.get(entry.source);
    if (existing) {
      existing.skills.push(name);
    } else {
      bySource.set(entry.source, { skills: [name], entry });
    }
  }

  return bySource;
}

/** @deprecated Use getCognitivesBySource */
export const getSkillsBySource = getCognitivesBySource;

/**
 * Create an empty lock file structure.
 */
function createEmptyLockFile(): CognitiveLockFile {
  return {
    version: CURRENT_VERSION,
    cognitives: {},
    dismissed: {},
  };
}

/**
 * Check if a prompt has been dismissed.
 */
export async function isPromptDismissed(promptKey: keyof DismissedPrompts): Promise<boolean> {
  const lock = await readLockFile();
  return lock.dismissed?.[promptKey] === true;
}

/**
 * Mark a prompt as dismissed.
 */
export async function dismissPrompt(promptKey: keyof DismissedPrompts): Promise<void> {
  const lock = await readLockFile();
  if (!lock.dismissed) {
    lock.dismissed = {};
  }
  lock.dismissed[promptKey] = true;
  await writeLockFile(lock);
}

/**
 * Get the last selected agents.
 */
export async function getLastSelectedAgents(): Promise<string[] | undefined> {
  const lock = await readLockFile();
  return lock.lastSelectedAgents;
}

/**
 * Save the selected agents to the lock file.
 */
export async function saveSelectedAgents(agents: string[]): Promise<void> {
  const lock = await readLockFile();
  lock.lastSelectedAgents = agents;
  await writeLockFile(lock);
}
