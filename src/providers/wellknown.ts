import matter from 'gray-matter';
import type { HostProvider, ProviderMatch, RemoteAgent } from './types.ts';

/**
 * Represents the index.json structure for well-known agents.
 */
export interface WellKnownIndex {
  agents: WellKnownAgentEntry[];
}

/**
 * Represents a agent entry in the index.json.
 */
export interface WellKnownAgentEntry {
  /** Agent identifier. Must match the directory name. */
  name: string;
  /** Brief description of what the agent does. */
  description: string;
  /** Array of all files in the agent directory. */
  files: string[];
}

/**
 * Represents a agent with all its files fetched from a well-known endpoint.
 */
export interface WellKnownAgent extends RemoteAgent {
  /** All files in the agent, keyed by relative path */
  files: Map<string, string>;
  /** The entry from the index.json */
  indexEntry: WellKnownAgentEntry;
}

/**
 * Well-known agents provider using RFC 8615 well-known URIs.
 *
 * Organizations can publish agents at:
 * https://example.com/.well-known/agents/
 *
 * URL formats supported:
 * - https://example.com (discovers all agents from root)
 * - https://example.com/docs (discovers from /docs/.well-known/agents/)
 * - https://example.com/.well-known/agents (discovers all agents)
 * - https://example.com/.well-known/agents/agent-name (specific agent)
 *
 * The source identifier is "wellknown/{hostname}" or "wellknown/{hostname}/path".
 */
export class WellKnownProvider implements HostProvider {
  readonly id = 'well-known';
  readonly displayName = 'Well-Known Agents';

  private readonly WELL_KNOWN_PATH = '.well-known/agents';
  private readonly INDEX_FILE = 'index.json';

  /**
   * Check if a URL could be a well-known agents endpoint.
   * This is a fallback provider - it matches any HTTP(S) URL that is not
   * a recognized pattern (GitHub, GitLab, owner/repo shorthand, etc.)
   */
  match(url: string): ProviderMatch {
    // Must be a valid HTTP(S) URL
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      return { matches: false };
    }

    // Parse URL to extract hostname
    try {
      const parsed = new URL(url);

      // Exclude known git hosts that have their own handling
      const excludedHosts = ['github.com', 'gitlab.com', 'huggingface.co'];
      if (excludedHosts.includes(parsed.hostname)) {
        return { matches: false };
      }

      return {
        matches: true,
        sourceIdentifier: `wellknown/${parsed.hostname}`,
      };
    } catch {
      return { matches: false };
    }
  }

  /**
   * Fetch the agents index from a well-known endpoint.
   * Tries both the path-relative .well-known and the root .well-known.
   */
  async fetchIndex(
    baseUrl: string
  ): Promise<{ index: WellKnownIndex; resolvedBaseUrl: string } | null> {
    try {
      const parsed = new URL(baseUrl);
      const basePath = parsed.pathname.replace(/\/$/, ''); // Remove trailing slash

      // Try path-relative .well-known first (e.g., /docs/.well-known/agents/)
      // then fall back to root .well-known
      const urlsToTry = [
        // Path-relative: https://example.com/docs/.well-known/agents/index.json
        {
          indexUrl: `${parsed.protocol}//${parsed.host}${basePath}/${this.WELL_KNOWN_PATH}/${this.INDEX_FILE}`,
          baseUrl: `${parsed.protocol}//${parsed.host}${basePath}`,
        },
      ];

      // Also try root if we have a path
      if (basePath && basePath !== '') {
        urlsToTry.push({
          indexUrl: `${parsed.protocol}//${parsed.host}/${this.WELL_KNOWN_PATH}/${this.INDEX_FILE}`,
          baseUrl: `${parsed.protocol}//${parsed.host}`,
        });
      }

      for (const { indexUrl, baseUrl: resolvedBase } of urlsToTry) {
        try {
          const response = await fetch(indexUrl);

          if (!response.ok) {
            continue;
          }

          const index = (await response.json()) as WellKnownIndex;

          // Validate index structure
          if (!index.agents || !Array.isArray(index.agents)) {
            continue;
          }

          // Validate each agent entry
          let allValid = true;
          for (const entry of index.agents) {
            if (!this.isValidAgentEntry(entry)) {
              allValid = false;
              break;
            }
          }

          if (allValid) {
            return { index, resolvedBaseUrl: resolvedBase };
          }
        } catch {
          // Try next URL
          continue;
        }
      }

      return null;
    } catch {
      return null;
    }
  }

  /**
   * Validate a agent entry from the index.
   */
  private isValidAgentEntry(entry: unknown): entry is WellKnownAgentEntry {
    if (!entry || typeof entry !== 'object') return false;

    const e = entry as Record<string, unknown>;

    // Required fields
    if (typeof e.name !== 'string' || !e.name) return false;
    if (typeof e.description !== 'string' || !e.description) return false;
    if (!Array.isArray(e.files) || e.files.length === 0) return false;

    // Validate name format (per spec: 1-64 chars, lowercase alphanumeric and hyphens)
    const nameRegex = /^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$/;
    if (!nameRegex.test(e.name) && e.name.length > 1) {
      // Allow single char names like "a"
      if (e.name.length === 1 && !/^[a-z0-9]$/.test(e.name)) {
        return false;
      }
    }

    // Validate files array
    for (const file of e.files) {
      if (typeof file !== 'string') return false;
      // Files must not start with / or \ or contain .. (path traversal prevention)
      if (file.startsWith('/') || file.startsWith('\\') || file.includes('..')) return false;
    }

    // Must include AGENT.md
    const hasAgentMd = e.files.some((f) => typeof f === 'string' && f.toLowerCase() === 'agent.md');
    if (!hasAgentMd) return false;

    return true;
  }

  /**
   * Fetch a single agent and all its files from a well-known endpoint.
   */
  async fetchAgent(url: string): Promise<RemoteAgent | null> {
    try {
      const parsed = new URL(url);

      // First, fetch the index to get agent metadata
      const result = await this.fetchIndex(url);
      if (!result) {
        return null;
      }

      const { index, resolvedBaseUrl } = result;

      // Determine which agent to fetch
      let agentName: string | null = null;

      // Check if URL specifies a specific agent
      const pathMatch = parsed.pathname.match(/\/.well-known\/agents\/([^/]+)\/?$/);
      if (pathMatch && pathMatch[1] && pathMatch[1] !== 'index.json') {
        agentName = pathMatch[1];
      } else if (index.agents.length === 1) {
        // If only one agent in index, use that
        agentName = index.agents[0]!.name;
      }

      if (!agentName) {
        // Multiple agents available, return null - caller should use fetchAllAgents
        return null;
      }

      // Find the agent in the index
      const agentEntry = index.agents.find((s: WellKnownAgentEntry) => s.name === agentName);
      if (!agentEntry) {
        return null;
      }

      return this.fetchAgentByEntry(resolvedBaseUrl, agentEntry);
    } catch {
      return null;
    }
  }

  /**
   * Fetch a agent by its index entry.
   * @param baseUrl - The base URL (e.g., https://example.com or https://example.com/docs)
   * @param entry - The agent entry from index.json
   */
  async fetchAgentByEntry(
    baseUrl: string,
    entry: WellKnownAgentEntry
  ): Promise<WellKnownAgent | null> {
    try {
      // Build the agent base URL: {baseUrl}/.well-known/agents/{agent-name}
      const skillBaseUrl = `${baseUrl.replace(/\/$/, '')}/${this.WELL_KNOWN_PATH}/${entry.name}`;

      // Fetch AGENT.md first (required)
      const skillMdUrl = `${skillBaseUrl}/AGENT.md`;
      const response = await fetch(skillMdUrl);

      if (!response.ok) {
        return null;
      }

      const content = await response.text();
      const { data } = matter(content);

      // Validate frontmatter has name and description
      if (!data.name || !data.description) {
        return null;
      }

      // Fetch all other files
      const files = new Map<string, string>();
      files.set('AGENT.md', content);

      // Fetch remaining files in parallel
      const otherFiles = entry.files.filter((f) => f.toLowerCase() !== 'agent.md');
      const filePromises = otherFiles.map(async (filePath) => {
        try {
          const fileUrl = `${skillBaseUrl}/${filePath}`;
          const fileResponse = await fetch(fileUrl);
          if (fileResponse.ok) {
            const fileContent = await fileResponse.text();
            return { path: filePath, content: fileContent };
          }
        } catch {
          // Ignore individual file fetch errors
        }
        return null;
      });

      const fileResults = await Promise.all(filePromises);
      for (const result of fileResults) {
        if (result) {
          files.set(result.path, result.content);
        }
      }

      return {
        name: data.name,
        description: data.description,
        content,
        installName: entry.name,
        sourceUrl: skillMdUrl,
        metadata: data.metadata,
        files,
        indexEntry: entry,
      };
    } catch {
      return null;
    }
  }

  /**
   * Fetch all agents from a well-known endpoint.
   */
  async fetchAllAgents(url: string): Promise<WellKnownAgent[]> {
    try {
      const result = await this.fetchIndex(url);
      if (!result) {
        return [];
      }

      const { index, resolvedBaseUrl } = result;

      // Fetch all agents in parallel
      const skillPromises = index.agents.map((entry: WellKnownAgentEntry) =>
        this.fetchAgentByEntry(resolvedBaseUrl, entry)
      );
      const results = await Promise.all(skillPromises);

      return results.filter((s: WellKnownAgent | null): s is WellKnownAgent => s !== null);
    } catch {
      return [];
    }
  }

  /**
   * Convert a user-facing URL to a agent URL.
   * For well-known, this extracts the base domain and constructs the proper path.
   */
  toRawUrl(url: string): string {
    try {
      const parsed = new URL(url);
      // If already pointing to a AGENT.md, return as-is
      if (url.toLowerCase().endsWith('/agent.md')) {
        return url;
      }

      // Check if URL specifies a agent path
      const pathMatch = parsed.pathname.match(/\/.well-known\/agents\/([^/]+)\/?$/);
      if (pathMatch && pathMatch[1]) {
        const basePath = parsed.pathname.replace(/\/.well-known\/agents\/.*$/, '');
        return `${parsed.protocol}//${parsed.host}${basePath}/${this.WELL_KNOWN_PATH}/${pathMatch[1]}/AGENT.md`;
      }

      // Otherwise, return the index URL
      const basePath = parsed.pathname.replace(/\/$/, '');
      return `${parsed.protocol}//${parsed.host}${basePath}/${this.WELL_KNOWN_PATH}/${this.INDEX_FILE}`;
    } catch {
      return url;
    }
  }

  /**
   * Get the source identifier for telemetry/storage.
   * Returns the full hostname with www. stripped.
   * e.g., "https://mintlify.com/docs" → "mintlify.com"
   *       "https://mppx-discovery-agents.vercel.app" → "mppx-discovery-agents.vercel.app"
   *       "https://www.example.com" → "example.com"
   *       "https://docs.lovable.dev" → "docs.lovable.dev"
   */
  getSourceIdentifier(url: string): string {
    try {
      const parsed = new URL(url);
      // Use full hostname, only strip www. prefix
      return parsed.hostname.replace(/^www\./, '');
    } catch {
      return 'unknown';
    }
  }

  /**
   * Check if a URL has a well-known agents index.
   */
  async hasAgentsIndex(url: string): Promise<boolean> {
    const result = await this.fetchIndex(url);
    return result !== null;
  }
}

export const wellKnownProvider = new WellKnownProvider();
