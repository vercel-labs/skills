import {
  mkdir,
  cp,
  access,
  readdir,
  symlink,
  lstat,
  rm,
  readlink,
  writeFile,
  stat,
  realpath,
  readFile,
} from 'fs/promises';
import { constants } from 'fs';
import { join, basename, normalize, resolve, sep, relative, dirname } from 'path';
import { homedir, platform } from 'os';
import type { Skill, AgentType, MintlifySkill, RemoteSkill } from './types.ts';
import type { WellKnownSkill } from './providers/wellknown.ts';
import { agents, detectInstalledAgents, isUniversalAgent } from './agents.ts';
import { AGENTS_DIR, SKILLS_SUBDIR } from './constants.ts';
import { parseSkillMd } from './skills.ts';

export type InstallMode = 'symlink' | 'copy';

interface InstallResult {
  success: boolean;
  path: string;
  canonicalPath?: string;
  mode: InstallMode;
  symlinkFailed?: boolean;
  recoveredWithCopy?: boolean;
  error?: string;
}

/**
 * Sanitizes a filename/directory name to prevent path traversal attacks
 * and ensures it follows kebab-case convention
 * @param name - The name to sanitize
 * @returns Sanitized name safe for use in file paths
 */
export function sanitizeName(name: string): string {
  const sanitized = name
    .toLowerCase()
    // Replace any sequence of characters that are NOT lowercase letters (a-z),
    // digits (0-9), dots (.), or underscores (_) with a single hyphen.
    // This converts spaces, special chars, and path traversal attempts (../) into hyphens.
    .replace(/[^a-z0-9._]+/g, '-')
    // Remove leading/trailing dots and hyphens to prevent hidden files (.) and
    // ensure clean directory names. The pattern matches:
    // - ^[.\-]+ : one or more dots or hyphens at the start
    // - [.\-]+$ : one or more dots or hyphens at the end
    .replace(/^[.\-]+|[.\-]+$/g, '');

  // Limit to 255 chars (common filesystem limit), fallback to 'unnamed-skill' if empty
  return sanitized.substring(0, 255) || 'unnamed-skill';
}

/**
 * Sanitizes a namespace to prevent path traversal attacks while preserving
 * forward slashes for GitHub/GitLab owner/repo format
 * @param name - The namespace to sanitize
 * @returns Sanitized namespace safe for use in file paths
 */
export function sanitizeNamespace(name: string): string {
  const sanitized = name
    .toLowerCase()
    // First, prevent path traversal by replacing dots outside of owner/repo context
    // We'll keep dots only if they appear to be part of a valid filename
    .split('/')
    .map((part) => {
      // For each part of the namespace, sanitize it like a filename
      return part.replace(/[^a-z0-9._]+/g, '-').replace(/^[.\-]+|[.\-]+$/g, '');
    })
    .join('/')
    // Remove leading/trailing slashes and dots to prevent path traversal
    .replace(/^[\.\-\/]+|[\.\-\/]+$/g, '');

  // Limit to 255 chars (common filesystem limit), fallback to 'unnamed-namespace' if empty
  return sanitized.substring(0, 255) || 'unnamed-namespace';
}

/**
 * Validates that a path is within an expected base directory
 * @param basePath - The expected base directory
 * @param targetPath - The path to validate
 * @returns true if targetPath is within basePath
 */
function isPathSafe(basePath: string, targetPath: string): boolean {
  const normalizedBase = normalize(resolve(basePath));
  const normalizedTarget = normalize(resolve(targetPath));

  return normalizedTarget.startsWith(normalizedBase + sep) || normalizedTarget === normalizedBase;
}

/**
 * Gets the canonical .agents/skills directory path
 * @param global - Whether to use global (home) or project-level location
 * @param cwd - Current working directory for project-level installs
 */
export function getCanonicalSkillsDir(global: boolean, cwd?: string): string {
  const baseDir = global ? homedir() : cwd || process.cwd();
  return join(baseDir, AGENTS_DIR, SKILLS_SUBDIR);
}

function resolveSymlinkTarget(linkPath: string, linkTarget: string): string {
  return resolve(dirname(linkPath), linkTarget);
}

/**
 * Checks if two paths point to the same location (after normalization and resolution)
 * @param path1 - First path
 * @param path2 - Second path
 * @returns true if both paths resolve to the same location
 */
async function isSamePath(path1: string, path2: string): Promise<boolean> {
  try {
    const resolved1 = resolve(path1);
    const resolved2 = resolve(path2);
    const normalized1 = normalize(resolved1);
    const normalized2 = normalize(resolved2);

    // Quick string comparison first
    if (normalized1 === normalized2) {
      return true;
    }

    // For better accuracy, compare file stats if paths exist
    try {
      const stat1 = await stat(resolved1);
      const stat2 = await stat(resolved2);

      // On Unix-like systems, compare inodes
      if (stat1.ino !== undefined && stat2.ino !== undefined) {
        return stat1.dev === stat2.dev && stat1.ino === stat2.ino;
      }

      // On Windows or if inodes unavailable, compare normalized paths
      return normalized1 === normalized2;
    } catch {
      // If stats fail, use normalized path comparison
      return normalized1 === normalized2;
    }
  } catch {
    // If resolution fails, fall back to string comparison
    return normalize(path1) === normalize(path2);
  }
}

/**
 * Cleans and recreates a directory for skill installation.
 *
 * This ensures:
 * 1. Renamed/deleted files from previous installs are removed
 * 2. Symlinks (including self-referential ones causing ELOOP) are handled
 *    when canonical and agent paths resolve to the same location
 * 3. Existing files (not directories) are removed before creating directory
 */
async function cleanAndCreateDirectory(path: string): Promise<void> {
  try {
    const stats = await lstat(path);
    if (stats.isDirectory()) {
      // If it's a directory, remove it recursively
      await rm(path, { recursive: true, force: true });
    } else {
      // If it's a file or symlink, remove it
      await rm(path, { force: true });
    }
  } catch (err: unknown) {
    // ENOENT = doesn't exist, which is fine
    // Other errors will cause mkdir to fail, which we'll catch
    if (err && typeof err === 'object' && 'code' in err && err.code !== 'ENOENT') {
      // Try force remove as fallback
      try {
        await rm(path, { recursive: true, force: true });
      } catch {
        // Ignore - mkdir will fail if there's a real problem
      }
    }
  }

  // Create parent directory first (if needed), then the target directory
  // This avoids ENOTDIR error when path exists as a file
  const parentDir = dirname(path);
  try {
    await mkdir(parentDir, { recursive: true });
  } catch (err) {
    throw new Error(
      `Failed to create parent directory ${parentDir}: ${err instanceof Error ? err.message : 'Unknown error'}`
    );
  }

  try {
    await mkdir(path);
  } catch (err) {
    throw new Error(
      `Failed to create directory ${path}: ${err instanceof Error ? err.message : 'Unknown error'}`
    );
  }
}

/**
 * Verifies that a skill installation is valid by checking:
 * 1. The directory exists
 * 2. SKILL.md file exists in the directory
 * 3. SKILL.md is readable
 *
 * Returns success=true if valid, success=false with error message if not
 */
async function verifySkillInstallation(
  skillDir: string,
  skillName: string
): Promise<{ success: boolean; error?: string }> {
  try {
    // Check if directory exists
    const stats = await lstat(skillDir);
    if (!stats.isDirectory()) {
      return {
        success: false,
        error: `Path is not a directory: ${skillDir}`,
      };
    }

    // Check if SKILL.md exists
    const skillMdPath = join(skillDir, 'SKILL.md');
    try {
      const mdStats = await lstat(skillMdPath);
      if (!mdStats.isFile()) {
        return {
          success: false,
          error: `SKILL.md is not a file: ${skillMdPath}`,
        };
      }
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') {
        return {
          success: false,
          error: `SKILL.md not found in ${skillDir}`,
        };
      }
      throw err;
    }

    // Try to read the file to ensure it's accessible
    try {
      await access(skillMdPath, constants.R_OK);
    } catch {
      return {
        success: false,
        error: `SKILL.md is not readable: ${skillMdPath}`,
      };
    }

    // Try to parse the skill to ensure it's valid
    const skill = await parseSkillMd(skillMdPath, { includeInternal: true });
    if (!skill) {
      return {
        success: false,
        error: `SKILL.md is not a valid skill file: ${skillMdPath}`,
      };
    }

    return { success: true };
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') {
      return {
        success: false,
        error: `Skill directory does not exist: ${skillDir}`,
      };
    }
    return {
      success: false,
      error: `Verification failed for ${skillName}: ${err instanceof Error ? err.message : 'Unknown error'}`,
    };
  }
}

/**
 * Resolve a path's parent directory through symlinks, keeping the final component.
 * This handles the case where a parent directory (e.g., ~/.claude/skills) is a symlink
 * to another location (e.g., ~/.agents/skills). In that case, computing relative paths
 * from the symlink path produces broken symlinks.
 *
 * Returns the real path of the parent + the original basename.
 * If realpath fails (parent doesn't exist), returns the original resolved path.
 */
async function resolveParentSymlinks(path: string): Promise<string> {
  const resolved = resolve(path);
  const dir = dirname(resolved);
  const base = basename(resolved);
  try {
    const realDir = await realpath(dir);
    return join(realDir, base);
  } catch {
    return resolved;
  }
}

/**
 * Creates a symlink, handling cross-platform differences
 * Returns true if symlink was created, false if fallback to copy is needed
 */
async function createSymlink(target: string, linkPath: string): Promise<boolean> {
  try {
    const resolvedTarget = resolve(target);
    const resolvedLinkPath = resolve(linkPath);

    if (resolvedTarget === resolvedLinkPath) {
      return true;
    }

    // Also check with symlinks resolved in parent directories.
    // This handles cases where e.g. ~/.claude/skills is a symlink to ~/.agents/skills,
    // so ~/.claude/skills/<skill> and ~/.agents/skills/<skill> are physically the same.
    const realTarget = await resolveParentSymlinks(target);
    const realLinkPath = await resolveParentSymlinks(linkPath);

    if (realTarget === realLinkPath) {
      return true;
    }

    try {
      const stats = await lstat(linkPath);
      if (stats.isSymbolicLink()) {
        const existingTarget = await readlink(linkPath);
        if (resolveSymlinkTarget(linkPath, existingTarget) === resolvedTarget) {
          return true;
        }
        await rm(linkPath);
      } else {
        await rm(linkPath, { recursive: true });
      }
    } catch (err: unknown) {
      // ELOOP = circular symlink, ENOENT = doesn't exist
      // For ELOOP, try to remove the broken symlink
      if (err && typeof err === 'object' && 'code' in err && err.code === 'ELOOP') {
        try {
          await rm(linkPath, { force: true });
        } catch {
          // If we can't remove it, symlink creation will fail and trigger copy fallback
        }
      }
      // For ENOENT or other errors, continue to symlink creation
    }

    const linkDir = dirname(linkPath);

    // Always ensure parent directory exists before creating symlink
    // On Windows, we need special handling for user directories like .claude, .cursor, etc.
    if (platform() === 'win32') {
      // On Windows, check if we're trying to create directories in user's home with dot-prefixed names
      // These often require special permissions or don't exist by default
      const home = homedir();
      const normalizedLinkDir = linkDir.toLowerCase();
      const normalizedHome = home.toLowerCase();

      if (normalizedLinkDir.startsWith(normalizedHome)) {
        const relativePath = linkDir.substring(home.length);
        // Check if this path contains dot-directories that likely don't exist
        const pathParts = relativePath.split(sep).filter((part) => part.length > 0 && part !== '.');
        const hasDotDirectories = pathParts.some((part) => part.startsWith('.') && part.length > 1);

        if (hasDotDirectories) {
          // These directories (like .claude, .cursor) typically don't exist by default on Windows
          // and may require admin privileges. Just return false to trigger copy fallback.
          return false;
        }
      }
    }

    // Try to create directory recursively
    try {
      await mkdir(linkDir, { recursive: true });
    } catch (mkdirErr) {
      // If we can't create directory, symlink will definitely fail
      return false;
    }

    // Use the real (symlink-resolved) parent directory for computing the relative path.
    // This ensures the symlink target is correct even when the link's parent dir is a symlink.
    const realLinkDir = await resolveParentSymlinks(linkDir);
    const relativePath = relative(realLinkDir, target);
    const symlinkType = platform() === 'win32' ? 'junction' : undefined;

    await symlink(relativePath, linkPath, symlinkType);
    return true;
  } catch {
    return false;
  }
}

export async function installSkillForAgent(
  skill: Skill,
  agentType: AgentType,
  options: { global?: boolean; cwd?: string; mode?: InstallMode; namespace?: string } = {}
): Promise<InstallResult> {
  const agent = agents[agentType];
  const isGlobal = options.global ?? false;
  const cwd = options.cwd || process.cwd();

  // Check if agent supports global installation
  if (isGlobal && agent.globalSkillsDir === undefined) {
    return {
      success: false,
      path: '',
      mode: options.mode ?? 'symlink',
      error: `${agent.displayName} does not support global skill installation`,
    };
  }

  // Sanitize skill name to prevent directory traversal
  const rawSkillName = skill.name || basename(skill.path);
  const skillName = sanitizeName(rawSkillName);

  // Use namespace from options, then from skill object, otherwise no namespace
  const ns = options.namespace
    ? sanitizeNamespace(options.namespace)
    : skill.namespace
      ? sanitizeNamespace(skill.namespace)
      : undefined;

  // Canonical location: .agents/skills/{ns}/{skill-name} or .agents/skills/{skill-name}
  const canonicalBase = getCanonicalSkillsDir(isGlobal, cwd);

  // Build the expected canonical path
  const expectedCanonicalDir = ns
    ? join(canonicalBase, ns, skillName)
    : join(canonicalBase, skillName);

  // If skill is already in the correct canonical location, use it directly
  // Otherwise use the expected path
  const canonicalDir = (await isSamePath(skill.path, expectedCanonicalDir))
    ? skill.path
    : expectedCanonicalDir;

  // Agent-specific location (for symlink)
  const agentBase = isGlobal ? agent.globalSkillsDir! : join(cwd, agent.skillsDir);

  // Always build agent path normally - this is where the symlink should be created
  const agentDir = ns ? join(agentBase, ns, skillName) : join(agentBase, skillName);

  let installMode = options.mode ?? 'symlink';

  // Validate paths
  if (!isPathSafe(canonicalBase, canonicalDir)) {
    return {
      success: false,
      path: agentDir,
      mode: installMode,
      error: 'Invalid skill name: potential path traversal detected',
    };
  }

  if (!isPathSafe(agentBase, agentDir)) {
    return {
      success: false,
      path: agentDir,
      mode: installMode,
      error: 'Invalid skill name: potential path traversal detected',
    };
  }

  // Pre-check: On Windows, if agent directory is in user's home with dot-prefixed subdirectories
  // that likely don't exist, skip symlink mode and use copy mode directly
  if (installMode === 'symlink' && platform() === 'win32') {
    const home = homedir();
    console.log(`DEBUG: agentDir=${agentDir}`);
    console.log(`DEBUG: home=${home}`);
    console.log(`DEBUG: platform=${platform()}`);

    const normalizedAgentDir = agentDir.toLowerCase().replace(/\\/g, '/');
    const normalizedHome = home.toLowerCase().replace(/\\/g, '/');

    console.log(`DEBUG: normalizedAgentDir=${normalizedAgentDir}`);
    console.log(`DEBUG: normalizedHome=${normalizedHome}`);

    if (normalizedAgentDir.startsWith(normalizedHome)) {
      const relativePath = agentDir.substring(home.length);
      console.log(`DEBUG: relativePath=${relativePath}`);
      const pathParts = relativePath.split(sep).filter((part) => part.length > 0 && part !== '.');
      console.log(`DEBUG: pathParts=${JSON.stringify(pathParts)}`);
      const hasDotDirectories = pathParts.some((part) => part.startsWith('.') && part.length > 1);
      console.log(`DEBUG: hasDotDirectories=${hasDotDirectories}`);

      if (hasDotDirectories) {
        // Switch to copy mode for Windows user directories
        console.log(`Note: Switching to copy mode for Windows user directory: ${agentDir}`);
        installMode = 'copy';
      }
    }
  }

  try {
    // For copy mode, skip canonical directory and copy directly to agent location
    if (installMode === 'copy') {
      // First check if target directory already exists and is valid
      const targetExistsAndValid = await verifySkillInstallation(agentDir, skill.name).then(
        (v) => v.success
      );

      // Skip if source and destination are the same, or if target already exists and is valid
      if (!(await isSamePath(skill.path, agentDir)) && !targetExistsAndValid) {
        try {
          await cleanAndCreateDirectory(agentDir);
        } catch (cleanErr) {
          // Ignore directory creation errors for copy mode - try to work with existing directory
          console.warn(
            `Warning: Failed to create agent directory ${agentDir}: ${cleanErr instanceof Error ? cleanErr.message : 'Unknown error'}`
          );
        }

        try {
          await copyDirectory(skill.path, agentDir);
        } catch (copyErr) {
          throw new Error(
            `Failed to copy from ${skill.path} to ${agentDir}: ${copyErr instanceof Error ? copyErr.message : 'Unknown error'}`
          );
        }
      }

      // Verify installation: check if SKILL.md exists in the destination
      // Also check if directory actually exists on filesystem
      let verified = await verifySkillInstallation(agentDir, skill.name);

      // If verification failed, double-check if the directory physically exists
      if (!verified.success) {
        try {
          const stats = await lstat(agentDir);
          if (stats.isDirectory()) {
            // Directory exists on disk, manually check for SKILL.md
            const skillMdPath = join(agentDir, 'SKILL.md');
            try {
              await access(skillMdPath);
              // SKILL.md exists, consider installation valid
              verified = { success: true };
            } catch {
              // SKILL.md really doesn't exist
            }
          }
        } catch {
          // Directory doesn't exist on disk
        }
      }

      if (!verified.success) {
        return {
          success: false,
          path: agentDir,
          mode: 'copy',
          error: verified.error,
        };
      }

      // Additional verification: ensure SKILL.md is actually readable and contains content
      try {
        const skillMdPath = join(agentDir, 'SKILL.md');

        // First check if file exists and is accessible
        try {
          await access(skillMdPath, constants.R_OK);
        } catch {
          return {
            success: false,
            path: agentDir,
            mode: 'copy',
            error: 'SKILL.md is not accessible or does not exist',
          };
        }

        const content = await readFile(skillMdPath, 'utf-8');
        if (!content || content.trim().length === 0) {
          return {
            success: false,
            path: agentDir,
            mode: 'copy',
            error: 'SKILL.md is empty',
          };
        }

        // Final check: ensure the file was actually copied by comparing with source
        const sourceSkillMdPath = join(skill.path, 'SKILL.md');
        try {
          const sourceStats = await stat(sourceSkillMdPath);
          const destStats = await stat(skillMdPath);

          // Both files should exist and destination should not be empty
          if (destStats.size === 0) {
            return {
              success: false,
              path: agentDir,
              mode: 'copy',
              error: 'SKILL.md was copied but has zero size',
            };
          }

          // Size should be reasonably close (allow for line ending differences)
          if (sourceStats.size > 0) {
            const sizeRatio = destStats.size / sourceStats.size;
            if (sizeRatio < 0.5 || sizeRatio > 2.0) {
              // More generous range
              return {
                success: false,
                path: agentDir,
                mode: 'copy',
                error: `SKILL.md copy size mismatch: source ${sourceStats.size} bytes, destination ${destStats.size} bytes`,
              };
            }
          }
        } catch (statsErr) {
          // If we can't stat files, still proceed if content check passed
          console.warn(
            `Could not verify file stats: ${statsErr instanceof Error ? statsErr.message : 'Unknown error'}`
          );
        }
      } catch (err) {
        return {
          success: false,
          path: agentDir,
          mode: 'copy',
          error: `Failed to read SKILL.md: ${err instanceof Error ? err.message : 'Unknown error'}`,
        };
      }

      return {
        success: true,
        path: agentDir,
        mode: 'copy',
      };
    }

    // Symlink mode: copy to canonical location and symlink to agent location
    // Always ensure canonical directory exists and is valid, even if source path is the same
    // (canonicalDir might be a different path that needs to be created)
    // Ignore errors during directory creation - if we can't create it, we'll try to work with existing
    try {
      await cleanAndCreateDirectory(canonicalDir);
      await copyDirectory(skill.path, canonicalDir);
    } catch (err) {
      // Ignore directory creation errors and continue - we'll verify if the target exists
      console.warn(
        `Warning: Failed to create canonical directory ${canonicalDir}: ${err instanceof Error ? err.message : 'Unknown error'}`
      );
    }

    // Verify canonical installation before creating symlink
    // If verification fails, check if the directory actually exists and has content
    let canonicalVerified = await verifySkillInstallation(canonicalDir, skill.name);

    // If verification failed but the directory exists, check if it has the required files
    if (!canonicalVerified.success) {
      try {
        const stats = await lstat(canonicalDir);
        if (stats.isDirectory()) {
          // Directory exists, check if it has SKILL.md
          const skillMdPath = join(canonicalDir, 'SKILL.md');
          try {
            await access(skillMdPath);
            // SKILL.md exists, consider it valid even if verification failed
            canonicalVerified = { success: true };
          } catch {
            // SKILL.md doesn't exist, verification failure is real
          }
        }
      } catch {
        // Directory doesn't exist, verification failure is real
      }
    }

    if (!canonicalVerified.success) {
      return {
        success: false,
        path: canonicalDir,
        mode: 'symlink',
        error: `Canonical copy failed: ${canonicalVerified.error}`,
      };
    }

    // For universal agents with global install, the skill is already in the canonical
    // ~/.agents/skills directory. Skip creating a symlink to the agent-specific global dir
    // (e.g. ~/.copilot/skills) to avoid duplicates.
    if (isGlobal && isUniversalAgent(agentType)) {
      return {
        success: true,
        path: canonicalDir,
        canonicalPath: canonicalDir,
        mode: 'symlink',
      };
    }

    const symlinkCreated = await createSymlink(canonicalDir, agentDir);

    // For Windows, symlink creation often silently fails due to permissions
    // Even if createSymlink returns true, the symlink might not be valid
    // So we always verify, and if verification fails, we fall back to copy mode

    // Check if the agent directory exists and is accessible
    let agentDirAccessible = false;
    try {
      const agentStats = await lstat(agentDir);
      agentDirAccessible = agentStats.isDirectory() || agentStats.isSymbolicLink();
    } catch {
      // Directory doesn't exist or isn't accessible
      agentDirAccessible = false;
    }

    // If symlink wasn't created OR agent directory isn't accessible, fall back to copy
    if (!symlinkCreated || !agentDirAccessible) {
      // Clean up any partial symlink
      try {
        await rm(agentDir, { force: true });
      } catch {
        // Ignore cleanup errors
      }

      // Fall back to copy mode
      // Skip if source and agent destination are the same
      if (!(await isSamePath(skill.path, agentDir))) {
        try {
          await cleanAndCreateDirectory(agentDir);
        } catch (cleanErr) {
          // Ignore directory creation errors for fallback copy
          console.warn(
            `Warning: Failed to create agent directory ${agentDir}: ${cleanErr instanceof Error ? cleanErr.message : 'Unknown error'}`
          );
        }

        try {
          await copyDirectory(skill.path, agentDir);
        } catch (copyErr) {
          return {
            success: false,
            path: agentDir,
            mode: 'symlink',
            error: `Fallback copy failed: ${copyErr instanceof Error ? copyErr.message : 'Unknown error'}`,
          };
        }
      }

      // Verify fallback copy installation
      const fallbackVerified = await verifySkillInstallation(agentDir, skill.name);
      if (!fallbackVerified.success) {
        return {
          success: false,
          path: agentDir,
          mode: 'symlink',
          error: `Fallback copy failed: ${fallbackVerified.error}`,
        };
      }

      return {
        success: true,
        path: agentDir,
        canonicalPath: canonicalDir,
        mode: 'symlink',
        symlinkFailed: true,
      };
    }

    // Symlink was created and agent directory is accessible, now verify it points to a valid skill
    const symlinkVerified = await verifySkillInstallation(agentDir, skill.name);
    if (!symlinkVerified.success) {
      // Verification failed - fall back to copy mode
      // This handles cases where symlink exists but points to invalid location
      try {
        await rm(agentDir, { force: true });
      } catch {
        // Ignore cleanup errors
      }

      if (!(await isSamePath(skill.path, agentDir))) {
        try {
          await cleanAndCreateDirectory(agentDir);
        } catch (cleanErr) {
          // Ignore directory creation errors for fallback copy
          console.warn(
            `Warning: Failed to create agent directory ${agentDir}: ${cleanErr instanceof Error ? cleanErr.message : 'Unknown error'}`
          );
        }

        try {
          await copyDirectory(skill.path, agentDir);
        } catch (copyErr) {
          return {
            success: false,
            path: agentDir,
            mode: 'symlink',
            error: `Fallback copy failed: ${copyErr instanceof Error ? copyErr.message : 'Unknown error'}`,
          };
        }
      }

      const recoveryVerified = await verifySkillInstallation(agentDir, skill.name);
      if (recoveryVerified.success) {
        return {
          success: true,
          path: agentDir,
          canonicalPath: canonicalDir,
          mode: 'symlink',
          symlinkFailed: true,
          recoveredWithCopy: true,
        };
      }

      // Even fallback copy failed
      return {
        success: false,
        path: agentDir,
        canonicalPath: canonicalDir,
        mode: 'symlink',
        error: `Symlink verification failed and fallback copy also failed: ${symlinkVerified.error}`,
      };
    }

    return {
      success: true,
      path: agentDir,
      canonicalPath: canonicalDir,
      mode: 'symlink',
    };
  } catch (error) {
    return {
      success: false,
      path: agentDir,
      mode: installMode,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

const EXCLUDE_FILES = new Set(['README.md', 'metadata.json']);
const EXCLUDE_DIRS = new Set(['.git']);

const isExcluded = (name: string, isDirectory: boolean = false): boolean => {
  if (EXCLUDE_FILES.has(name)) return true;
  if (name.startsWith('_')) return true;
  if (isDirectory && EXCLUDE_DIRS.has(name)) return true;
  return false;
};

async function copyDirectory(src: string, dest: string): Promise<void> {
  // Skip if source and destination are the same
  if (await isSamePath(src, dest)) {
    return;
  }

  // Check if source exists
  try {
    await access(src);
  } catch {
    throw new Error(`Source directory does not exist: ${src}`);
  }

  // Check if dest exists and is not a directory (e.g., a file or symlink)
  try {
    const destStats = await lstat(dest);
    if (!destStats.isDirectory()) {
      // Remove the file/symlink before creating directory
      await rm(dest, { force: true });
    }
  } catch (err: unknown) {
    // ENOENT = doesn't exist, which is fine - we'll create it
    if (err && typeof err === 'object' && 'code' in err && err.code !== 'ENOENT') {
      // Other errors, try to proceed with mkdir
    }
  }

  await mkdir(dest, { recursive: true });

  const entries = await readdir(src, { withFileTypes: true });

  // Copy files and directories in parallel
  const copyPromises = entries
    .filter((entry) => !isExcluded(entry.name, entry.isDirectory()))
    .map(async (entry) => {
      const srcPath = join(src, entry.name);
      const destPath = join(dest, entry.name);

      try {
        if (entry.isDirectory()) {
          await copyDirectory(srcPath, destPath);
        } else {
          await cp(srcPath, destPath, {
            // If the file is a symlink to elsewhere in a remote skill, it may not
            // resolve correctly once it has been copied to the local location.
            // `dereference: true` tells Node to copy the file instead of copying
            // the symlink. `recursive: true` handles symlinks pointing to directories.
            dereference: true,
            recursive: true,
          });
        }
      } catch (err) {
        throw new Error(
          `Failed to copy ${srcPath} to ${destPath}: ${err instanceof Error ? err.message : 'Unknown error'}`
        );
      }
    });

  // Wait for all copies to complete
  await Promise.all(copyPromises);

  // Verify that files were actually copied by checking that the destination directory has content
  // This catches cases where cp() returns success but doesn't actually copy (especially on Windows)
  try {
    const destEntries = await readdir(dest);
    const sourceEntryCount = entries.filter((e) => !isExcluded(e.name, e.isDirectory())).length;

    if (destEntries.length === 0 && sourceEntryCount > 0) {
      throw new Error(
        `Copy succeeded but destination directory is empty: ${dest}. Source had ${sourceEntryCount} entries.`
      );
    }

    // Additional check: ensure at least SKILL.md exists if it was in source
    const hasSkillMdInSource = entries.some(
      (e) => e.name === 'SKILL.md' && !isExcluded(e.name, e.isDirectory())
    );
    const hasSkillMdInDest = destEntries.includes('SKILL.md');

    if (hasSkillMdInSource && !hasSkillMdInDest) {
      throw new Error(`Copy completed but SKILL.md is missing in destination: ${dest}`);
    }
  } catch (err) {
    if (err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') {
      throw new Error(`Destination directory was not created: ${dest}`);
    }
    throw err;
  }
}

export async function isSkillInstalled(
  skillName: string,
  agentType: AgentType,
  options: { global?: boolean; cwd?: string; namespace?: string } = {}
): Promise<boolean> {
  const agent = agents[agentType];
  const sanitized = sanitizeName(skillName);
  const ns = options.namespace ? sanitizeNamespace(options.namespace) : undefined;

  // Agent doesn't support global installation
  if (options.global && agent.globalSkillsDir === undefined) {
    return false;
  }

  const targetBase = options.global
    ? agent.globalSkillsDir!
    : join(options.cwd || process.cwd(), agent.skillsDir);

  const skillDir = ns ? join(targetBase, ns, sanitized) : join(targetBase, sanitized);

  if (!isPathSafe(targetBase, skillDir)) {
    return false;
  }

  try {
    await access(skillDir);
    return true;
  } catch {
    return false;
  }
}

export function getInstallPath(
  skillName: string,
  agentType: AgentType,
  options: { global?: boolean; cwd?: string; namespace?: string } = {}
): string {
  const agent = agents[agentType];
  const cwd = options.cwd || process.cwd();
  const sanitized = sanitizeName(skillName);
  const ns = options.namespace ? sanitizeNamespace(options.namespace) : undefined;

  // Agent doesn't support global installation, fall back to project path
  const targetBase =
    options.global && agent.globalSkillsDir !== undefined
      ? agent.globalSkillsDir
      : join(cwd, agent.skillsDir);

  const installPath = ns ? join(targetBase, ns, sanitized) : join(targetBase, sanitized);

  if (!isPathSafe(targetBase, installPath)) {
    throw new Error('Invalid skill name: potential path traversal detected');
  }

  return installPath;
}

/**
 * Gets the canonical .agents/skills/<skill> path
 * Supports namespace: .agents/skills/{ns}/{skill-name}
 */
export function getCanonicalPath(
  skillName: string,
  options: { global?: boolean; cwd?: string; namespace?: string } = {}
): string {
  const sanitized = sanitizeName(skillName);
  const ns = options.namespace ? sanitizeNamespace(options.namespace) : undefined;
  const canonicalBase = getCanonicalSkillsDir(options.global ?? false, options.cwd);
  const canonicalPath = ns ? join(canonicalBase, ns, sanitized) : join(canonicalBase, sanitized);

  if (!isPathSafe(canonicalBase, canonicalPath)) {
    throw new Error('Invalid skill name: potential path traversal detected');
  }

  return canonicalPath;
}

/**
 * Install a Mintlify skill from a direct URL
 * The skill name is derived from the mintlify-proj frontmatter
 * Supports symlink mode (writes to canonical location and symlinks to agent dirs)
 * or copy mode (writes directly to each agent dir).
 * @deprecated Use installRemoteSkillForAgent instead
 */
export async function installMintlifySkillForAgent(
  skill: MintlifySkill,
  agentType: AgentType,
  options: { global?: boolean; cwd?: string; mode?: InstallMode; namespace?: string } = {}
): Promise<InstallResult> {
  const agent = agents[agentType];
  const isGlobal = options.global ?? false;
  const cwd = options.cwd || process.cwd();
  const installMode = options.mode ?? 'symlink';
  const ns = options.namespace ? sanitizeNamespace(options.namespace) : undefined;

  // Check if agent supports global installation
  if (isGlobal && agent.globalSkillsDir === undefined) {
    return {
      success: false,
      path: '',
      mode: installMode,
      error: `${agent.displayName} does not support global skill installation`,
    };
  }

  // Use mintlify-proj as the skill directory name (e.g., "bun.com")
  const skillName = sanitizeName(skill.mintlifySite);

  // Canonical location: .agents/skills/[namespace/]<skill-name>
  const canonicalBase = getCanonicalSkillsDir(isGlobal, cwd);
  const canonicalDir = ns ? join(canonicalBase, ns, skillName) : join(canonicalBase, skillName);

  // Agent-specific location (for symlink)
  const agentBase = isGlobal ? agent.globalSkillsDir! : join(cwd, agent.skillsDir);
  const agentDir = join(agentBase, skillName);

  // Validate paths
  if (!isPathSafe(canonicalBase, canonicalDir)) {
    return {
      success: false,
      path: agentDir,
      mode: installMode,
      error: 'Invalid skill name: potential path traversal detected',
    };
  }

  if (!isPathSafe(agentBase, agentDir)) {
    return {
      success: false,
      path: agentDir,
      mode: installMode,
      error: 'Invalid skill name: potential path traversal detected',
    };
  }

  try {
    // For copy mode, write directly to agent location
    if (installMode === 'copy') {
      await cleanAndCreateDirectory(agentDir);
      const skillMdPath = join(agentDir, 'SKILL.md');
      await writeFile(skillMdPath, skill.content, 'utf-8');

      return {
        success: true,
        path: agentDir,
        mode: 'copy',
      };
    }

    // Symlink mode: write to canonical location and symlink to agent location
    await cleanAndCreateDirectory(canonicalDir);
    const skillMdPath = join(canonicalDir, 'SKILL.md');
    await writeFile(skillMdPath, skill.content, 'utf-8');

    // For universal agents with global install, skip creating agent-specific symlink
    if (isGlobal && isUniversalAgent(agentType)) {
      return {
        success: true,
        path: canonicalDir,
        canonicalPath: canonicalDir,
        mode: 'symlink',
      };
    }

    const symlinkCreated = await createSymlink(canonicalDir, agentDir);

    if (!symlinkCreated) {
      // Symlink failed, fall back to copy
      await cleanAndCreateDirectory(agentDir);
      const agentSkillMdPath = join(agentDir, 'SKILL.md');
      await writeFile(agentSkillMdPath, skill.content, 'utf-8');

      return {
        success: true,
        path: agentDir,
        canonicalPath: canonicalDir,
        mode: 'symlink',
        symlinkFailed: true,
      };
    }

    return {
      success: true,
      path: agentDir,
      canonicalPath: canonicalDir,
      mode: 'symlink',
    };
  } catch (error) {
    return {
      success: false,
      path: agentDir,
      mode: installMode,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Install a remote skill from any host provider.
 * The skill directory name is derived from the installName field.
 * Supports symlink mode (writes to canonical location and symlinks to agent dirs)
 * or copy mode (writes directly to each agent dir).
 */
export async function installRemoteSkillForAgent(
  skill: RemoteSkill,
  agentType: AgentType,
  options: { global?: boolean; cwd?: string; mode?: InstallMode; namespace?: string } = {}
): Promise<InstallResult> {
  const agent = agents[agentType];
  const isGlobal = options.global ?? false;
  const cwd = options.cwd || process.cwd();
  const installMode = options.mode ?? 'symlink';
  const ns = options.namespace ? sanitizeNamespace(options.namespace) : undefined;

  // Check if agent supports global installation
  if (isGlobal && agent.globalSkillsDir === undefined) {
    return {
      success: false,
      path: '',
      mode: installMode,
      error: `${agent.displayName} does not support global skill installation`,
    };
  }

  // Use installName as the skill directory name
  const skillName = sanitizeName(skill.installName);

  // Canonical location: .agents/skills/[namespace/]<skill-name>
  const canonicalBase = getCanonicalSkillsDir(isGlobal, cwd);
  const canonicalDir = ns ? join(canonicalBase, ns, skillName) : join(canonicalBase, skillName);

  // Agent-specific location (for symlink)
  const agentBase = isGlobal ? agent.globalSkillsDir! : join(cwd, agent.skillsDir);
  const agentDir = join(agentBase, skillName);

  // Validate paths
  if (!isPathSafe(canonicalBase, canonicalDir)) {
    return {
      success: false,
      path: agentDir,
      mode: installMode,
      error: 'Invalid skill name: potential path traversal detected',
    };
  }

  if (!isPathSafe(agentBase, agentDir)) {
    return {
      success: false,
      path: agentDir,
      mode: installMode,
      error: 'Invalid skill name: potential path traversal detected',
    };
  }

  try {
    // For copy mode, write directly to agent location
    if (installMode === 'copy') {
      await cleanAndCreateDirectory(agentDir);
      const skillMdPath = join(agentDir, 'SKILL.md');
      await writeFile(skillMdPath, skill.content, 'utf-8');

      return {
        success: true,
        path: agentDir,
        mode: 'copy',
      };
    }

    // Symlink mode: write to canonical location and symlink to agent location
    await cleanAndCreateDirectory(canonicalDir);
    const skillMdPath = join(canonicalDir, 'SKILL.md');
    await writeFile(skillMdPath, skill.content, 'utf-8');

    // For universal agents with global install, skip creating agent-specific symlink
    if (isGlobal && isUniversalAgent(agentType)) {
      return {
        success: true,
        path: canonicalDir,
        canonicalPath: canonicalDir,
        mode: 'symlink',
      };
    }

    const symlinkCreated = await createSymlink(canonicalDir, agentDir);

    if (!symlinkCreated) {
      // Symlink failed, fall back to copy
      await cleanAndCreateDirectory(agentDir);
      const agentSkillMdPath = join(agentDir, 'SKILL.md');
      await writeFile(agentSkillMdPath, skill.content, 'utf-8');

      return {
        success: true,
        path: agentDir,
        canonicalPath: canonicalDir,
        mode: 'symlink',
        symlinkFailed: true,
      };
    }

    return {
      success: true,
      path: agentDir,
      canonicalPath: canonicalDir,
      mode: 'symlink',
    };
  } catch (error) {
    return {
      success: false,
      path: agentDir,
      mode: installMode,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Install a well-known skill with multiple files.
 * The skill directory name is derived from the installName field.
 * All files from the skill's files map are written to the installation directory.
 * Supports symlink mode (writes to canonical location and symlinks to agent dirs)
 * or copy mode (writes directly to each agent dir).
 */
export async function installWellKnownSkillForAgent(
  skill: WellKnownSkill,
  agentType: AgentType,
  options: { global?: boolean; cwd?: string; mode?: InstallMode; namespace?: string } = {}
): Promise<InstallResult> {
  const agent = agents[agentType];
  const isGlobal = options.global ?? false;
  const cwd = options.cwd || process.cwd();
  const installMode = options.mode ?? 'symlink';
  const ns = options.namespace ? sanitizeNamespace(options.namespace) : undefined;

  // Check if agent supports global installation
  if (isGlobal && agent.globalSkillsDir === undefined) {
    return {
      success: false,
      path: '',
      mode: installMode,
      error: `${agent.displayName} does not support global skill installation`,
    };
  }

  // Use installName as the skill directory name
  const skillName = sanitizeName(skill.installName);

  // Canonical location: .agents/skills/[namespace/]<skill-name>
  const canonicalBase = getCanonicalSkillsDir(isGlobal, cwd);
  const canonicalDir = ns ? join(canonicalBase, ns, skillName) : join(canonicalBase, skillName);

  // Agent-specific location (for symlink)
  const agentBase = isGlobal ? agent.globalSkillsDir! : join(cwd, agent.skillsDir);
  const agentDir = join(agentBase, skillName);

  // Validate paths
  if (!isPathSafe(canonicalBase, canonicalDir)) {
    return {
      success: false,
      path: agentDir,
      mode: installMode,
      error: 'Invalid skill name: potential path traversal detected',
    };
  }

  if (!isPathSafe(agentBase, agentDir)) {
    return {
      success: false,
      path: agentDir,
      mode: installMode,
      error: 'Invalid skill name: potential path traversal detected',
    };
  }

  /**
   * Write all skill files to a directory (assumes directory already exists)
   */
  async function writeSkillFiles(targetDir: string): Promise<void> {
    for (const [filePath, content] of skill.files) {
      // Validate file path doesn't escape the target directory
      const fullPath = join(targetDir, filePath);
      if (!isPathSafe(targetDir, fullPath)) {
        continue; // Skip files that would escape the directory
      }

      // Create parent directories if needed
      const parentDir = dirname(fullPath);
      if (parentDir !== targetDir) {
        await mkdir(parentDir, { recursive: true });
      }

      await writeFile(fullPath, content, 'utf-8');
    }
  }

  try {
    // For copy mode, write directly to agent location
    if (installMode === 'copy') {
      await cleanAndCreateDirectory(agentDir);
      await writeSkillFiles(agentDir);

      return {
        success: true,
        path: agentDir,
        mode: 'copy',
      };
    }

    // Symlink mode: write to canonical location and symlink to agent location
    await cleanAndCreateDirectory(canonicalDir);
    await writeSkillFiles(canonicalDir);

    // For universal agents with global install, skip creating agent-specific symlink
    if (isGlobal && isUniversalAgent(agentType)) {
      return {
        success: true,
        path: canonicalDir,
        canonicalPath: canonicalDir,
        mode: 'symlink',
      };
    }

    const symlinkCreated = await createSymlink(canonicalDir, agentDir);

    if (!symlinkCreated) {
      // Symlink failed, fall back to copy
      await cleanAndCreateDirectory(agentDir);
      await writeSkillFiles(agentDir);

      return {
        success: true,
        path: agentDir,
        canonicalPath: canonicalDir,
        mode: 'symlink',
        symlinkFailed: true,
      };
    }

    return {
      success: true,
      path: agentDir,
      canonicalPath: canonicalDir,
      mode: 'symlink',
    };
  } catch (error) {
    return {
      success: false,
      path: agentDir,
      mode: installMode,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export interface InstalledSkill {
  name: string;
  description: string;
  path: string;
  canonicalPath: string;
  scope: 'project' | 'global';
  agents: AgentType[];
  namespace?: string;
}

/**
 * Lists all installed skills from canonical locations
 * @param options - Options for listing skills
 * @returns Array of installed skills with metadata
 */
export async function listInstalledSkills(
  options: {
    global?: boolean;
    cwd?: string;
    agentFilter?: AgentType[];
  } = {}
): Promise<InstalledSkill[]> {
  const cwd = options.cwd || process.cwd();
  // Use a Map to deduplicate skills by scope:name
  const skillsMap: Map<string, InstalledSkill> = new Map();
  const scopes: Array<{ global: boolean; path: string; agentType?: AgentType }> = [];

  // Detect which agents are actually installed (fixes issue #225)
  const detectedAgents = await detectInstalledAgents();
  const agentFilter = options.agentFilter;
  const agentsToCheck = agentFilter
    ? detectedAgents.filter((a) => agentFilter.includes(a))
    : detectedAgents;

  // Determine which scopes to scan
  const scopeTypes: Array<{ global: boolean }> = [];
  if (options.global === undefined) {
    scopeTypes.push({ global: false }, { global: true });
  } else {
    scopeTypes.push({ global: options.global });
  }

  // Build list of directories to scan: canonical + each installed agent's directory
  for (const { global: isGlobal } of scopeTypes) {
    // Add canonical directory
    scopes.push({ global: isGlobal, path: getCanonicalSkillsDir(isGlobal, cwd) });

    // Add each installed agent's skills directory
    for (const agentType of agentsToCheck) {
      const agent = agents[agentType];
      if (isGlobal && agent.globalSkillsDir === undefined) {
        continue;
      }
      const agentDir = isGlobal ? agent.globalSkillsDir! : join(cwd, agent.skillsDir);
      // Avoid duplicate paths
      if (!scopes.some((s) => s.path === agentDir && s.global === isGlobal)) {
        scopes.push({ global: isGlobal, path: agentDir, agentType });
      }
    }
  }

  for (const scope of scopes) {
    try {
      // Recursively scan for skills with namespace support
      await scanSkillsDir(
        scope.path,
        '',
        scope.global,
        scope.agentType,
        detectedAgents,
        options,
        skillsMap,
        cwd
      );
    } catch {
      // Directory doesn't exist, skip
    }
  }

  return Array.from(skillsMap.values());
}

/**
 * Recursively scan a directory for skills, handling nested namespaces
 * @param dir - Directory to scan
 * @param nsPath - Current namespace path (e.g., 'obra/superpowers')
 * @param isGlobal - Whether this is a global scope
 * @param specificAgent - If set, we're scanning an agent-specific directory and should attribute skills directly
 * @param detectedAgents - List of detected agents
 * @param options - List options
 * @param skillsMap - Map to collect found skills (for deduplication)
 * @param cwd - Current working directory
 */
async function scanSkillsDir(
  dir: string,
  nsPath: string,
  isGlobal: boolean,
  specificAgent: AgentType | undefined,
  detectedAgents: AgentType[],
  options: { global?: boolean; cwd?: string; agentFilter?: AgentType[] },
  skillsMap: Map<string, InstalledSkill>,
  cwd: string
): Promise<void> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const entryPath = join(dir, entry.name);
      const skillMdPath = join(entryPath, 'SKILL.md');

      // Check if this directory contains a SKILL.md (it's a skill)
      try {
        await stat(skillMdPath);

        // This is a skill directory
        const skill = await parseSkillMd(skillMdPath);
        if (!skill) {
          continue;
        }

        const scopeKey = isGlobal ? 'global' : 'project';
        const ns = nsPath || undefined;
        const skillKey = ns ? `${scopeKey}:${ns}/${skill.name}` : `${scopeKey}:${skill.name}`;

        // If scanning an agent-specific directory, attribute directly to that agent
        if (specificAgent) {
          if (skillsMap.has(skillKey)) {
            const existing = skillsMap.get(skillKey)!;
            if (!existing.agents.includes(specificAgent)) {
              existing.agents.push(specificAgent);
            }
          } else {
            skillsMap.set(skillKey, {
              name: skill.name,
              description: skill.description,
              path: entryPath,
              canonicalPath: entryPath,
              scope: scopeKey,
              agents: [specificAgent],
              namespace: ns,
            });
          }
          continue;
        }

        // For canonical directory, check which agents have this skill
        const sanitizedSkillName = sanitizeName(skill.name);
        const installedAgents: AgentType[] = [];
        const agentFilter = options.agentFilter;
        const agentsToCheck = agentFilter
          ? detectedAgents.filter((a) => agentFilter.includes(a))
          : detectedAgents;

        for (const agentType of agentsToCheck) {
          const agent = agents[agentType];

          if (isGlobal && agent.globalSkillsDir === undefined) {
            continue;
          }

          const agentBase = isGlobal ? agent.globalSkillsDir! : join(cwd, agent.skillsDir);

          let found = false;

          // Try with full namespace path (e.g., obra/superpowers/skillname)
          const agentSkillDir = join(agentBase, nsPath, sanitizedSkillName);
          if (isPathSafe(agentBase, agentSkillDir)) {
            try {
              await access(agentSkillDir);
              found = true;
            } catch {
              // Try without namespace (legacy)
              const legacyDir = join(agentBase, sanitizedSkillName);
              if (isPathSafe(agentBase, legacyDir)) {
                try {
                  await access(legacyDir);
                  found = true;
                } catch {
                  // Not found
                }
              }
            }
          }

          if (found) {
            installedAgents.push(agentType);
          }
        }

        // Deduplicate: if skill already exists, merge agents
        if (skillsMap.has(skillKey)) {
          const existing = skillsMap.get(skillKey)!;
          for (const agent of installedAgents) {
            if (!existing.agents.includes(agent)) {
              existing.agents.push(agent);
            }
          }
        } else {
          skillsMap.set(skillKey, {
            name: skill.name,
            description: skill.description,
            path: entryPath,
            canonicalPath: entryPath,
            scope: scopeKey,
            agents: installedAgents,
            namespace: ns,
          });
        }
      } catch {
        // No SKILL.md, check if this is a namespace directory (contains subdirectories)
        try {
          const subEntries = await readdir(entryPath, { withFileTypes: true });
          const hasSubdirs = subEntries.some((e) => e.isDirectory());

          if (hasSubdirs) {
            // This is a namespace directory, recurse into it
            const newNsPath = nsPath ? `${nsPath}/${entry.name}` : entry.name;
            await scanSkillsDir(
              entryPath,
              newNsPath,
              isGlobal,
              specificAgent,
              detectedAgents,
              options,
              skillsMap,
              cwd
            );
          }
        } catch {
          // Can't read directory, skip
        }
      }
    }
  } catch {
    // Can't read directory, skip
  }
}
