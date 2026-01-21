import { mkdir, cp, access, readdir, writeFile } from "fs/promises";
import { join, basename, normalize, resolve, sep } from "path";
import type { Skill, AgentType, MintlifySkill } from "./types.js";
import { agents } from "./agents.js";

const AGENTS_DIR = '.agents';
const SKILLS_SUBDIR = 'skills';

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
 * @param name - The name to sanitize
 * @returns Sanitized name safe for use in file paths
 */
function sanitizeName(name: string): string {
  // Remove any path separators and null bytes
  let sanitized = name.replace(/[\/\\:\0]/g, "");

  // Remove leading/trailing dots and spaces
  sanitized = sanitized.replace(/^[.\s]+|[.\s]+$/g, "");

  // Replace any remaining dots at the start (to prevent ..)
  sanitized = sanitized.replace(/^\.+/, "");

  // If the name becomes empty after sanitization, use a default
  if (!sanitized || sanitized.length === 0) {
    sanitized = "unnamed-skill";
  }

  // Limit length to prevent issues
  if (sanitized.length > 255) {
    sanitized = sanitized.substring(0, 255);
  }

  return sanitized;
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

  return (
    normalizedTarget.startsWith(normalizedBase + sep) ||
    normalizedTarget === normalizedBase
  );
}

/**
 * Gets the canonical .agents/skills directory path
 * @param global - Whether to use global (home) or project-level location
 * @param cwd - Current working directory for project-level installs
 */
function getCanonicalSkillsDir(global: boolean, cwd?: string): string {
  const baseDir = global ? homedir() : (cwd || process.cwd());
  return join(baseDir, AGENTS_DIR, SKILLS_SUBDIR);
}

/**
 * Creates a symlink, handling cross-platform differences
 * Returns true if symlink was created, false if fallback to copy is needed
 */
async function createSymlink(target: string, linkPath: string): Promise<boolean> {
  try {
    try {
      const stats = await lstat(linkPath);
      if (stats.isSymbolicLink()) {
        const existingTarget = await readlink(linkPath);
        if (resolve(existingTarget) === resolve(target)) {
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

    const linkDir = join(linkPath, '..');
    await mkdir(linkDir, { recursive: true });

    const relativePath = relative(linkDir, target);
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
  options: { global?: boolean; cwd?: string } = {},
): Promise<InstallResult> {
  const agent = agents[agentType];

  // Sanitize skill name to prevent directory traversal
  const rawSkillName = skill.name || basename(skill.path);
  const skillName = sanitizeName(rawSkillName);

  const targetBase = options.global
    ? agent.globalSkillsDir
    : join(options.cwd || process.cwd(), agent.skillsDir);

  const targetDir = join(targetBase, skillName);

  // Validate that the target directory is within the expected base
  if (!isPathSafe(targetBase, targetDir)) {
    return {
      success: false,
      path: targetDir,
      error: "Invalid skill name: potential path traversal detected",
    };
  }

  try {
    // For copy mode, skip canonical directory and copy directly to agent location
    if (installMode === 'copy') {
      await mkdir(agentDir, { recursive: true });
      await copyDirectory(skill.path, agentDir);
      
      return {
        success: true,
        path: agentDir,
        mode: 'copy',
      };
    }
    
    // Symlink mode: copy to canonical location and symlink to agent location
    await mkdir(canonicalDir, { recursive: true });
    await copyDirectory(skill.path, canonicalDir);

    const symlinkCreated = await createSymlink(canonicalDir, agentDir);
    
    if (!symlinkCreated) {
      // Clean up any existing broken symlink before copying
      try {
        await rm(agentDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
      await mkdir(agentDir, { recursive: true });
      await copyDirectory(skill.path, agentDir);
      
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
      path: targetDir,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

const EXCLUDE_FILES = new Set(["README.md", "metadata.json"]);

const isExcluded = (name: string): boolean => {
  if (EXCLUDE_FILES.has(name)) return true;
  if (name.startsWith("_")) return true; // Templates, section definitions
  return false;
};

async function copyDirectory(src: string, dest: string): Promise<void> {
  await mkdir(dest, { recursive: true });

  const entries = await readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    if (isExcluded(entry.name)) {
      continue;
    }

    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);

    if (entry.isDirectory()) {
      await copyDirectory(srcPath, destPath);
    } else {
      await cp(srcPath, destPath);
    }
  }
}

export async function isSkillInstalled(
  skillName: string,
  agentType: AgentType,
  options: { global?: boolean; cwd?: string } = {},
): Promise<boolean> {
  const agent = agents[agentType];

  // Sanitize skill name
  const sanitized = sanitizeName(skillName);

  const targetBase = options.global
    ? agent.globalSkillsDir
    : join(options.cwd || process.cwd(), agent.skillsDir);

  const skillDir = join(targetBase, sanitized);

  // Validate path safety
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
  options: { global?: boolean; cwd?: string } = {},
): string {
  const agent = agents[agentType];

  // Sanitize skill name
  const sanitized = sanitizeName(skillName);

  const targetBase = options.global
    ? agent.globalSkillsDir
    : join(options.cwd || process.cwd(), agent.skillsDir);

  const installPath = join(targetBase, sanitized);

  // Validate path safety
  if (!isPathSafe(targetBase, installPath)) {
    throw new Error("Invalid skill name: potential path traversal detected");
  }

  return installPath;
}

/**
 * Install a Mintlify skill from a direct URL
 * The skill name is derived from the mintlify-proj frontmatter
 */
export async function installMintlifySkillForAgent(
  skill: MintlifySkill,
  agentType: AgentType,
  options: { global?: boolean; cwd?: string } = {},
): Promise<InstallResult> {
  const agent = agents[agentType];

  // Use mintlify-proj as the skill directory name (e.g., "bun.com")
  const skillName = sanitizeName(skill.mintlifySite);

  const targetBase = options.global
    ? agent.globalSkillsDir
    : join(options.cwd || process.cwd(), agent.skillsDir);

  const targetDir = join(targetBase, skillName);

  // Validate that the target directory is within the expected base
  if (!isPathSafe(targetBase, targetDir)) {
    return {
      success: false,
      path: targetDir,
      error: "Invalid skill name: potential path traversal detected",
    };
  }

  try {
    await mkdir(targetDir, { recursive: true });

    // Write the SKILL.md content directly
    const skillMdPath = join(targetDir, "SKILL.md");
    await writeFile(skillMdPath, skill.content, "utf-8");

    return { success: true, path: targetDir };
  } catch (error) {
    return {
      success: false,
      path: targetDir,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
