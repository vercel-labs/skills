export type AgentType =
  | 'aider-desk'
  | 'amp'
  | 'antigravity'
  | 'antigravity-cli'
  | 'astrbot'
  | 'autohand-code'
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
  | 'eve'
  | 'firebender'
  | 'forgecode'
  | 'gemini-cli'
  | 'github-copilot'
  | 'goose'
  | 'hermes-agent'
  | 'inference-sh'
  | 'iflow-cli'
  | 'jazz'
  | 'junie'
  | 'kilo'
  | 'kimi-code-cli'
  | 'kiro-cli'
  | 'kode'
  | 'lingma'
  | 'loaf'
  | 'mcpjam'
  | 'mistral-vibe'
  | 'moxby'
  | 'mux'
  | 'neovate'
  | 'opencode'
  | 'openhands'
  | 'ona'
  | 'pi'
  | 'qoder'
  | 'qoder-cn'
  | 'qwen-code'
  | 'replit'
  | 'reasonix'
  | 'roo'
  | 'rovodev'
  | 'spettro'
  | 'tabnine-cli'
  | 'terramind'
  | 'tinycloud'
  | 'trae'
  | 'trae-cn'
  | 'warp'
  | 'windsurf'
  | 'zed'
  | 'zcode'
  | 'zencoder'
  | 'zenflow'
  | 'pochi'
  | 'promptscript'
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
  /** Whether to display this universal agent in the interactive locked section. Defaults to true. */
  showInUniversalPrompt?: boolean;
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
