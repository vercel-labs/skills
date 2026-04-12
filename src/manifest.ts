import { readFile, writeFile } from 'fs/promises';
import { dirname } from 'path';
import { parse, stringify } from 'smol-toml';
import type {
  ManifestSkillEntry,
  SkillManifest,
  ManifestLockEntry,
  ManifestLockFile,
} from './types.ts';

export class ManifestParseError extends Error {
  filePath: string;
  constructor(message: string, filePath: string) {
    super(message);
    this.name = 'ManifestParseError';
    this.filePath = filePath;
  }
}

export class VersionNotFoundError extends Error {
  source: string;
  version: string;
  availableVersions: string[];
  constructor(source: string, version: string, availableVersions: string[]) {
    super(
      `Version ${version} not found for ${source}. Available: ${availableVersions.join(', ') || 'none'}`
    );
    this.name = 'VersionNotFoundError';
    this.source = source;
    this.version = version;
    this.availableVersions = availableVersions;
  }
}

export class SkillNotFoundError extends Error {
  skillName: string;
  source: string;
  availableSkills: string[];
  constructor(skillName: string, source: string, availableSkills: string[]) {
    super(
      `Skill "${skillName}" not found in ${source}. Available: ${availableSkills.join(', ') || 'none'}`
    );
    this.name = 'SkillNotFoundError';
    this.skillName = skillName;
    this.source = source;
    this.availableSkills = availableSkills;
  }
}

export class LocationValidationError extends Error {
  location: string;
  constructor(message: string, location: string) {
    super(message);
    this.name = 'LocationValidationError';
    this.location = location;
  }
}

/**
 * Validates a location string for security and correctness.
 * Accepts: "global", "project", or relative paths (no absolute paths, no "..")
 */
export function validateLocation(location: string): void {
  if (location === 'global' || location === 'project') {
    return;
  }

  if (!location || location.trim() === '') {
    throw new LocationValidationError('Location cannot be empty', location);
  }

  if (location.startsWith('/') || location.startsWith('~')) {
    throw new LocationValidationError(
      `Location "${location}" must be a relative path. Absolute paths starting with "/" or "~" are not allowed.`,
      location
    );
  }

  if (/^[A-Za-z]:/.test(location)) {
    throw new LocationValidationError(
      `Location "${location}" must be a relative path. Windows absolute paths are not allowed.`,
      location
    );
  }

  if (location.includes('..')) {
    throw new LocationValidationError(
      `Location "${location}" contains ".." which is not allowed for security reasons.`,
      location
    );
  }

  if (/[\x00]/.test(location)) {
    throw new LocationValidationError(
      `Location "${location}" contains invalid characters.`,
      location
    );
  }
}

interface TomlSkillEntry {
  source: string;
  name: string;
  version?: string;
  locations?: string[];
}

interface TomlManifest {
  skills?: TomlSkillEntry[];
}

interface TomlLockEntry {
  source: string;
  name: string;
  version: string;
  resolvedRef: string;
  installedAt: string;
  location?: string;
}

interface TomlLockFile {
  lockVersion?: number;
  skills?: TomlLockEntry[];
}

export async function parseManifestFile(filePath: string): Promise<SkillManifest> {
  let content: string;

  try {
    content = await readFile(filePath, 'utf-8');
  } catch (error) {
    throw new ManifestParseError(
      `Could not read manifest file: ${(error as Error).message}`,
      filePath
    );
  }

  let parsed: TomlManifest;
  try {
    parsed = parse(content) as TomlManifest;
  } catch (error) {
    throw new ManifestParseError(`Invalid TOML: ${(error as Error).message}`, filePath);
  }

  if (!parsed.skills || !Array.isArray(parsed.skills)) {
    throw new ManifestParseError('Manifest must contain a [[skills]] array', filePath);
  }

  const skills: ManifestSkillEntry[] = [];

  for (let i = 0; i < parsed.skills.length; i++) {
    const entry = parsed.skills[i];

    if (!entry || typeof entry !== 'object') {
      throw new ManifestParseError(`Invalid skill entry at index ${i}`, filePath);
    }

    if (!entry.source || typeof entry.source !== 'string') {
      throw new ManifestParseError(`Skill entry ${i} missing required "source" field`, filePath);
    }

    if (!entry.name || typeof entry.name !== 'string') {
      throw new ManifestParseError(`Skill entry ${i} missing required "name" field`, filePath);
    }

    const manifestEntry: ManifestSkillEntry = {
      source: entry.source,
      name: entry.name,
    };

    if (entry.version && typeof entry.version === 'string') {
      manifestEntry.version = entry.version;
    }

    if (entry.locations) {
      if (!Array.isArray(entry.locations)) {
        throw new ManifestParseError(`Skill entry ${i} "locations" must be an array`, filePath);
      }

      for (const loc of entry.locations) {
        if (typeof loc !== 'string') {
          throw new ManifestParseError(
            `Skill entry ${i} "locations" must contain only strings`,
            filePath
          );
        }
        try {
          validateLocation(loc);
        } catch (error) {
          if (error instanceof LocationValidationError) {
            throw new ManifestParseError(`Skill entry ${i}: ${error.message}`, filePath);
          }
          throw error;
        }
      }

      if (entry.locations.length > 0) {
        manifestEntry.locations = [...new Set(entry.locations)];
      }
    }

    validateManifestEntry(manifestEntry);
    skills.push(manifestEntry);
  }

  if (skills.length === 0) {
    throw new ManifestParseError('Manifest file contains no skill entries', filePath);
  }

  return { skills };
}

export function validateManifestEntry(entry: ManifestSkillEntry): void {
  const isShorthand = /^[^/]+\/[^/]+$/.test(entry.source);
  const isUrl = entry.source.includes('://') || entry.source.startsWith('git@');

  if (!isShorthand && !isUrl) {
    throw new Error(`Invalid source "${entry.source}". Use "owner/repo" or a full git URL.`);
  }

  if (entry.version && entry.version !== 'latest') {
    const semverRegex = /^\d+\.\d+\.\d+(-[\w.]+)?(\+[\w.]+)?$/;
    if (!semverRegex.test(entry.version)) {
      throw new Error(
        `Invalid version "${entry.version}" for skill "${entry.name}". Use semantic versioning (e.g., 1.0.0) or "latest".`
      );
    }
  }
}

export function getLockFilePath(manifestPath: string): string {
  const baseName = manifestPath.replace(/\.toml$/, '');
  return `${baseName}-lock.toml`;
}

export async function readLockFile(lockPath: string): Promise<ManifestLockFile | null> {
  try {
    const content = await readFile(lockPath, 'utf-8');
    const parsed = parse(content) as TomlLockFile;

    if (!parsed.lockVersion || typeof parsed.lockVersion !== 'number') {
      return null;
    }

    if (!parsed.skills || !Array.isArray(parsed.skills)) {
      return { lockVersion: parsed.lockVersion, skills: [] };
    }

    const skills: ManifestLockEntry[] = parsed.skills.map((entry) => {
      const lockEntry: ManifestLockEntry = {
        source: entry.source,
        name: entry.name,
        version: entry.version,
        resolvedRef: entry.resolvedRef,
        installedAt: entry.installedAt,
      };
      if (entry.location) {
        lockEntry.location = entry.location;
      }
      return lockEntry;
    });

    return { lockVersion: parsed.lockVersion, skills };
  } catch {
    return null;
  }
}

export async function writeLockFile(lockPath: string, entries: ManifestLockEntry[]): Promise<void> {
  const lockFile: TomlLockFile = {
    lockVersion: 1,
    skills: entries.map((entry) => {
      const tomlEntry: TomlLockEntry = {
        source: entry.source,
        name: entry.name,
        version: entry.version,
        resolvedRef: entry.resolvedRef,
        installedAt: entry.installedAt,
      };
      if (entry.location) {
        tomlEntry.location = entry.location;
      }
      return tomlEntry;
    }),
  };

  const tomlContent = stringify(lockFile);
  await writeFile(lockPath, tomlContent, 'utf-8');
}

/** Group manifest entries by source for efficient cloning */
export function groupSkillsBySource(
  skills: ManifestSkillEntry[]
): Map<string, ManifestSkillEntry[]> {
  const grouped = new Map<string, ManifestSkillEntry[]>();

  for (const skill of skills) {
    const key = skill.version ? `${skill.source}@${skill.version}` : skill.source;
    const existing = grouped.get(key) || [];
    existing.push(skill);
    grouped.set(key, existing);
  }

  return grouped;
}

/** Group manifest entries by source and resolved ref (for frozen mode) */
export function groupSkillsBySourceAndRef(
  skills: ManifestSkillEntry[],
  lockEntries: ManifestLockEntry[]
): Map<string, ManifestSkillEntry[]> {
  const grouped = new Map<string, ManifestSkillEntry[]>();

  for (const skill of skills) {
    const lockEntry = lockEntries.find(
      (l) => l.source === skill.source && l.name.toLowerCase() === skill.name.toLowerCase()
    );

    const key = lockEntry ? `${skill.source}@${lockEntry.resolvedRef}` : skill.source;

    const existing = grouped.get(key) || [];
    existing.push(skill);
    grouped.set(key, existing);
  }

  return grouped;
}
