import { readFile, writeFile, readdir, stat } from 'fs/promises';
import { join, relative } from 'path';
import { createHash } from 'crypto';

const LOCAL_LOCK_FILE = 'agents-lock.json';
const CURRENT_VERSION = 1;

/**
 * Represents a single agent entry in the local (project) lock file.
 *
 * Intentionally minimal and timestamp-free to minimize merge conflicts.
 * Two branches adding different agents produce non-overlapping JSON keys
 * that git can auto-merge cleanly.
 */
export interface LocalAgentLockEntry {
  /** Where the agent came from: npm package name, owner/repo, local path, etc. */
  source: string;
  /** The provider/source type (e.g., "github", "node_modules", "local") */
  sourceType: string;
  /**
   * SHA-256 hash computed from all files in the agent folder.
   * Unlike the global lock which uses GitHub tree SHA, the local lock
   * computes the hash from actual file contents on disk.
   */
  computedHash: string;
}

/**
 * The structure of the local (project-scoped) agent lock file.
 * This file is meant to be checked into version control.
 *
 * Agents are sorted alphabetically by name when written to produce
 * deterministic output and minimize merge conflicts.
 */
export interface LocalAgentLockFile {
  /** Schema version for future migrations */
  version: number;
  /** Map of agent name to its lock entry (sorted alphabetically) */
  agents: Record<string, LocalAgentLockEntry>;
}

/**
 * Get the path to the local agent lock file for a project.
 */
export function getLocalLockPath(cwd?: string): string {
  return join(cwd || process.cwd(), LOCAL_LOCK_FILE);
}

/**
 * Read the local agent lock file.
 * Returns an empty lock file structure if the file doesn't exist
 * or is corrupted (e.g., merge conflict markers).
 */
export async function readLocalLock(cwd?: string): Promise<LocalAgentLockFile> {
  const lockPath = getLocalLockPath(cwd);

  try {
    const content = await readFile(lockPath, 'utf-8');
    const parsed = JSON.parse(content) as LocalAgentLockFile;

    if (typeof parsed.version !== 'number' || !parsed.agents) {
      return createEmptyLocalLock();
    }

    if (parsed.version < CURRENT_VERSION) {
      return createEmptyLocalLock();
    }

    return parsed;
  } catch {
    return createEmptyLocalLock();
  }
}

/**
 * Write the local agent lock file.
 * Agents are sorted alphabetically by name for deterministic output.
 */
export async function writeLocalLock(lock: LocalAgentLockFile, cwd?: string): Promise<void> {
  const lockPath = getLocalLockPath(cwd);

  // Sort agents alphabetically for deterministic output / clean diffs
  const sortedAgents: Record<string, LocalAgentLockEntry> = {};
  for (const key of Object.keys(lock.agents).sort()) {
    sortedAgents[key] = lock.agents[key]!;
  }

  const sorted: LocalAgentLockFile = { version: lock.version, agents: sortedAgents };
  const content = JSON.stringify(sorted, null, 2) + '\n';
  await writeFile(lockPath, content, 'utf-8');
}

/**
 * Compute a SHA-256 hash from all files in a agent directory.
 * Reads all files recursively, sorts them by relative path for determinism,
 * and produces a single hash from their concatenated contents.
 */
export async function computeAgentFolderHash(agentDir: string): Promise<string> {
  const files: Array<{ relativePath: string; content: Buffer }> = [];
  await collectFiles(agentDir, agentDir, files);

  // Sort by relative path for deterministic hashing
  files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));

  const hash = createHash('sha256');
  for (const file of files) {
    // Include the path in the hash so renames are detected
    hash.update(file.relativePath);
    hash.update(file.content);
  }

  return hash.digest('hex');
}

async function collectFiles(
  baseDir: string,
  currentDir: string,
  results: Array<{ relativePath: string; content: Buffer }>
): Promise<void> {
  const entries = await readdir(currentDir, { withFileTypes: true });

  await Promise.all(
    entries.map(async (entry) => {
      const fullPath = join(currentDir, entry.name);

      if (entry.isDirectory()) {
        // Skip .git and node_modules within agent dirs
        if (entry.name === '.git' || entry.name === 'node_modules') return;
        await collectFiles(baseDir, fullPath, results);
      } else if (entry.isFile()) {
        const content = await readFile(fullPath);
        const relativePath = relative(baseDir, fullPath).split('\\').join('/');
        results.push({ relativePath, content });
      }
    })
  );
}

/**
 * Add or update a agent entry in the local lock file.
 */
export async function addAgentToLocalLock(
  agentName: string,
  entry: LocalAgentLockEntry,
  cwd?: string
): Promise<void> {
  const lock = await readLocalLock(cwd);
  lock.agents[agentName] = entry;
  await writeLocalLock(lock, cwd);
}

/**
 * Remove a agent from the local lock file.
 */
export async function removeAgentFromLocalLock(agentName: string, cwd?: string): Promise<boolean> {
  const lock = await readLocalLock(cwd);

  if (!(agentName in lock.agents)) {
    return false;
  }

  delete lock.agents[agentName];
  await writeLocalLock(lock, cwd);
  return true;
}

function createEmptyLocalLock(): LocalAgentLockFile {
  return {
    version: CURRENT_VERSION,
    agents: {},
  };
}
