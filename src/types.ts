export type TargetType =
  | 'amp'
  | 'antigravity'
  | 'augment'
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
  | 'droid'
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

export interface Agent {
  name: string;
  description: string;
  path: string;
  /** Raw AGENT.md content for hashing */
  rawContent?: string;
  /** Name of the plugin this agent belongs to (if any) */
  pluginName?: string;
  metadata?: Record<string, unknown>;
}

export interface TargetConfig {
  name: string;
  displayName: string;
  agentsDir: string;
  /** Global agents directory. Set to undefined if the target doesn't support global installation. */
  globalAgentsDir: string | undefined;
  detectInstalled: () => Promise<boolean>;
  /** Whether to show this target in the universal targets list. Defaults to true. */
  showInUniversalList?: boolean;
}

export interface ParsedSource {
  type: 'github' | 'gitlab' | 'git' | 'local' | 'well-known';
  url: string;
  subpath?: string;
  localPath?: string;
  ref?: string;
  /** Agent name extracted from @agent syntax (e.g., owner/repo@agent-name) */
  agentFilter?: string;
}

/**
 * Represents an agent fetched from a remote host provider.
 */
export interface RemoteAgent {
  /** Display name of the agent (from frontmatter) */
  name: string;
  /** Description of the agent (from frontmatter) */
  description: string;
  /** Full markdown content including frontmatter */
  content: string;
  /** The identifier used for installation directory name */
  installName: string;
  /** The original source URL */
  sourceUrl: string;
  /** The provider that fetched this agent */
  providerId: string;
  /** Source identifier for telemetry (e.g., "mintlify.com") */
  sourceIdentifier: string;
  /** Any additional metadata from frontmatter */
  metadata?: Record<string, unknown>;
}
