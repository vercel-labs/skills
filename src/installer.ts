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
import { existsSync } from 'fs';
import { join, basename, normalize, resolve, sep, relative, dirname } from 'path';
import { homedir, platform } from 'os';
import type { Agent, TargetType, RemoteAgent } from './types.ts';
import type { WellKnownAgent } from './providers/wellknown.ts';
import { targets, detectInstalledTargets, isUniversalTarget } from './targets.ts';
import { AGENTS_DIR, AGENTS_SUBDIR } from './constants.ts';
import { parseAgentMd } from './agents.ts';

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

  // Limit to 255 chars (common filesystem limit), fallback to 'unnamed-agent' if empty
  return sanitized.substring(0, 255) || 'unnamed-agent';
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

export function getCanonicalAgentsDir(global: boolean, cwd?: string): string {
  const baseDir = global ? homedir() : cwd || process.cwd();
  return join(baseDir, AGENTS_DIR, AGENTS_SUBDIR);
}

/**
 * Gets the base directory for an agent's agents, respecting universal agents.
 * Universal agents always use the canonical directory, which prevents
 * redundant symlinks and double-listing of agents.
 */
export function getTargetBaseDir(targetType: TargetType, global: boolean, cwd?: string): string {
  if (isUniversalTarget(targetType)) {
    return getCanonicalAgentsDir(global, cwd);
  }

  const target = targets[targetType];
  const baseDir = global ? homedir() : cwd || process.cwd();

  if (global) {
    if (target.globalAgentsDir === undefined) {
      // This should be caught by callers checking support
      return join(baseDir, target.agentsDir);
    }
    return target.globalAgentsDir;
  }

  return join(baseDir, target.agentsDir);
}

function resolveSymlinkTarget(linkPath: string, linkTarget: string): string {
  return resolve(dirname(linkPath), linkTarget);
}

/**
 * Cleans and recreates a directory for agent installation.
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
 * This handles the case where a parent directory (e.g., ~/.claude/agents) is a symlink
 * to another location (e.g., ~/.agents/agents). In that case, computing relative paths
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

    // Use realpath to handle cases where parent directories are symlinked.
    // This prevents deleting the canonical directory if the agent directory
    // is a symlink to the canonical location.
    const [realTarget, realLinkPath] = await Promise.all([
      realpath(resolvedTarget).catch(() => resolvedTarget),
      realpath(resolvedLinkPath).catch(() => resolvedLinkPath),
    ]);

    if (realTarget === realLinkPath) {
      return true;
    }

    // Also check with symlinks resolved in parent directories.
    // This handles cases where e.g. ~/.claude/agents is a symlink to ~/.agents/agents,
    // so ~/.claude/agents/<agent> and ~/.agents/agents/<agent> are physically the same.
    const realTargetWithParents = await resolveParentSymlinks(target);
    const realLinkPathWithParents = await resolveParentSymlinks(linkPath);

    if (realTargetWithParents === realLinkPathWithParents) {
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

export async function installAgentForTarget(
  agent: Agent,
  targetType: TargetType,
  options: { global?: boolean; cwd?: string; mode?: InstallMode } = {}
): Promise<InstallResult> {
  const target = targets[targetType];
  const isGlobal = options.global ?? false;
  const cwd = options.cwd || process.cwd();

  // Check if agent supports global installation
  if (isGlobal && target.globalAgentsDir === undefined) {
    return {
      success: false,
      path: '',
      mode: options.mode ?? 'symlink',
      error: `${target.displayName} does not support global agent installation`,
    };
  }

  // Sanitize agent name to prevent directory traversal
  const rawAgentName = agent.name || basename(agent.path);
  const agentName = sanitizeName(rawAgentName);

  // Canonical location: .agents/agents/<agent-name>
  const canonicalBase = getCanonicalAgentsDir(isGlobal, cwd);
  const canonicalDir = join(canonicalBase, agentName);

  // Agent-specific location (for symlink)
  const targetBase = getTargetBaseDir(targetType, isGlobal, cwd);
  const targetDir = join(targetBase, agentName);

  const installMode = options.mode ?? 'symlink';

  // Validate paths
  if (!isPathSafe(canonicalBase, canonicalDir)) {
    return {
      success: false,
      path: targetDir,
      mode: installMode,
      error: 'Invalid agent name: potential path traversal detected',
    };
  }

  if (!isPathSafe(targetBase, targetDir)) {
    return {
      success: false,
      path: targetDir,
      mode: installMode,
      error: 'Invalid agent name: potential path traversal detected',
    };
  }

  try {
    // For copy mode, skip canonical directory and copy directly to agent location
    if (installMode === 'copy') {
      await cleanAndCreateDirectory(targetDir);
      await copyDirectory(agent.path, targetDir);

      return {
        success: true,
        path: targetDir,
        mode: 'copy',
      };
    }

    // Symlink mode: copy to canonical location and symlink to agent location
    await cleanAndCreateDirectory(canonicalDir);
    await copyDirectory(agent.path, canonicalDir);

    // For universal agents with global install, the agent is already in the canonical
    // ~/.agents/agents directory. Skip creating a symlink to the agent-specific global dir
    // (e.g. ~/.copilot/agents) to avoid duplicates.
    if (isGlobal && isUniversalTarget(targetType)) {
      return {
        success: true,
        path: canonicalDir,
        canonicalPath: canonicalDir,
        mode: 'symlink',
      };
    }

    const symlinkCreated = await createSymlink(canonicalDir, targetDir);

    if (!symlinkCreated) {
      // Symlink failed, fall back to copy
      await cleanAndCreateDirectory(targetDir);
      await copyDirectory(agent.path, targetDir);

      return {
        success: true,
        path: targetDir,
        canonicalPath: canonicalDir,
        mode: 'symlink',
        symlinkFailed: true,
      };
    }

    return {
      success: true,
      path: targetDir,
      canonicalPath: canonicalDir,
      mode: 'symlink',
    };
  } catch (error) {
    return {
      success: false,
      path: targetDir,
      mode: installMode,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

const EXCLUDE_FILES = new Set(['metadata.json']);
const EXCLUDE_DIRS = new Set(['.git', '__pycache__', '__pypackages__']);

const isExcluded = (name: string, isDirectory: boolean = false): boolean => {
  if (EXCLUDE_FILES.has(name)) return true;
  if (name.startsWith('.')) return true;
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
          try {
            await cp(srcPath, destPath, {
              // If the file is a symlink to elsewhere in a remote agent, it may not
              // resolve correctly once it has been copied to the local location.
              // `dereference: true` tells Node to copy the file instead of copying
              // the symlink. `recursive: true` handles symlinks pointing to directories.
              dereference: true,
              recursive: true,
            });
          } catch (err: unknown) {
            // Skip broken symlinks (e.g., pointing to absolute paths on another machine)
            // instead of aborting the entire install.
            if (
              err instanceof Error &&
              'code' in err &&
              (err as NodeJS.ErrnoException).code === 'ENOENT' &&
              entry.isSymbolicLink()
            ) {
              console.warn(`Skipping broken symlink: ${srcPath}`);
            } else {
              throw err;
            }
          }
        }
      })
  );
}

export async function isAgentInstalled(
  agentName: string,
  targetType: TargetType,
  options: { global?: boolean; cwd?: string } = {}
): Promise<boolean> {
  const target = targets[targetType];
  const sanitized = sanitizeName(agentName);

  // Agent doesn't support global installation
  if (options.global && target.globalAgentsDir === undefined) {
    return false;
  }

  const targetBase = options.global
    ? target.globalAgentsDir!
    : join(options.cwd || process.cwd(), target.agentsDir);

  const agentDir = join(targetBase, sanitized);

  if (!isPathSafe(targetBase, agentDir)) {
    return false;
  }

  try {
    await access(agentDir);
    return true;
  } catch {
    return false;
  }
}

export function getInstallPath(
  agentName: string,
  targetType: TargetType,
  options: { global?: boolean; cwd?: string } = {}
): string {
  const target = targets[targetType];
  const cwd = options.cwd || process.cwd();
  const sanitized = sanitizeName(agentName);

  const targetBase = getTargetBaseDir(targetType, options.global ?? false, options.cwd);
  const installPath = join(targetBase, sanitized);

  if (!isPathSafe(targetBase, installPath)) {
    throw new Error('Invalid agent name: potential path traversal detected');
  }

  return installPath;
}

/**
 * Gets the canonical .agents/agents/<agent> path
 */
export function getCanonicalPath(
  agentName: string,
  options: { global?: boolean; cwd?: string } = {}
): string {
  const sanitized = sanitizeName(agentName);
  const canonicalBase = getCanonicalAgentsDir(options.global ?? false, options.cwd);
  const canonicalPath = join(canonicalBase, sanitized);

  if (!isPathSafe(canonicalBase, canonicalPath)) {
    throw new Error('Invalid agent name: potential path traversal detected');
  }

  return canonicalPath;
}

/**
 * Install a remote agent from any host provider.
 * The agent directory name is derived from the installName field.
 * Supports symlink mode (writes to canonical location and symlinks to agent dirs)
 * or copy mode (writes directly to each agent dir).
 */
export async function installRemoteAgentForTarget(
  agent: RemoteAgent,
  targetType: TargetType,
  options: { global?: boolean; cwd?: string; mode?: InstallMode } = {}
): Promise<InstallResult> {
  const target = targets[targetType];
  const isGlobal = options.global ?? false;
  const cwd = options.cwd || process.cwd();
  const installMode = options.mode ?? 'symlink';

  // Check if agent supports global installation
  if (isGlobal && target.globalAgentsDir === undefined) {
    return {
      success: false,
      path: '',
      mode: installMode,
      error: `${target.displayName} does not support global agent installation`,
    };
  }

  // Use installName as the agent directory name
  const agentName = sanitizeName(agent.installName);

  // Canonical location: .agents/agents/<agent-name>
  const canonicalBase = getCanonicalAgentsDir(isGlobal, cwd);
  const canonicalDir = join(canonicalBase, agentName);

  // Agent-specific location (for symlink)
  const targetBase = getTargetBaseDir(targetType, isGlobal, cwd);
  const targetDir = join(targetBase, agentName);

  // Validate paths
  if (!isPathSafe(canonicalBase, canonicalDir)) {
    return {
      success: false,
      path: targetDir,
      mode: installMode,
      error: 'Invalid agent name: potential path traversal detected',
    };
  }

  if (!isPathSafe(targetBase, targetDir)) {
    return {
      success: false,
      path: targetDir,
      mode: installMode,
      error: 'Invalid agent name: potential path traversal detected',
    };
  }

  try {
    // For copy mode, write directly to agent location
    if (installMode === 'copy') {
      await cleanAndCreateDirectory(targetDir);
      const agentMdPath = join(targetDir, 'AGENT.md');
      await writeFile(agentMdPath, agent.content, 'utf-8');

      return {
        success: true,
        path: targetDir,
        mode: 'copy',
      };
    }

    // Symlink mode: write to canonical location and symlink to agent location
    await cleanAndCreateDirectory(canonicalDir);
    const agentMdPath = join(canonicalDir, 'AGENT.md');
    await writeFile(agentMdPath, agent.content, 'utf-8');

    // For universal agents with global install, skip creating agent-specific symlink
    if (isGlobal && isUniversalTarget(targetType)) {
      return {
        success: true,
        path: canonicalDir,
        canonicalPath: canonicalDir,
        mode: 'symlink',
      };
    }

    const symlinkCreated = await createSymlink(canonicalDir, targetDir);

    if (!symlinkCreated) {
      // Symlink failed, fall back to copy
      await cleanAndCreateDirectory(targetDir);
      const targetAgentMdPath = join(targetDir, 'AGENT.md');
      await writeFile(targetAgentMdPath, agent.content, 'utf-8');

      return {
        success: true,
        path: targetDir,
        canonicalPath: canonicalDir,
        mode: 'symlink',
        symlinkFailed: true,
      };
    }

    return {
      success: true,
      path: targetDir,
      canonicalPath: canonicalDir,
      mode: 'symlink',
    };
  } catch (error) {
    return {
      success: false,
      path: targetDir,
      mode: installMode,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Install a well-known agent with multiple files.
 * The agent directory name is derived from the installName field.
 * All files from the agent's files map are written to the installation directory.
 * Supports symlink mode (writes to canonical location and symlinks to agent dirs)
 * or copy mode (writes directly to each agent dir).
 */
export async function installWellKnownAgentForTarget(
  agent: WellKnownAgent,
  targetType: TargetType,
  options: { global?: boolean; cwd?: string; mode?: InstallMode } = {}
): Promise<InstallResult> {
  const target = targets[targetType];
  const isGlobal = options.global ?? false;
  const cwd = options.cwd || process.cwd();
  const installMode = options.mode ?? 'symlink';

  // Check if agent supports global installation
  if (isGlobal && target.globalAgentsDir === undefined) {
    return {
      success: false,
      path: '',
      mode: installMode,
      error: `${target.displayName} does not support global agent installation`,
    };
  }

  // Use installName as the agent directory name
  const agentName = sanitizeName(agent.installName);

  // Canonical location: .agents/agents/<agent-name>
  const canonicalBase = getCanonicalAgentsDir(isGlobal, cwd);
  const canonicalDir = join(canonicalBase, agentName);

  // Agent-specific location (for symlink)
  const targetBase = getTargetBaseDir(targetType, isGlobal, cwd);
  const targetDir = join(targetBase, agentName);

  // Validate paths
  if (!isPathSafe(canonicalBase, canonicalDir)) {
    return {
      success: false,
      path: targetDir,
      mode: installMode,
      error: 'Invalid agent name: potential path traversal detected',
    };
  }

  if (!isPathSafe(targetBase, targetDir)) {
    return {
      success: false,
      path: targetDir,
      mode: installMode,
      error: 'Invalid agent name: potential path traversal detected',
    };
  }

  /**
   * Write all agent files to a directory (assumes directory already exists)
   */
  async function writeAgentFiles(targetDir: string): Promise<void> {
    for (const [filePath, content] of agent.files) {
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
      await cleanAndCreateDirectory(targetDir);
      await writeAgentFiles(targetDir);

      return {
        success: true,
        path: targetDir,
        mode: 'copy',
      };
    }

    // Symlink mode: write to canonical location and symlink to agent location
    await cleanAndCreateDirectory(canonicalDir);
    await writeAgentFiles(canonicalDir);

    // For universal agents with global install, skip creating agent-specific symlink
    if (isGlobal && isUniversalTarget(targetType)) {
      return {
        success: true,
        path: canonicalDir,
        canonicalPath: canonicalDir,
        mode: 'symlink',
      };
    }

    const symlinkCreated = await createSymlink(canonicalDir, targetDir);

    if (!symlinkCreated) {
      // Symlink failed, fall back to copy
      await cleanAndCreateDirectory(targetDir);
      await writeAgentFiles(targetDir);

      return {
        success: true,
        path: targetDir,
        canonicalPath: canonicalDir,
        mode: 'symlink',
        symlinkFailed: true,
      };
    }

    return {
      success: true,
      path: targetDir,
      canonicalPath: canonicalDir,
      mode: 'symlink',
    };
  } catch (error) {
    return {
      success: false,
      path: targetDir,
      mode: installMode,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export interface InstalledAgent {
  name: string;
  description: string;
  path: string;
  canonicalPath: string;
  scope: 'project' | 'global';
  agents: TargetType[];
}

/**
 * Lists all installed agents from canonical locations
 * @param options - Options for listing agents
 * @returns Array of installed agents with metadata
 */
export async function listInstalledAgents(
  options: {
    global?: boolean;
    cwd?: string;
    targetFilter?: TargetType[];
  } = {}
): Promise<InstalledAgent[]> {
  const cwd = options.cwd || process.cwd();
  // Use a Map to deduplicate agents by scope:name
  const agentsMap: Map<string, InstalledAgent> = new Map();
  const scopes: Array<{ global: boolean; path: string; targetType?: TargetType }> = [];

  // Detect which agents are actually installed
  const detectedTargets = await detectInstalledTargets();
  const targetFilter = options.targetFilter;
  const targetsToCheck = targetFilter
    ? detectedTargets.filter((a) => targetFilter.includes(a))
    : detectedTargets;

  // Determine which scopes to scan
  const scopeTypes: Array<{ global: boolean }> = [];
  if (options.global === undefined) {
    scopeTypes.push({ global: false }, { global: true });
  } else {
    scopeTypes.push({ global: options.global });
  }

  // Build list of directories to scan: canonical + each installed agent's directory
  //
  // Scanning workflow:
  //
  //   detectInstalledTargets()
  //            │
  //            ▼
  //   for each scope (project / global)
  //            │
  //            ├──▶ scan canonical dir ──▶ .agents/agents, ~/.agents/agents
  //            │
  //            ├──▶ scan each installed agent's dir ──▶ .cursor/agents, .claude/agents, ...
  //            │
  //            ▼
  //   deduplicate by agent name
  //
  // Trade-off: More readdir() calls, but most non-existent dirs fail fast.
  // Agents in agent-specific dirs skip the expensive "check all agents" loop.
  //
  for (const { global: isGlobal } of scopeTypes) {
    // Add canonical directory
    scopes.push({ global: isGlobal, path: getCanonicalAgentsDir(isGlobal, cwd) });

    // Add each installed agent's agents directory
    for (const targetType of targetsToCheck) {
      const target = targets[targetType];
      if (isGlobal && target.globalAgentsDir === undefined) {
        continue;
      }
      const targetDir = isGlobal ? target.globalAgentsDir! : join(cwd, target.agentsDir);
      // Avoid duplicate paths
      if (!scopes.some((s) => s.path === targetDir && s.global === isGlobal)) {
        scopes.push({ global: isGlobal, path: targetDir, targetType });
      }
    }

    // Also scan agent directories for agents NOT in targetsToCheck, in case
    // agents were installed with `--agent <name>` but the agent is no longer
    // detected (e.g. ~/.openclaw was removed).  Only add dirs that actually
    // exist on disk to avoid unnecessary readdir errors.
    const allTargetTypes = Object.keys(targets) as TargetType[];
    for (const targetType of allTargetTypes) {
      if (targetsToCheck.includes(targetType)) continue;
      const target = targets[targetType];
      if (isGlobal && target.globalAgentsDir === undefined) continue;
      const targetDir = isGlobal ? target.globalAgentsDir! : join(cwd, target.agentsDir);
      if (scopes.some((s) => s.path === targetDir && s.global === isGlobal)) continue;
      if (existsSync(targetDir)) {
        scopes.push({ global: isGlobal, path: targetDir, targetType });
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

        const agentDir = join(scope.path, entry.name);
        const agentMdPath = join(agentDir, 'AGENT.md');

        // Check if AGENT.md exists
        try {
          await stat(agentMdPath);
        } catch {
          // AGENT.md doesn't exist, skip this directory
          continue;
        }

        // Parse the agent
        const agent = await parseAgentMd(agentMdPath);
        if (!agent) {
          continue;
        }

        const scopeKey = scope.global ? 'global' : 'project';
        const agentKey = `${scopeKey}:${agent.name}`;

        // If scanning an agent-specific directory, attribute directly to that agent
        if (scope.targetType) {
          if (agentsMap.has(agentKey)) {
            const existing = agentsMap.get(agentKey)!;
            if (!existing.agents.includes(scope.targetType)) {
              existing.agents.push(scope.targetType);
            }
          } else {
            agentsMap.set(agentKey, {
              name: agent.name,
              description: agent.description,
              path: agentDir,
              canonicalPath: agentDir,
              scope: scopeKey,
              agents: [scope.targetType],
            });
          }
          continue;
        }

        // For canonical directory, check which agents have this agent
        const sanitizedAgentName = sanitizeName(agent.name);
        const installedTargets: TargetType[] = [];

        for (const targetType of targetsToCheck) {
          const target = targets[targetType];

          if (scope.global && target.globalAgentsDir === undefined) {
            continue;
          }

          const targetBase = scope.global ? target.globalAgentsDir! : join(cwd, target.agentsDir);
          let found = false;

          // Try exact directory name matches
          const possibleNames = Array.from(
            new Set([
              entry.name,
              sanitizedAgentName,
              agent.name
                .toLowerCase()
                .replace(/\s+/g, '-')
                .replace(/[\/\\:\0]/g, ''),
            ])
          );

          for (const possibleName of possibleNames) {
            const agentDir = join(targetBase, possibleName);
            if (!isPathSafe(targetBase, agentDir)) continue;

            try {
              await access(agentDir);
              found = true;
              break;
            } catch {
              // Try next name
            }
          }

          // Fallback: scan all directories and check AGENT.md files
          // Handles cases where directory names don't match (e.g., "git-review" vs "Git Review Before Commit")
          if (!found) {
            try {
              const targetEntries = await readdir(targetBase, { withFileTypes: true });
              for (const targetEntry of targetEntries) {
                if (!targetEntry.isDirectory()) continue;

                const candidateDir = join(targetBase, targetEntry.name);
                if (!isPathSafe(targetBase, candidateDir)) continue;

                try {
                  const candidateAgentMd = join(candidateDir, 'AGENT.md');
                  await stat(candidateAgentMd);
                  const candidateAgent = await parseAgentMd(candidateAgentMd);
                  if (candidateAgent && candidateAgent.name === agent.name) {
                    found = true;
                    break;
                  }
                } catch {
                  // Not a valid agent directory
                }
              }
            } catch {
              // Agent base directory doesn't exist
            }
          }

          if (found) {
            installedTargets.push(targetType);
          }
        }

        if (agentsMap.has(agentKey)) {
          // Merge agents
          const existing = agentsMap.get(agentKey)!;
          for (const agent of installedTargets) {
            if (!existing.agents.includes(agent)) {
              existing.agents.push(agent);
            }
          }
        } else {
          agentsMap.set(agentKey, {
            name: agent.name,
            description: agent.description,
            path: agentDir,
            canonicalPath: agentDir,
            scope: scopeKey,
            agents: installedTargets,
          });
        }
      }
    } catch {
      // Directory doesn't exist, skip
    }
  }

  return Array.from(agentsMap.values());
}
