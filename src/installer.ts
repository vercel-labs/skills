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
} from 'fs/promises';
import { join, basename, normalize, resolve, sep, relative, dirname } from 'path';
import { homedir, platform } from 'os';
import type { Skill, AgentType, MintlifySkill, RemoteSkill, CognitiveType } from './types.ts';
import type { WellKnownSkill } from './providers/wellknown.ts';
import {
  agents,
  detectInstalledAgents,
  isUniversalAgent,
  getCognitiveDir,
  isUniversalForType,
} from './agents.ts';
import { AGENTS_DIR, SKILLS_SUBDIR, COGNITIVE_SUBDIRS, COGNITIVE_FILE_NAMES } from './constants.ts';
import { parseSkillMd, parseCognitiveMd } from './skills.ts';

export type InstallMode = 'symlink' | 'copy';

interface InstallResult {
  success: boolean;
  path: string;
  canonicalPath?: string;
  mode: InstallMode;
  symlinkFailed?: boolean;
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
 * Gets the canonical .agents/<type> directory path for any cognitive type
 * @param cognitiveType - The cognitive type ('skill', 'agent', 'prompt')
 * @param global - Whether to use global (home) or project-level location
 * @param cwd - Current working directory for project-level installs
 */
export function getCanonicalDir(
  cognitiveType: CognitiveType,
  global: boolean,
  cwd?: string
): string {
  const baseDir = global ? homedir() : cwd || process.cwd();
  return join(baseDir, AGENTS_DIR, COGNITIVE_SUBDIRS[cognitiveType]);
}

/**
 * Gets the canonical .agents/skills directory path
 * @param global - Whether to use global (home) or project-level location
 * @param cwd - Current working directory for project-level installs
 */
export function getCanonicalSkillsDir(global: boolean, cwd?: string): string {
  return getCanonicalDir('skill', global, cwd);
}

function resolveSymlinkTarget(linkPath: string, linkTarget: string): string {
  return resolve(dirname(linkPath), linkTarget);
}

/**
 * Cleans and recreates a directory for skill installation.
 *
 * This ensures:
 * 1. Renamed/deleted files from previous installs are removed
 * 2. Symlinks (including self-referential ones causing ELOOP) are handled
 *    when canonical and agent paths resolve to the same location
 */
async function cleanAndCreateDirectory(path: string): Promise<void> {
  try {
    await rm(path, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors - mkdir will fail if there's a real problem
  }
  await mkdir(path, { recursive: true });
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
    await mkdir(linkDir, { recursive: true });

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

/**
 * Install a cognitive (skill, agent, or prompt) for a specific agent.
 * Copies files to the canonical .agents/<type>/<name> location and symlinks
 * to the agent-specific directory.
 */
export async function installCognitiveForAgent(
  cognitive: Skill,
  agentType: AgentType,
  options: {
    global?: boolean;
    cwd?: string;
    mode?: InstallMode;
    cognitiveType?: CognitiveType;
  } = {}
): Promise<InstallResult> {
  const cognitiveType = options.cognitiveType ?? 'skill';
  const agent = agents[agentType];
  const isGlobal = options.global ?? false;
  const cwd = options.cwd || process.cwd();

  // Check if agent supports global installation for this cognitive type
  const globalDir = getCognitiveDir(agentType, cognitiveType, 'global');
  if (isGlobal && globalDir === undefined) {
    return {
      success: false,
      path: '',
      mode: options.mode ?? 'symlink',
      error: `${agent.displayName} does not support global ${cognitiveType} installation`,
    };
  }

  // Sanitize name to prevent directory traversal
  const rawName = cognitive.name || basename(cognitive.path);
  const safeName = sanitizeName(rawName);

  // Canonical location: .agents/<type>/<name>
  const canonicalBase = getCanonicalDir(cognitiveType, isGlobal, cwd);
  const canonicalDir = join(canonicalBase, safeName);

  // Agent-specific location (for symlink)
  const localDir = getCognitiveDir(agentType, cognitiveType, 'local')!;
  const agentBase = isGlobal ? globalDir! : join(cwd, localDir);
  const agentDir = join(agentBase, safeName);

  const installMode = options.mode ?? 'symlink';

  // Validate paths
  if (!isPathSafe(canonicalBase, canonicalDir)) {
    return {
      success: false,
      path: agentDir,
      mode: installMode,
      error: `Invalid ${cognitiveType} name: potential path traversal detected`,
    };
  }

  if (!isPathSafe(agentBase, agentDir)) {
    return {
      success: false,
      path: agentDir,
      mode: installMode,
      error: `Invalid ${cognitiveType} name: potential path traversal detected`,
    };
  }

  try {
    // For copy mode, skip canonical directory and copy directly to agent location
    if (installMode === 'copy') {
      await cleanAndCreateDirectory(agentDir);
      await copyDirectory(cognitive.path, agentDir);

      return {
        success: true,
        path: agentDir,
        mode: 'copy',
      };
    }

    // Symlink mode: copy to canonical location and symlink to agent location
    await cleanAndCreateDirectory(canonicalDir);
    await copyDirectory(cognitive.path, canonicalDir);

    // For universal agents with global install, the cognitive is already in the canonical
    // ~/.agents/<type> directory. Skip creating a symlink to avoid duplicates.
    if (isGlobal && isUniversalForType(agentType, cognitiveType)) {
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
      await copyDirectory(cognitive.path, agentDir);

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
 * Install a skill for a specific agent (backward-compatible wrapper).
 */
export async function installSkillForAgent(
  skill: Skill,
  agentType: AgentType,
  options: { global?: boolean; cwd?: string; mode?: InstallMode } = {}
): Promise<InstallResult> {
  return installCognitiveForAgent(skill, agentType, { ...options, cognitiveType: 'skill' });
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
  await mkdir(dest, { recursive: true });

  const entries = await readdir(src, { withFileTypes: true });

  // Copy files and directories in parallel
  await Promise.all(
    entries
      .filter((entry) => !isExcluded(entry.name, entry.isDirectory()))
      .map(async (entry) => {
        const srcPath = join(src, entry.name);
        const destPath = join(dest, entry.name);

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
      })
  );
}

/**
 * Check if a cognitive (skill, agent, or prompt) is installed for a specific agent.
 */
export async function isCognitiveInstalled(
  name: string,
  agentType: AgentType,
  cognitiveType: CognitiveType,
  options: { global?: boolean; cwd?: string } = {}
): Promise<boolean> {
  const sanitized = sanitizeName(name);

  // Check if agent supports global installation for this cognitive type
  const globalDir = getCognitiveDir(agentType, cognitiveType, 'global');
  if (options.global && globalDir === undefined) {
    return false;
  }

  const localDir = getCognitiveDir(agentType, cognitiveType, 'local')!;
  const targetBase = options.global ? globalDir! : join(options.cwd || process.cwd(), localDir);

  const cognitiveDir = join(targetBase, sanitized);

  if (!isPathSafe(targetBase, cognitiveDir)) {
    return false;
  }

  try {
    await access(cognitiveDir);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if a skill is installed for a specific agent (backward-compatible wrapper).
 */
export async function isSkillInstalled(
  skillName: string,
  agentType: AgentType,
  options: { global?: boolean; cwd?: string; cognitiveType?: CognitiveType } = {}
): Promise<boolean> {
  return isCognitiveInstalled(skillName, agentType, options.cognitiveType ?? 'skill', options);
}

export function getInstallPath(
  skillName: string,
  agentType: AgentType,
  options: { global?: boolean; cwd?: string; cognitiveType?: CognitiveType } = {}
): string {
  const cognitiveType = options.cognitiveType ?? 'skill';
  const cwd = options.cwd || process.cwd();
  const sanitized = sanitizeName(skillName);

  const globalDir = getCognitiveDir(agentType, cognitiveType, 'global');
  const localDir = getCognitiveDir(agentType, cognitiveType, 'local')!;

  // Agent doesn't support global installation, fall back to project path
  const targetBase = options.global && globalDir !== undefined ? globalDir : join(cwd, localDir);

  const installPath = join(targetBase, sanitized);

  if (!isPathSafe(targetBase, installPath)) {
    throw new Error(`Invalid ${cognitiveType} name: potential path traversal detected`);
  }

  return installPath;
}

/**
 * Gets the canonical .agents/<type>/<name> path
 */
export function getCanonicalPath(
  skillName: string,
  options: { global?: boolean; cwd?: string; cognitiveType?: CognitiveType } = {}
): string {
  const cognitiveType = options.cognitiveType ?? 'skill';
  const sanitized = sanitizeName(skillName);
  const canonicalBase = getCanonicalDir(cognitiveType, options.global ?? false, options.cwd);
  const canonicalPath = join(canonicalBase, sanitized);

  if (!isPathSafe(canonicalBase, canonicalPath)) {
    throw new Error(`Invalid ${cognitiveType} name: potential path traversal detected`);
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
  options: { global?: boolean; cwd?: string; mode?: InstallMode } = {}
): Promise<InstallResult> {
  const agent = agents[agentType];
  const isGlobal = options.global ?? false;
  const cwd = options.cwd || process.cwd();
  const installMode = options.mode ?? 'symlink';

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

  // Canonical location: .agents/skills/<skill-name>
  const canonicalBase = getCanonicalSkillsDir(isGlobal, cwd);
  const canonicalDir = join(canonicalBase, skillName);

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
  options: {
    global?: boolean;
    cwd?: string;
    mode?: InstallMode;
    cognitiveType?: CognitiveType;
  } = {}
): Promise<InstallResult> {
  const cognitiveType = options.cognitiveType ?? skill.cognitiveType ?? 'skill';
  const agent = agents[agentType];
  const isGlobal = options.global ?? false;
  const cwd = options.cwd || process.cwd();
  const installMode = options.mode ?? 'symlink';
  const fileName = COGNITIVE_FILE_NAMES[cognitiveType];

  // Check if agent supports global installation for this cognitive type
  const globalDir = getCognitiveDir(agentType, cognitiveType, 'global');
  if (isGlobal && globalDir === undefined) {
    return {
      success: false,
      path: '',
      mode: installMode,
      error: `${agent.displayName} does not support global ${cognitiveType} installation`,
    };
  }

  // Use installName as the skill directory name
  const skillName = sanitizeName(skill.installName);

  // Canonical location: .agents/<type>/<skill-name>
  const canonicalBase = getCanonicalDir(cognitiveType, isGlobal, cwd);
  const canonicalDir = join(canonicalBase, skillName);

  // Agent-specific location (for symlink)
  const localDir = getCognitiveDir(agentType, cognitiveType, 'local')!;
  const agentBase = isGlobal ? globalDir! : join(cwd, localDir);
  const agentDir = join(agentBase, skillName);

  // Validate paths
  if (!isPathSafe(canonicalBase, canonicalDir)) {
    return {
      success: false,
      path: agentDir,
      mode: installMode,
      error: `Invalid ${cognitiveType} name: potential path traversal detected`,
    };
  }

  if (!isPathSafe(agentBase, agentDir)) {
    return {
      success: false,
      path: agentDir,
      mode: installMode,
      error: `Invalid ${cognitiveType} name: potential path traversal detected`,
    };
  }

  try {
    // For copy mode, write directly to agent location
    if (installMode === 'copy') {
      await cleanAndCreateDirectory(agentDir);
      const mdPath = join(agentDir, fileName);
      await writeFile(mdPath, skill.content, 'utf-8');

      return {
        success: true,
        path: agentDir,
        mode: 'copy',
      };
    }

    // Symlink mode: write to canonical location and symlink to agent location
    await cleanAndCreateDirectory(canonicalDir);
    const mdPath = join(canonicalDir, fileName);
    await writeFile(mdPath, skill.content, 'utf-8');

    // For universal agents with global install, skip creating agent-specific symlink
    if (isGlobal && isUniversalForType(agentType, cognitiveType)) {
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
      const agentMdPath = join(agentDir, fileName);
      await writeFile(agentMdPath, skill.content, 'utf-8');

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
  options: {
    global?: boolean;
    cwd?: string;
    mode?: InstallMode;
    cognitiveType?: CognitiveType;
  } = {}
): Promise<InstallResult> {
  const cognitiveType = options.cognitiveType ?? 'skill';
  const agent = agents[agentType];
  const isGlobal = options.global ?? false;
  const cwd = options.cwd || process.cwd();
  const installMode = options.mode ?? 'symlink';

  // Check if agent supports global installation for this cognitive type
  const globalDir = getCognitiveDir(agentType, cognitiveType, 'global');
  if (isGlobal && globalDir === undefined) {
    return {
      success: false,
      path: '',
      mode: installMode,
      error: `${agent.displayName} does not support global ${cognitiveType} installation`,
    };
  }

  // Use installName as the skill directory name
  const skillName = sanitizeName(skill.installName);

  // Canonical location: .agents/<type>/<skill-name>
  const canonicalBase = getCanonicalDir(cognitiveType, isGlobal, cwd);
  const canonicalDir = join(canonicalBase, skillName);

  // Agent-specific location (for symlink)
  const localDir = getCognitiveDir(agentType, cognitiveType, 'local')!;
  const agentBase = isGlobal ? globalDir! : join(cwd, localDir);
  const agentDir = join(agentBase, skillName);

  // Validate paths
  if (!isPathSafe(canonicalBase, canonicalDir)) {
    return {
      success: false,
      path: agentDir,
      mode: installMode,
      error: `Invalid ${cognitiveType} name: potential path traversal detected`,
    };
  }

  if (!isPathSafe(agentBase, agentDir)) {
    return {
      success: false,
      path: agentDir,
      mode: installMode,
      error: `Invalid ${cognitiveType} name: potential path traversal detected`,
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
    if (isGlobal && isUniversalForType(agentType, cognitiveType)) {
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
  cognitiveType: CognitiveType;
}

/**
 * Lists all installed cognitives (skills, agents, prompts) from canonical locations.
 * Scans .agents/skills/, .agents/agents/, .agents/prompts/ directories and
 * looks for the corresponding file (SKILL.md, AGENT.md, PROMPT.md) in each.
 * @param options - Options for listing cognitives
 * @returns Array of installed cognitives with metadata
 */
export async function listInstalledCognitives(
  options: {
    global?: boolean;
    cwd?: string;
    agentFilter?: AgentType[];
    typeFilter?: CognitiveType[];
  } = {}
): Promise<InstalledSkill[]> {
  const cwd = options.cwd || process.cwd();
  const typesToScan: CognitiveType[] = options.typeFilter ?? ['skill', 'agent', 'prompt'];
  // Use a Map to deduplicate by scope:type:name
  const cognitivesMap: Map<string, InstalledSkill> = new Map();

  // Detect which agents are actually installed
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

  for (const cognitiveType of typesToScan) {
    const fileName = COGNITIVE_FILE_NAMES[cognitiveType];
    const scopes: Array<{ global: boolean; path: string; agentType?: AgentType }> = [];

    // Build list of directories to scan: canonical + each installed agent's directory
    //
    // Scanning workflow:
    //
    //   detectInstalledAgents()
    //            |
    //            v
    //   for each scope (project / global)
    //            |
    //            +-->  scan canonical dir -->  .agents/<type>, ~/.agents/<type>
    //            |
    //            +-->  scan each installed agent's dir -->  .cursor/<type>, .claude/<type>, ...
    //            |
    //            v
    //   deduplicate by cognitive name
    //
    // Trade-off: More readdir() calls, but most non-existent dirs fail fast.
    // Cognitives in agent-specific dirs skip the expensive "check all agents" loop.
    //
    for (const { global: isGlobal } of scopeTypes) {
      // Add canonical directory
      scopes.push({ global: isGlobal, path: getCanonicalDir(cognitiveType, isGlobal, cwd) });

      // Add each installed agent's directory for this cognitive type
      for (const agentType of agentsToCheck) {
        const globalDir = getCognitiveDir(agentType, cognitiveType, 'global');
        if (isGlobal && globalDir === undefined) {
          continue;
        }
        const localDir = getCognitiveDir(agentType, cognitiveType, 'local')!;
        const agentDir = isGlobal ? globalDir! : join(cwd, localDir);
        // Avoid duplicate paths
        if (!scopes.some((s) => s.path === agentDir && s.global === isGlobal)) {
          scopes.push({ global: isGlobal, path: agentDir, agentType });
        }
      }
    }

    for (const scope of scopes) {
      try {
        const entries = await readdir(scope.path, { withFileTypes: true });

        for (const entry of entries) {
          if (!entry.isDirectory()) {
            continue;
          }

          const cognitiveDir = join(scope.path, entry.name);
          const mdPath = join(cognitiveDir, fileName);

          // Check if the cognitive file exists
          try {
            await stat(mdPath);
          } catch {
            // Cognitive file doesn't exist, skip this directory
            continue;
          }

          // Parse the cognitive - use parseCognitiveMd for agent/prompt types, parseSkillMd for skills
          const parsed =
            cognitiveType === 'skill' ? await parseSkillMd(mdPath) : await parseCognitiveMd(mdPath);
          if (!parsed) {
            continue;
          }

          const scopeKey = scope.global ? 'global' : 'project';
          const cognitiveKey = `${scopeKey}:${cognitiveType}:${parsed.name}`;

          // If scanning an agent-specific directory, attribute directly to that agent
          if (scope.agentType) {
            if (cognitivesMap.has(cognitiveKey)) {
              const existing = cognitivesMap.get(cognitiveKey)!;
              if (!existing.agents.includes(scope.agentType)) {
                existing.agents.push(scope.agentType);
              }
            } else {
              cognitivesMap.set(cognitiveKey, {
                name: parsed.name,
                description: parsed.description,
                path: cognitiveDir,
                canonicalPath: cognitiveDir,
                scope: scopeKey,
                agents: [scope.agentType],
                cognitiveType,
              });
            }
            continue;
          }

          // For canonical directory, check which agents have this cognitive
          const sanitizedName = sanitizeName(parsed.name);
          const installedAgents: AgentType[] = [];

          for (const agentType of agentsToCheck) {
            const globalDir = getCognitiveDir(agentType, cognitiveType, 'global');

            if (scope.global && globalDir === undefined) {
              continue;
            }

            const localDir = getCognitiveDir(agentType, cognitiveType, 'local')!;
            const agentBase = scope.global ? globalDir! : join(cwd, localDir);
            let found = false;

            // Try exact directory name matches
            const possibleNames = Array.from(
              new Set([
                entry.name,
                sanitizedName,
                parsed.name
                  .toLowerCase()
                  .replace(/\s+/g, '-')
                  .replace(/[\/\\:\0]/g, ''),
              ])
            );

            for (const possibleName of possibleNames) {
              const agentCognitiveDir = join(agentBase, possibleName);
              if (!isPathSafe(agentBase, agentCognitiveDir)) continue;

              try {
                await access(agentCognitiveDir);
                found = true;
                break;
              } catch {
                // Try next name
              }
            }

            // Fallback: scan all directories and check cognitive files
            // Handles cases where directory names don't match
            if (!found) {
              try {
                const agentEntries = await readdir(agentBase, { withFileTypes: true });
                for (const agentEntry of agentEntries) {
                  if (!agentEntry.isDirectory()) continue;

                  const candidateDir = join(agentBase, agentEntry.name);
                  if (!isPathSafe(agentBase, candidateDir)) continue;

                  try {
                    const candidateMdPath = join(candidateDir, fileName);
                    await stat(candidateMdPath);
                    const candidateParsed =
                      cognitiveType === 'skill'
                        ? await parseSkillMd(candidateMdPath)
                        : await parseCognitiveMd(candidateMdPath);
                    if (candidateParsed && candidateParsed.name === parsed.name) {
                      found = true;
                      break;
                    }
                  } catch {
                    // Not a valid cognitive directory
                  }
                }
              } catch {
                // Agent base directory doesn't exist
              }
            }

            if (found) {
              installedAgents.push(agentType);
            }
          }

          if (cognitivesMap.has(cognitiveKey)) {
            // Merge agents
            const existing = cognitivesMap.get(cognitiveKey)!;
            for (const agent of installedAgents) {
              if (!existing.agents.includes(agent)) {
                existing.agents.push(agent);
              }
            }
          } else {
            cognitivesMap.set(cognitiveKey, {
              name: parsed.name,
              description: parsed.description,
              path: cognitiveDir,
              canonicalPath: cognitiveDir,
              scope: scopeKey,
              agents: installedAgents,
              cognitiveType,
            });
          }
        }
      } catch {
        // Directory doesn't exist, skip
      }
    }
  }

  return Array.from(cognitivesMap.values());
}

/**
 * Lists all installed skills from canonical locations (backward-compatible wrapper).
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
  return listInstalledCognitives({ ...options, typeFilter: ['skill'] });
}
