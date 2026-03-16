/**
 * Represents a parsed agent from a remote host.
 * Different hosts may have different ways of identifying agents.
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
  /** Any additional metadata from frontmatter */
  metadata?: Record<string, unknown>;
}

/**
 * Result of attempting to match a URL to a provider.
 */
export interface ProviderMatch {
  /** Whether the URL matches this provider */
  matches: boolean;
  /** The source identifier for telemetry/storage (e.g., "mintlify/bun.com", "huggingface/hf-agents/hf-jobs") */
  sourceIdentifier?: string;
}

/**
 * Interface for remote AGENT.md host providers.
 * Each provider knows how to:
 * - Detect if a URL belongs to it
 * - Fetch and parse AGENT.md files
 * - Convert URLs to raw content URLs
 * - Provide source identifiers for telemetry
 */
export interface HostProvider {
  /** Unique identifier for this provider (e.g., "mintlify", "huggingface", "github") */
  readonly id: string;

  /** Display name for this provider */
  readonly displayName: string;

  /**
   * Check if a URL matches this provider.
   * @param url - The URL to check
   * @returns Match result with optional source identifier
   */
  match(url: string): ProviderMatch;

  /**
   * Fetch and parse a AGENT.md file from the given URL.
   * @param url - The URL to the AGENT.md file
   * @returns The parsed agent or null if invalid/not found
   */
  fetchAgent(url: string): Promise<RemoteAgent | null>;

  /**
   * Convert a user-facing URL to a raw content URL.
   * For example, GitHub blob URLs to raw.githubusercontent.com URLs.
   * @param url - The URL to convert
   * @returns The raw content URL
   */
  toRawUrl(url: string): string;

  /**
   * Get the source identifier for telemetry/storage.
   * This should be a stable identifier that can be used to group
   * agents from the same source.
   * @param url - The original URL
   * @returns Source identifier (e.g., "mintlify/bun.com", "huggingface/hf-agents/hf-jobs")
   */
  getSourceIdentifier(url: string): string;
}

/**
 * Registry for managing host providers.
 */
export interface ProviderRegistry {
  /**
   * Register a new provider.
   */
  register(provider: HostProvider): void;

  /**
   * Find a provider that matches the given URL.
   * @param url - The URL to match
   * @returns The matching provider or null
   */
  findProvider(url: string): HostProvider | null;

  /**
   * Get all registered providers.
   */
  getProviders(): HostProvider[];
}
