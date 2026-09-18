import { homedir } from 'os';
import { join } from 'path';

export const AGENTS_DIR = '.agents';
export const SKILLS_SUBDIR = 'skills';
export const UNIVERSAL_SKILLS_DIR = '.agents/skills';

/** Maximum skill-directory depth searched inside a known container by default. */
export const DEFAULT_SKILL_CONTAINER_DEPTH = 3;

/**
 * Root of the global skills store (`~/.agents` by default). Holds the canonical
 * `skills/` directory and the global lock file. Override with `AGENTS_HOME`.
 */
export function getAgentsHome(): string {
  return process.env.AGENTS_HOME?.trim() || join(homedir(), AGENTS_DIR);
}
