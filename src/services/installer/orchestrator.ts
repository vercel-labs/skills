import { writeFile, mkdir } from 'fs/promises';
import { join, basename, dirname } from 'path';
import type {
  Skill,
  AgentType,
  MintlifySkill,
  RemoteSkill,
  CognitiveType,
} from '../../core/types.ts';
import type { WellKnownSkill } from '../../providers/wellknown.ts';
import { COGNITIVE_FILE_NAMES } from '../../core/constants.ts';
import {
  agents,
  getCognitiveDir,
  isUniversalAgent,
  isUniversalForType,
} from '../registry/index.ts';
import { copyDirectory, cleanAndCreateDirectory, createSymlink } from './file-ops.ts';
import { sanitizeName, getCanonicalDir, getCanonicalSkillsDir, isPathSafe } from './paths.ts';

export type InstallMode = 'symlink' | 'copy';

export interface InstallResult {
  success: boolean;
  path: string;
  canonicalPath?: string;
  mode: InstallMode;
  symlinkFailed?: boolean;
  error?: string;
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
