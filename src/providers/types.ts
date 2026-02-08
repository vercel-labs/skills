import type { CognitiveType } from '../core/types.ts';

/**
 * Represents a parsed cognitive (skill, agent, prompt) from a remote host.
 * Different hosts may have different ways of identifying cognitives.
 */
export interface RemoteCognitive {
  /** Display name of the cognitive (from frontmatter) */
  name: string;
  /** Description of the cognitive (from frontmatter) */
  description: string;
  /** Full markdown content including frontmatter */
  content: string;
  /** The identifier used for installation directory name */
  installName: string;
  /** The original source URL */
  sourceUrl: string;
  /** Any additional metadata from frontmatter */
  metadata?: Record<string, unknown>;
  /** The cognitive type of this remote resource */
  cognitiveType?: CognitiveType;
}

/** @deprecated Use RemoteCognitive */
export type RemoteSkill = RemoteCognitive;

/**
 * Result of attempting to match a URL to a provider.
 */
export interface ProviderMatch {
  /** Whether the URL matches this provider */
  matches: boolean;
  /** The source identifier for telemetry/storage (e.g., "mintlify/bun.com", "huggingface/hf-skills/hf-jobs") */
  sourceIdentifier?: string;
}

/**
 * Interface for remote cognitive file host providers.
 * Each provider knows how to:
 * - Detect if a URL belongs to it
 * - Fetch and parse cognitive files (SKILL.md, AGENT.md, PROMPT.md)
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
   * Fetch and parse a cognitive file from the given URL.
   * @param url - The URL to the cognitive file (SKILL.md, AGENT.md, PROMPT.md)
   * @returns The parsed cognitive or null if invalid/not found
   */
  fetchCognitive(url: string): Promise<RemoteCognitive | null>;

  /** @deprecated Use fetchCognitive */
  fetchSkill(url: string): Promise<RemoteCognitive | null>;

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
   * skills from the same source.
   * @param url - The original URL
   * @returns Source identifier (e.g., "mintlify/bun.com", "huggingface/hf-skills/hf-jobs")
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
