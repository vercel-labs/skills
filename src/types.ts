export type AgentType =
  | 'amp'
  | 'antigravity'
  | 'augment'
  | 'bob'
  | 'claude-code'
  | 'openclaw'
  | 'cline'
  | 'codebuddy'
  | 'codex'
  | 'command-code'
  | 'continue'
  | 'cortex'
  | 'crush'
  | 'cursor'
  | 'deepagents'
  | 'droid'
  | 'firebender'
  | 'gemini-cli'
  | 'github-copilot'
  | 'goose'
  | 'iflow-cli'
  | 'junie'
  | 'kilo'
  | 'kimi-cli'
  | 'kiro-cli'
  | 'kode'
  | 'mcpjam'
  | 'mistral-vibe'
  | 'mux'
  | 'neovate'
  | 'opencode'
  | 'openhands'
  | 'pi'
  | 'qoder'
  | 'qwen-code'
  | 'replit'
  | 'roo'
  | 'trae'
  | 'trae-cn'
  | 'warp'
  | 'windsurf'
  | 'zencoder'
  | 'pochi'
  | 'adal'
  | 'universal';

export interface Skill {
  name: string;
  description: string;
  path: string;
  /** Raw SKILL.md content for hashing */
  rawContent?: string;
  /** Name of the plugin this skill belongs to (if any) */
  pluginName?: string;
  metadata?: Record<string, unknown>;
}

export interface AgentConfig {
  name: string;
  displayName: string;
  skillsDir: string;
  /** Global skills directory. Set to undefined if the agent doesn't support global installation. */
  globalSkillsDir: string | undefined;
  detectInstalled: () => Promise<boolean>;
  /** Whether to show this agent in the universal agents list. Defaults to true. */
  showInUniversalList?: boolean;
}

export interface ParsedSource {
  type: 'github' | 'gitlab' | 'git' | 'local' | 'well-known';
  url: string;
  subpath?: string;
  localPath?: string;
  ref?: string;
  /** Skill name extracted from @skill syntax (e.g., owner/repo@skill-name) */
  skillFilter?: string;
}

/**
 * Represents a skill fetched from a remote host provider.
 */
// ─── Manifest types (fork feature: TOML-based batch installation) ───

/** Entry in a TOML manifest file */
export interface ManifestSkillEntry {
  source: string; // "owner/repo" or full git URL
  name: string; // Skill name to install
  version?: string; // Optional: requested version
  locations?: string[]; // Optional: ["global", "project", "packages/app"]
}

/** Parsed manifest file */
export interface SkillManifest {
  skills: ManifestSkillEntry[];
}

/** Entry in the manifest lock file */
export interface ManifestLockEntry {
  source: string;
  name: string;
  version: string;
  resolvedRef: string; // Actual git commit SHA used
  installedAt: string; // ISO timestamp
  location?: string; // Which location this entry was installed to
}

/** Manifest lock file structure */
export interface ManifestLockFile {
  lockVersion: number;
  skills: ManifestLockEntry[];
}

export interface RemoteSkill {
  /** Display name of the skill (from frontmatter) */
  name: string;
  /** Description of the skill (from frontmatter) */
  description: string;
  /** Full markdown content including frontmatter */
  content: string;
  /** The identifier used for installation directory name */
  installName: string;
  /** The original source URL */
  sourceUrl: string;
  /** The provider that fetched this skill */
  providerId: string;
  /** Source identifier for telemetry (e.g., "mintlify.com") */
  sourceIdentifier: string;
  /** Any additional metadata from frontmatter */
  metadata?: Record<string, unknown>;
}
