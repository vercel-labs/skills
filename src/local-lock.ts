import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { isAbsolute, join, relative, resolve, sep } from 'path';
import { diagnostics } from './diagnostics.ts';
import { computeSkillFolderHash } from './skill-hash.ts';
import { sanitizeName } from './sanitize.ts';
import { AGENTS_DIR, SKILLS_SUBDIR } from './constants.ts';

export { computeSkillFolderHash };

const LOCAL_LOCK_FILE = 'skills-lock.json';
/** v2: computedHash is the portable hash from skill-hash.ts. v1 used a locale-dependent one. */
const CURRENT_VERSION = 2;

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
  /** Original remote URL, when source was normalized for lock readability. */
  sourceUrl?: string;
  /** Branch or tag ref used for installation */
  ref?: string;
  /** The provider/source type (e.g., "github", "node_modules", "local") */
  sourceType: string;
  /**
   * Path to the skill's SKILL.md within the source repo (e.g., "skills/pdf/SKILL.md").
   * Required to re-install only this skill on update — without it, an update would
   * refetch every skill in the source repo. For node_modules sources it is relative
   * to the package root. Optional for backward compatibility with lock files written
   * before this field existed, and omitted for local paths.
   */
  skillPath?: string;
  /** Version of the npm package that shipped the skill (node_modules sources only). */
  version?: string;
  /** Package whose package.json `skills` field requested the skill; `.` is the project. */
  via?: string;
  /**
   * SHA-256 of the files the installer writes for the skill (see
   * `computeSkillFolderHash`), so it can be checked against `.agents/skills/<name>`.
   * Empty when a v1 lock was migrated without the skill on disk: nothing to verify against.
   */
  computedHash: string;
  /**
   * Eve subagent targets this skill was installed into, so `update` can
   * restore the same placement. Each entry is an Eve subagent directory name;
   * the empty string `''` denotes the root agent (`agent/skills`). Omitted for
   * non-Eve installs and for plain Eve root installs (treated as `['']`).
   */
  subagents?: string[];
  wellKnownDigest?: string;
  /** Set when the user chose copies over symlinks, so `update` reinstalls copies. */
  installMode?: 'copy';
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

/** Where a project skill is installed: `.agents/skills/<name>`. */
export function getInstalledSkillDir(skillName: string, cwd?: string): string {
  return join(cwd || process.cwd(), AGENTS_DIR, SKILLS_SUBDIR, sanitizeName(skillName));
}

/**
 * Read the local skill lock file.
 * Returns an empty lock when the file does not exist; throws
 * SKILLS_INVALID_LOCAL_LOCK when it exists but cannot be used (merge conflict
 * markers, a missing `skills` map, or a schema version this CLI does not know),
 * since treating such a file as empty would let the next write drop every entry.
 *
 * A v1 lock is migrated to v2 without network access: each computedHash is
 * recomputed from the installed skill, or left empty when it is not installed.
 * With `persistMigration` the migrated lock is written back.
 */
export async function readLocalLock(
  cwd?: string,
  { persistMigration = false }: { persistMigration?: boolean } = {}
): Promise<LocalSkillLockFile> {
  const lockDir = cwd || process.cwd();
  const lockPath = getLocalLockPath(lockDir);

  let content: string;
  try {
    content = await readFile(lockPath, 'utf-8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return createEmptyLocalLock();
    }
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'not valid JSON';
    throw diagnostics.SKILLS_INVALID_LOCAL_LOCK({ path: lockPath, reason, cause: error });
  }

  if (!isLocalLockShape(parsed)) {
    throw diagnostics.SKILLS_INVALID_LOCAL_LOCK({
      path: lockPath,
      reason: 'expected an object with "version" and "skills"',
    });
  }

  if (parsed.version !== CURRENT_VERSION && parsed.version !== 1) {
    throw diagnostics.SKILLS_INVALID_LOCAL_LOCK({
      path: lockPath,
      reason: `unsupported lock version ${parsed.version} (expected ${CURRENT_VERSION})`,
    });
  }

  for (const entry of Object.values(parsed.skills)) {
    if (entry.sourceType === 'local' && !isAbsolute(entry.source)) {
      entry.source = resolve(lockDir, entry.source);
    }
  }

  if (parsed.version === 1) {
    await Promise.all(
      Object.entries(parsed.skills).map(async ([name, entry]) => {
        const dir = getInstalledSkillDir(name, lockDir);
        entry.computedHash = existsSync(join(dir, 'SKILL.md'))
          ? await computeSkillFolderHash(dir).catch(() => '')
          : '';
      })
    );
    parsed.version = CURRENT_VERSION;
    if (persistMigration) await writeLocalLock(parsed, lockDir);
  }

  return parsed;
}

/**
 * How the installed copy of a locked skill compares with its lock entry:
 * `missing` without a SKILL.md, `modified` when the files no longer hash to
 * computedHash, otherwise `tracked`. An entry with no hash cannot be modified.
 */
export async function getLockedSkillState(
  skillName: string,
  entry: Pick<LocalSkillLockEntry, 'computedHash'>,
  cwd?: string,
  /** Where the skill is installed, when not `.agents/skills/<name>`. */
  dir: string = getInstalledSkillDir(skillName, cwd)
): Promise<'tracked' | 'missing' | 'modified'> {
  if (!existsSync(join(dir, 'SKILL.md'))) return 'missing';
  if (!entry.computedHash) return 'tracked';
  const hash = await computeSkillFolderHash(dir).catch(() => null);
  return hash === entry.computedHash ? 'tracked' : 'modified';
}

function isLocalLockShape(value: unknown): value is LocalSkillLockFile {
  return (
    typeof value === 'object' &&
    value !== null &&
    'version' in value &&
    typeof value.version === 'number' &&
    'skills' in value &&
    typeof value.skills === 'object' &&
    value.skills !== null
  );
}

/**
 * Write the local skill lock file.
 * Skills are sorted alphabetically by name for deterministic output.
 */
export async function writeLocalLock(lock: LocalSkillLockFile, cwd?: string): Promise<void> {
  const lockDir = cwd || process.cwd();
  const lockPath = getLocalLockPath(lockDir);

  // Sort skills alphabetically for deterministic output / clean diffs
  const sortedSkills = Object.fromEntries(
    Object.keys(lock.skills)
      .sort()
      .map((key): [string, LocalSkillLockEntry] => {
        const entry = lock.skills[key]!;
        return [
          key,
          entry.sourceType === 'local'
            ? { ...entry, source: getPortableLocalSource(entry.source, lockDir) }
            : entry,
        ];
      })
  );

  const sorted: LocalSkillLockFile = { version: lock.version, skills: sortedSkills };
  const content = JSON.stringify(sorted, null, 2) + '\n';
  await writeFile(lockPath, content, 'utf-8');
}

function getPortableLocalSource(source: string, lockDir: string): string {
  const absoluteSource = isAbsolute(source) ? source : resolve(lockDir, source);
  const relativeSource = relative(lockDir, absoluteSource);

  // Different Windows drives cannot be represented by a relative path.
  if (isAbsolute(relativeSource)) {
    return absoluteSource.split(sep).join('/');
  }

  const portableSource = relativeSource.split(sep).join('/');
  if (!portableSource) return '.';
  if (portableSource === '..' || portableSource.startsWith('../')) return portableSource;
  return `./${portableSource}`;
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
  lock.skills = { ...lock.skills, [skillName]: entry };
  await writeLocalLock(lock, cwd);
}

/**
 * Why recording `entry` for `skillName` would change the lock, or null when
 * it matches what is locked. Drives `--frozen-lockfile`.
 */
export function lockChangeReason(
  lock: LocalSkillLockFile,
  skillName: string,
  entry: Pick<LocalSkillLockEntry, 'computedHash' | 'version'>
): string | null {
  const locked = lock.skills[skillName];
  if (!locked) return `${skillName} is not in skills-lock.json`;
  if (!locked.computedHash) {
    return `${skillName} has no content hash in skills-lock.json (migrated from version 1 without the skill installed)`;
  }
  if (locked.computedHash !== entry.computedHash) {
    return `${skillName} has changed since skills-lock.json was written`;
  }
  if (locked.version !== entry.version) {
    return `${skillName} comes from version ${entry.version ?? 'unknown'}, skills-lock.json has ${locked.version ?? 'unknown'}`;
  }
  return null;
}

export function frozenLockfileError(changes: string[]): string {
  return [
    'Cannot install with --frozen-lockfile because skills-lock.json is not up to date:',
    ...changes.map((change) => `  ${change}`),
    'Run again with --no-frozen-lockfile to update it.',
  ].join('\n');
}

/**
 * Remove a skill from the local lock file.
 */
export async function removeSkillFromLocalLock(skillName: string, cwd?: string): Promise<boolean> {
  const lock = await readLocalLock(cwd);

  if (!Object.hasOwn(lock.skills, skillName)) {
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
