import { access, mkdir, open, readFile, rename, stat, unlink } from 'fs/promises';
import { constants } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { createHash, randomBytes } from 'crypto';

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
  /** Branch or tag ref used for installation (for ref-aware updates) */
  ref?: string;
  /** Git commit the skill was installed from; `update` moves it forward. Unset for non-Git sources. */
  commit?: string;
  /** Subpath within the source repo, if applicable */
  skillPath?: string;
  /**
   * Name of the skill in its source, when it is installed under another name
   * (`add --rename`); the lock key is the installed name. Omitted otherwise.
   */
  skillName?: string;
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
  sourceBaseUrl?: string;
  wellKnownDigest?: string;
  /** Set when the user chose copies over symlinks, so `update` reinstalls copies. */
  installMode?: 'copy';
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
 * Only a missing file is empty: invalid JSON must not erase installation
 * metadata on the next add, update, remove, or agent-picker write.
 * Legacy schema migration is handled separately.
 */
export async function readSkillLock(): Promise<SkillLockFile> {
  const lockPath = getSkillLockPath();
  let content: string;
  try {
    content = await readFile(lockPath, 'utf-8');
  } catch (error) {
    if (isNodeErrorCode(error, 'ENOENT')) return createEmptyLockFile();
    throw error;
  }

  let parsed: SkillLockFile;
  try {
    parsed = JSON.parse(content) as SkillLockFile;
  } catch (error) {
    throw new Error(
      `Invalid global skill lock at ${lockPath}: malformed JSON. Restore or repair the file before retrying.`,
      { cause: error }
    );
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`Invalid global skill lock at ${lockPath}: expected a JSON object.`);
  }

  // Preserve existing legacy-format semantics; migration is tracked separately.
  if (typeof parsed.version !== 'number' || !parsed.skills) {
    return createEmptyLockFile();
  }
  if (parsed.version < CURRENT_VERSION) {
    return createEmptyLockFile();
  }
  return parsed;
}

function isNodeErrorCode(error: unknown, ...codes: string[]): boolean {
  return error instanceof Error && 'code' in error && codes.includes(String(error.code));
}

/**
 * Write a complete replacement beside the existing lock, then rename it.
 * A failed or interrupted write must not leave the active JSON truncated.
 */
export async function writeSkillLock(lock: SkillLockFile): Promise<void> {
  const lockPath = getSkillLockPath();
  await mkdir(dirname(lockPath), { recursive: true });

  // Do not bypass an existing read-only file via directory rename permissions.
  let existing;
  try {
    await access(lockPath, constants.W_OK);
    if (process.platform !== 'win32') existing = await stat(lockPath);
  } catch (error) {
    if (!isNodeErrorCode(error, 'ENOENT')) throw error;
  }

  const content = JSON.stringify(lock, null, 2);
  const tempPath = `${lockPath}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  const temp = await open(tempPath, 'wx', 0o600);
  try {
    try {
      await temp.writeFile(content, 'utf-8');
      if (existing) {
        // Permission bits must continue to refer to the same owner and group.
        const created = await temp.stat();
        if (created.uid !== existing.uid || created.gid !== existing.gid) {
          await temp.chown(existing.uid, existing.gid);
        }
        await temp.chmod(existing.mode & 0o777);
      }
    } finally {
      await temp.close();
    }

    const maxAttempts = process.platform === 'win32' ? 5 : 1;
    for (let attempt = 1; ; attempt++) {
      try {
        await rename(tempPath, lockPath);
        break;
      } catch (error) {
        if (attempt < maxAttempts && isNodeErrorCode(error, 'EPERM', 'EBUSY')) {
          await new Promise((resolve) => setTimeout(resolve, attempt * 15));
          continue;
        }
        throw error;
      }
    }
  } catch (error) {
    await unlink(tempPath).catch(() => {});
    throw error;
  }
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
 *
 * Stored credentials are deliberately not extracted from the GitHub CLI.
 * When no explicit API token is configured, callers can fall back to a normal
 * Git clone, which uses the user's existing Git credential helper or SSH setup.
 *
 * @returns The token string or null if not available
 */
export function getGitHubToken(): string | null {
  if (process.env.GITHUB_TOKEN) {
    return process.env.GITHUB_TOKEN;
  }
  if (process.env.GH_TOKEN) {
    return process.env.GH_TOKEN;
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
 * @param getToken - Optional lazy token resolver. Invoked only if the
 *                   unauthenticated request needs authentication.
 * @param ref - Optional branch/tag ref. Defaults to trying main then master.
 * @returns The tree SHA for the skill folder, or null if not found
 */
export async function fetchSkillFolderHash(
  ownerRepo: string,
  skillPath: string,
  getToken?: (() => string | null) | null,
  ref?: string
): Promise<string | null> {
  const { fetchRepoTree, getSkillFolderHashFromTree } = await import('./blob.ts');
  const tree = await fetchRepoTree(ownerRepo, ref, getToken ?? undefined);
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
