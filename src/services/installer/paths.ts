import { join, normalize, resolve, sep } from 'path';
import { homedir } from 'os';
import type { AgentType, CognitiveType } from '../../core/types.ts';
import { AGENTS_DIR, COGNITIVE_SUBDIRS } from '../../core/types.ts';
import { getCognitiveDir } from '../registry/index.ts';

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
export function isPathSafe(basePath: string, targetPath: string): boolean {
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
