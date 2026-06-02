export type AgentType =
  | 'aider-desk'
  | 'amp'
  | 'antigravity'
  | 'augment'
  | 'bob'
  | 'claude-code'
  | 'openclaw'
  | 'cline'
  | 'codearts-agent'
  | 'codebuddy'
  | 'codemaker'
  | 'codestudio'
  | 'codex'
  | 'command-code'
  | 'continue'
  | 'cortex'
  | 'crush'
  | 'cursor'
  | 'deepagents'
  | 'devin'
  | 'dexto'
  | 'droid'
  | 'firebender'
  | 'forgecode'
  | 'gemini-cli'
  | 'github-copilot'
  | 'goose'
  | 'hermes-agent'
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
  | 'rovodev'
  | 'tabnine-cli'
  | 'trae'
  | 'trae-cn'
  | 'warp'
  | 'windsurf'
  | 'zed'
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
 * Remote plugin source objects follow the Claude Code marketplace spec:
 * https://code.claude.com/docs/en/plugin-marketplaces
 */

/** GitHub repository source: { source: "github", repo: "owner/repo" } */
export interface GitHubPluginSource {
  source: 'github';
  /** GitHub repository in owner/repo format */
  repo: string;
  /** Git branch or tag (defaults to repo default branch) */
  ref?: string;
  /** Full 40-character commit SHA for pinning to exact version */
  sha?: string;
}

/** Git repository URL source: { source: "url", url: "https://..." } */
export interface UrlPluginSource {
  source: 'url';
  /** Full git repository URL (https:// or git@), .git suffix optional */
  url: string;
  /** Git branch or tag (defaults to repo default branch) */
  ref?: string;
  /** Full 40-character commit SHA for pinning to exact version */
  sha?: string;
}

/** Git subdirectory source: { source: "git-subdir", url, path } */
export interface GitSubdirPluginSource {
  source: 'git-subdir';
  /** Git URL, GitHub owner/repo shorthand, or SSH URL */
  url: string;
  /** Subdirectory path within the repo (e.g., "tools/claude-plugin") */
  path: string;
  /** Git branch or tag (defaults to repo default branch) */
  ref?: string;
  /** Full 40-character commit SHA for pinning to exact version */
  sha?: string;
}

/** npm package source: { source: "npm", package } — not supported for skill discovery */
export interface NpmPluginSource {
  source: 'npm';
  /** Package name or scoped package (e.g., @org/plugin) */
  package: string;
  /** Version or version range (e.g., 2.1.0, ^2.0.0) */
  version?: string;
  /** Custom npm registry URL (defaults to system npm registry) */
  registry?: string;
}

export type RemotePluginSourceObject =
  | GitHubPluginSource
  | UrlPluginSource
  | GitSubdirPluginSource
  | NpmPluginSource;

/** Remote sources that skills.sh can resolve by cloning a git repository */
export type ResolvableRemoteSource = GitHubPluginSource | UrlPluginSource | GitSubdirPluginSource;

/**
 * A marketplace.json plugin entry whose source points at another repository.
 * Resolution (cloning + skill discovery) happens lazily, after selection.
 */
export interface RemotePluginEntry {
  /** Plugin name from marketplace.json (used for selection and lock provenance) */
  name: string;
  /** Plugin description from marketplace.json (shown in lists without cloning) */
  description?: string;
  /** The remote source to resolve */
  source: ResolvableRemoteSource;
  /** Optional skill paths within the resolved repo (./-prefixed, per Claude Code convention) */
  skills?: string[];
}

/**
 * Records where a remote-plugin skill's content actually came from at install time.
 * Informational provenance: updates re-resolve through the marketplace (the source
 * of record), never directly from these coordinates.
 */
export interface ResolvedFromInfo {
  /** marketplace.json plugin entry name the skill was resolved from */
  pluginName: string;
  /** Domain repo clone URL */
  url: string;
  /** Subdirectory within the domain repo (git-subdir sources) */
  path?: string;
  /** Declared ref (branch/tag), if any */
  ref?: string;
  /** The exact commit the skill content was installed from */
  sha: string;
}

/**
 * Result of parsing plugin manifests (.claude-plugin/marketplace.json and plugin.json).
 */
export interface PluginManifestResult {
  /** Local directories to search for SKILL.md files (existing behavior) */
  localSearchDirs: string[];
  /** Plugins whose source points at another repository (resolved lazily) */
  remotePlugins: RemotePluginEntry[];
  /** Names of plugins with a recognized but unsupported source type (e.g. npm) */
  unsupportedPlugins: string[];
  /** Plugin names declared more than once in one marketplace (first entry wins) */
  duplicatePluginNames: string[];
}

/**
 * Represents a skill fetched from a remote host provider.
 */
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
