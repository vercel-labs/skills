import { readFile, writeFile, readdir, stat } from 'fs/promises';
import { join, relative } from 'path';
import { createHash } from 'crypto';

const LOCAL_LOCK_FILE = 'skills-lock.json';
const CURRENT_VERSION = 1;
const CONFLICT_START_MARKER = /^<{7}( |$)/m;

/**
 * Represents a single skill entry in the local (project) lock file.
 *
 * Intentionally minimal and timestamp-free to minimize merge conflicts.
 * Two branches adding different skills produce non-overlapping JSON keys
 * that git can auto-merge cleanly.
 */
export interface LocalSkillLockEntry {
  /** Where the skill came from: npm package name, owner/repo, local path, etc. */
  source: string;
  /** Branch or tag ref used for installation */
  ref?: string;
  /** The provider/source type (e.g., "github", "node_modules", "local") */
  sourceType: string;
  /**
   * SHA-256 hash computed from all files in the skill folder.
   * Unlike the global lock which uses GitHub tree SHA, the local lock
   * computes the hash from actual file contents on disk.
   */
  computedHash: string;
}

/**
 * The structure of the local (project-scoped) skill lock file.
 * This file is meant to be checked into version control.
 *
 * Skills are sorted alphabetically by name when written to produce
 * deterministic output and minimize merge conflicts.
 */
export interface LocalSkillLockFile {
  /** Schema version for future migrations */
  version: number;
  /** Map of skill name to its lock entry (sorted alphabetically) */
  skills: Record<string, LocalSkillLockEntry>;
}

/**
 * Get the path to the local skill lock file for a project.
 */
export function getLocalLockPath(cwd?: string): string {
  return join(cwd || process.cwd(), LOCAL_LOCK_FILE);
}

/**
 * Read the local skill lock file.
 *
 * If the file contains git merge conflict markers (`<<<<<<<`, `=======`,
 * `>>>>>>>`), each side is parsed independently and the `skills` maps are
 * unioned — the "theirs" side wins on key collision. This mirrors the way
 * `yarn install` heals `yarn.lock` conflicts, which is safe here because the
 * lock format is intentionally timestamp-free and alphabetically sorted, so
 * two branches adding different skills only ever conflict on JSON syntax.
 *
 * Returns an empty lock file structure if the file doesn't exist or cannot
 * be parsed even after conflict resolution.
 */
export async function readLocalLock(cwd?: string): Promise<LocalSkillLockFile> {
  const lockPath = getLocalLockPath(cwd);

  let content: string;
  try {
    content = await readFile(lockPath, 'utf-8');
  } catch {
    return createEmptyLocalLock();
  }

  const parsed = parseLocalLockContent(content);
  if (!parsed) return createEmptyLocalLock();
  if (parsed.version < CURRENT_VERSION) return createEmptyLocalLock();
  return parsed;
}

/**
 * Parse lock file text, auto-resolving git merge conflict markers if present.
 * Returns null if the content cannot be parsed into a valid lock structure.
 */
export function parseLocalLockContent(content: string): LocalSkillLockFile | null {
  const tryParse = (text: string): LocalSkillLockFile | null => {
    try {
      const obj = JSON.parse(text) as LocalSkillLockFile;
      if (typeof obj.version !== 'number' || !obj.skills) return null;
      return obj;
    } catch {
      return null;
    }
  };

  const direct = tryParse(content);
  if (direct) return direct;

  const sides = splitConflictSides(content);
  if (!sides) return null;

  const [ours, theirs] = sides;
  const oursParsed = tryParse(ours);
  const theirsParsed = tryParse(theirs);
  if (!oursParsed) return theirsParsed;
  if (!theirsParsed) return oursParsed;

  // Union skills; on collision, "theirs" (incoming) wins. `skills update` will
  // refresh whichever survives, so the tiebreaker mostly affects transient state.
  return {
    version: Math.max(oursParsed.version, theirsParsed.version),
    skills: { ...oursParsed.skills, ...theirsParsed.skills },
  };
}

/**
 * If `content` contains git conflict markers, return [oursText, theirsText]
 * with each side's JSON reconstructed. Returns null when no markers are found.
 * Handles both default and diff3 styles (the latter inserts a `|||||||`
 * ancestor block, which is ignored).
 */
function splitConflictSides(content: string): [string, string] | null {
  if (!CONFLICT_START_MARKER.test(content)) return null;

  const ours: string[] = [];
  const theirs: string[] = [];
  type State = 'common' | 'ours' | 'ancestor' | 'theirs';
  let state: State = 'common';

  for (const line of content.split('\n')) {
    if (/^<{7}( |$)/.test(line)) {
      state = 'ours';
      continue;
    }
    if (/^\|{7}( |$)/.test(line)) {
      state = 'ancestor';
      continue;
    }
    if (/^={7}$/.test(line)) {
      state = 'theirs';
      continue;
    }
    if (/^>{7}( |$)/.test(line)) {
      state = 'common';
      continue;
    }
    if (state === 'common') {
      ours.push(line);
      theirs.push(line);
    } else if (state === 'ours') {
      ours.push(line);
    } else if (state === 'theirs') {
      theirs.push(line);
    }
  }

  return [ours.join('\n'), theirs.join('\n')];
}

/**
 * Detect and resolve merge conflicts in the local lock file on disk.
 * If conflicts were present and successfully merged, writes the resolved
 * lock back to disk and returns true. Otherwise returns false.
 */
export async function resolveLocalLockConflicts(cwd?: string): Promise<boolean> {
  const lockPath = getLocalLockPath(cwd);
  let content: string;
  try {
    content = await readFile(lockPath, 'utf-8');
  } catch {
    return false;
  }

  if (!CONFLICT_START_MARKER.test(content)) return false;

  const parsed = parseLocalLockContent(content);
  if (!parsed) return false;

  await writeLocalLock(parsed, cwd);
  return true;
}

/**
 * Write the local skill lock file.
 * Skills are sorted alphabetically by name for deterministic output.
 */
export async function writeLocalLock(lock: LocalSkillLockFile, cwd?: string): Promise<void> {
  const lockPath = getLocalLockPath(cwd);

  // Sort skills alphabetically for deterministic output / clean diffs
  const sortedSkills: Record<string, LocalSkillLockEntry> = {};
  for (const key of Object.keys(lock.skills).sort()) {
    sortedSkills[key] = lock.skills[key]!;
  }

  const sorted: LocalSkillLockFile = { version: lock.version, skills: sortedSkills };
  const content = JSON.stringify(sorted, null, 2) + '\n';
  await writeFile(lockPath, content, 'utf-8');
}

/**
 * Compute a SHA-256 hash from all files in a skill directory.
 * Reads all files recursively, sorts them by relative path for determinism,
 * and produces a single hash from their concatenated contents.
 */
export async function computeSkillFolderHash(skillDir: string): Promise<string> {
  const files: Array<{ relativePath: string; content: Buffer }> = [];
  await collectFiles(skillDir, skillDir, files);

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
        // Skip .git and node_modules within skill dirs
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
 * Add or update a skill entry in the local lock file.
 */
export async function addSkillToLocalLock(
  skillName: string,
  entry: LocalSkillLockEntry,
  cwd?: string
): Promise<void> {
  const lock = await readLocalLock(cwd);
  lock.skills[skillName] = entry;
  await writeLocalLock(lock, cwd);
}

/**
 * Remove a skill from the local lock file.
 */
export async function removeSkillFromLocalLock(skillName: string, cwd?: string): Promise<boolean> {
  const lock = await readLocalLock(cwd);

  if (!(skillName in lock.skills)) {
    return false;
  }

  delete lock.skills[skillName];
  await writeLocalLock(lock, cwd);
  return true;
}

function createEmptyLocalLock(): LocalSkillLockFile {
  return {
    version: CURRENT_VERSION,
    skills: {},
  };
}
