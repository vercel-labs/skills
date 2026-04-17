import { readFile, writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { createHash } from 'crypto';
import { execSync } from 'child_process';
import {
  createEmptyManagementState,
  getGroupsForSkill,
  normalizeManagementState,
  scrubSkillFromManagement,
  type ManagementState,
} from './management-state.ts';

const AGENTS_DIR = '.agents';
const LOCK_FILE = '.skill-lock.json';
const CURRENT_VERSION = 4; // Bumped from 3 to 4 for management metadata support

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
  /** Branch or tag ref used for installation (for ref-aware updates) */
  ref?: string;
  /** Subpath within the source repo, if applicable */
  skillPath?: string;
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
  /** Name of the plugin this skill belongs to (if any) */
  pluginName?: string;
}

/**
 * Tracks dismissed prompts so they're not shown again.
 */
export interface DismissedPrompts {
  /** Dismissed the find-skills skill installation prompt */
  findSkillsPrompt?: boolean;
}

/**
 * The structure of the skill lock file.
 */
export interface SkillLockFile {
  /** Schema version for future migrations */
  version: number;
  /** Map of skill name to its lock entry */
  skills: Record<string, SkillLockEntry>;
  /** Tracks dismissed prompts */
  dismissed?: DismissedPrompts;
  /** Last selected agents for installation */
  lastSelectedAgents?: string[];
  /** Scope-local management metadata */
  management: ManagementState;
}

/**
 * Get the path to the global skill lock file.
 * Use $XDG_STATE_HOME/skills/.skill-lock.json if set.
 * otherwise fall back to ~/.agents/.skill-lock.json
 */
export function getSkillLockPath(): string {
  const xdgStateHome = process.env.XDG_STATE_HOME;
  if (xdgStateHome) {
    return join(xdgStateHome, 'skills', LOCK_FILE);
  }
  return join(homedir(), AGENTS_DIR, LOCK_FILE);
}

/**
 * Read the skill lock file.
 * Returns an empty lock file structure if the file doesn't exist.
 * Migrates supported older versions forward and resets unsupported formats.
 */
export async function readSkillLock(): Promise<SkillLockFile> {
  const lockPath = getSkillLockPath();

  try {
    const content = await readFile(lockPath, 'utf-8');
    const parsed = JSON.parse(content) as {
      version?: unknown;
      skills?: unknown;
      dismissed?: unknown;
      lastSelectedAgents?: unknown;
      management?: unknown;
    };

    if (typeof parsed.version !== 'number' || !isRecord(parsed.skills)) {
      return createEmptyLockFile();
    }

    if (parsed.version === 3) {
      return {
        version: CURRENT_VERSION,
        skills: parsed.skills as Record<string, SkillLockEntry>,
        dismissed: normalizeDismissedPrompts(parsed.dismissed),
        lastSelectedAgents: normalizeLastSelectedAgents(parsed.lastSelectedAgents),
        management: createEmptyManagementState(),
      };
    }

    if (parsed.version !== CURRENT_VERSION) {
      return createEmptyLockFile();
    }

    return {
      version: CURRENT_VERSION,
      skills: parsed.skills as Record<string, SkillLockEntry>,
      dismissed: normalizeDismissedPrompts(parsed.dismissed),
      lastSelectedAgents: normalizeLastSelectedAgents(parsed.lastSelectedAgents),
      management: normalizeManagementState(parsed.management),
    };
  } catch {
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

  const sortedSkills: Record<string, SkillLockEntry> = {};
  for (const key of Object.keys(lock.skills).sort()) {
    sortedSkills[key] = lock.skills[key]!;
  }

  const normalized: SkillLockFile = {
    version: CURRENT_VERSION,
    skills: sortedSkills,
    dismissed: normalizeDismissedPrompts(lock.dismissed),
    management: normalizeManagementState(lock.management),
  };

  const lastSelectedAgents = normalizeLastSelectedAgents(lock.lastSelectedAgents);
  if (lastSelectedAgents) {
    normalized.lastSelectedAgents = lastSelectedAgents;
  }

  // Write with pretty formatting for human readability
  const content = JSON.stringify(normalized, null, 2);
  await writeFile(lockPath, content, 'utf-8');
}

export async function readGlobalManagementState(): Promise<ManagementState> {
  const lock = await readSkillLock();
  return lock.management;
}

export async function writeGlobalManagementState(management: ManagementState): Promise<void> {
  const lock = await readSkillLock();
  lock.management = normalizeManagementState(management);
  await writeSkillLock(lock);
}

export async function getGlobalSkillGroups(skillName: string): Promise<string[]> {
  const management = await readGlobalManagementState();
  return getGroupsForSkill(management, skillName);
}

export async function getGlobalManagerSkill(): Promise<string | undefined> {
  const management = await readGlobalManagementState();
  return management.managerSkill;
}

export async function scrubSkillFromGlobalManagement(skillName: string): Promise<void> {
  const lock = await readSkillLock();
  lock.management = scrubSkillFromManagement(lock.management, skillName);
  await writeSkillLock(lock);
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
 * @param ref - Optional branch/tag ref. Defaults to trying main then master.
 * @returns The tree SHA for the skill folder, or null if not found
 */
export async function fetchSkillFolderHash(
  ownerRepo: string,
  skillPath: string,
  token?: string | null,
  ref?: string
): Promise<string | null> {
  const { fetchRepoTree, getSkillFolderHashFromTree } = await import('./blob.ts');
  const tree = await fetchRepoTree(ownerRepo, ref, token);
  if (!tree) return null;
  return getSkillFolderHashFromTree(tree, skillPath);
}

/**
 * Add or update a skill entry in the lock file.
 */
export async function addSkillToLock(
  skillName: string,
  entry: Omit<SkillLockEntry, 'installedAt' | 'updatedAt'>
): Promise<void> {
  const lock = await readSkillLock();
  const now = new Date().toISOString();

  const existingEntry = lock.skills[skillName];

  lock.skills[skillName] = {
    ...entry,
    installedAt: existingEntry?.installedAt ?? now,
    updatedAt: now,
  };

  await writeSkillLock(lock);
}

/**
 * Remove a skill from the lock file.
 */
export async function removeSkillFromLock(skillName: string): Promise<boolean> {
  const lock = await readSkillLock();

  if (!(skillName in lock.skills)) {
    return false;
  }

  delete lock.skills[skillName];
  lock.management = scrubSkillFromManagement(lock.management, skillName);
  await writeSkillLock(lock);
  return true;
}

/**
 * Get a skill entry from the lock file.
 */
export async function getSkillFromLock(skillName: string): Promise<SkillLockEntry | null> {
  const lock = await readSkillLock();
  return lock.skills[skillName] ?? null;
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
    management: createEmptyManagementState(),
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

function normalizeDismissedPrompts(value: unknown): DismissedPrompts {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as DismissedPrompts;
  }
  return {};
}

function normalizeLastSelectedAgents(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const normalized = value.filter((item): item is string => typeof item === 'string');
  return normalized.length > 0 ? normalized : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
