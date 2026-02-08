import matter from 'gray-matter';
import type { CognitiveType } from '../core/types.ts';
import { COGNITIVE_FILE_NAMES } from '../core/types.ts';
import type { HostProvider, ProviderMatch, RemoteCognitive } from './types.ts';

/**
 * Represents the index.json structure for well-known cognitives.
 */
export interface WellKnownIndex {
  cognitives: WellKnownCognitiveEntry[];
  /** @deprecated Use cognitives */
  skills?: WellKnownCognitiveEntry[];
}

/**
 * Represents a cognitive entry in the index.json.
 */
export interface WellKnownCognitiveEntry {
  /** Cognitive identifier. Must match the directory name. */
  name: string;
  /** Brief description of what the cognitive does. */
  description: string;
  /** Array of all files in the cognitive directory. */
  files: string[];
}

/** @deprecated Use WellKnownCognitiveEntry */
export type WellKnownSkillEntry = WellKnownCognitiveEntry;

/**
 * Represents a cognitive with all its files fetched from a well-known endpoint.
 */
export interface WellKnownCognitive extends RemoteCognitive {
  /** All files in the cognitive, keyed by relative path */
  files: Map<string, string>;
  /** The entry from the index.json */
  indexEntry: WellKnownCognitiveEntry;
}

/** @deprecated Use WellKnownCognitive */
export type WellKnownSkill = WellKnownCognitive;

/**
 * Well-known cognitives provider using RFC 8615 well-known URIs.
 *
 * Organizations can publish cognitives at:
 * https://example.com/.well-known/cognitives/
 *
 * URL formats supported:
 * - https://example.com (discovers all cognitives from root)
 * - https://example.com/docs (discovers from /docs/.well-known/cognitives/)
 * - https://example.com/.well-known/cognitives (discovers all cognitives)
 * - https://example.com/.well-known/cognitives/cognitive-name (specific cognitive)
 *
 * The source identifier is "wellknown/{hostname}" or "wellknown/{hostname}/path".
 */
export class WellKnownProvider implements HostProvider {
  readonly id = 'well-known';
  readonly displayName = 'Well-Known Cognitives';

  private readonly WELL_KNOWN_PATH = '.well-known/cognitives';
  /** @deprecated Fallback path for backward compatibility */
  private readonly WELL_KNOWN_PATH_LEGACY = '.well-known/skills';
  private readonly INDEX_FILE = 'index.json';

  /**
   * Check if a URL could be a well-known cognitives endpoint.
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
   * Fetch the cognitives index from a well-known endpoint.
   * Tries both the path-relative .well-known and the root .well-known.
   * Also falls back from .well-known/cognitives to .well-known/skills for backward compat.
   */
  async fetchIndex(
    baseUrl: string
  ): Promise<{ index: WellKnownIndex; resolvedBaseUrl: string } | null> {
    try {
      const parsed = new URL(baseUrl);
      const basePath = parsed.pathname.replace(/\/$/, ''); // Remove trailing slash

      // Try new path first (.well-known/cognitives), then legacy (.well-known/skills)
      const wellKnownPaths = [this.WELL_KNOWN_PATH, this.WELL_KNOWN_PATH_LEGACY];

      for (const wkPath of wellKnownPaths) {
        // Try path-relative .well-known first (e.g., /docs/.well-known/cognitives/)
        // then fall back to root .well-known
        const urlsToTry = [
          // Path-relative
          {
            indexUrl: `${parsed.protocol}//${parsed.host}${basePath}/${wkPath}/${this.INDEX_FILE}`,
            baseUrl: `${parsed.protocol}//${parsed.host}${basePath}`,
          },
        ];

        // Also try root if we have a path
        if (basePath && basePath !== '') {
          urlsToTry.push({
            indexUrl: `${parsed.protocol}//${parsed.host}/${wkPath}/${this.INDEX_FILE}`,
            baseUrl: `${parsed.protocol}//${parsed.host}`,
          });
        }

        for (const { indexUrl, baseUrl: resolvedBase } of urlsToTry) {
          try {
            const response = await fetch(indexUrl);

            if (!response.ok) {
              continue;
            }

            const raw = (await response.json()) as Record<string, unknown>;

            // Accept both 'cognitives' and 'skills' keys for backward compat
            const entries = (raw.cognitives ?? raw.skills) as WellKnownCognitiveEntry[] | undefined;

            if (!entries || !Array.isArray(entries)) {
              continue;
            }

            // Validate each entry
            let allValid = true;
            for (const entry of entries) {
              if (!this.isValidCognitiveEntry(entry)) {
                allValid = false;
                break;
              }
            }

            if (allValid) {
              const index: WellKnownIndex = { cognitives: entries };
              return { index, resolvedBaseUrl: resolvedBase };
            }
          } catch {
            // Try next URL
            continue;
          }
        }
      }

      return null;
    } catch {
      return null;
    }
  }

  /**
   * Validate a cognitive entry from the index.
   */
  private isValidCognitiveEntry(entry: unknown): entry is WellKnownCognitiveEntry {
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

    // Must include at least one recognized cognitive file (SKILL.md, AGENT.md, PROMPT.md)
    const cognitiveFileNames = new Set(
      Object.values(COGNITIVE_FILE_NAMES).map((n) => n.toLowerCase())
    );
    const hasCognitiveFile = e.files.some(
      (f) => typeof f === 'string' && cognitiveFileNames.has(f.toLowerCase())
    );
    if (!hasCognitiveFile) return false;

    return true;
  }

  /**
   * Fetch a single cognitive and all its files from a well-known endpoint.
   */
  async fetchCognitive(url: string): Promise<RemoteCognitive | null> {
    try {
      const parsed = new URL(url);

      // First, fetch the index to get cognitive metadata
      const result = await this.fetchIndex(url);
      if (!result) {
        return null;
      }

      const { index, resolvedBaseUrl } = result;

      // Determine which cognitive to fetch
      let cognitiveName: string | null = null;

      // Check if URL specifies a specific cognitive
      // Try new path first, then legacy
      const pathMatch =
        parsed.pathname.match(/\/.well-known\/cognitives\/([^/]+)\/?$/) ??
        parsed.pathname.match(/\/.well-known\/skills\/([^/]+)\/?$/);
      if (pathMatch && pathMatch[1] && pathMatch[1] !== 'index.json') {
        cognitiveName = pathMatch[1];
      } else if (index.cognitives.length === 1) {
        // If only one cognitive in index, use that
        cognitiveName = index.cognitives[0]!.name;
      }

      if (!cognitiveName) {
        // Multiple cognitives available, return null - caller should use fetchAllCognitives
        return null;
      }

      // Find the cognitive in the index
      const cognitiveEntry = index.cognitives.find(
        (s: WellKnownCognitiveEntry) => s.name === cognitiveName
      );
      if (!cognitiveEntry) {
        return null;
      }

      return this.fetchCognitiveByEntry(resolvedBaseUrl, cognitiveEntry);
    } catch {
      return null;
    }
  }

  /**
   * Fetch a cognitive by its index entry.
   * @param baseUrl - The base URL (e.g., https://example.com or https://example.com/docs)
   * @param entry - The cognitive entry from index.json
   */
  async fetchCognitiveByEntry(
    baseUrl: string,
    entry: WellKnownCognitiveEntry
  ): Promise<WellKnownCognitive | null> {
    try {
      // Build the cognitive base URL: {baseUrl}/.well-known/cognitives/{cognitive-name}
      const cognitiveBaseUrl = `${baseUrl.replace(/\/$/, '')}/${this.WELL_KNOWN_PATH}/${entry.name}`;

      // Detect which cognitive file to use as the primary file
      const cognitiveFileNames = Object.values(COGNITIVE_FILE_NAMES).map((n) => n.toLowerCase());
      const primaryFile = entry.files.find((f) => cognitiveFileNames.includes(f.toLowerCase()));
      if (!primaryFile) return null;

      // Determine cognitive type from the primary file
      const cognitiveType =
        (Object.entries(COGNITIVE_FILE_NAMES) as [CognitiveType, string][]).find(
          ([_, name]) => name.toLowerCase() === primaryFile.toLowerCase()
        )?.[0] ?? 'skill';

      // Fetch primary cognitive file
      const primaryUrl = `${cognitiveBaseUrl}/${primaryFile}`;
      let response = await fetch(primaryUrl);

      // If new path fails, try legacy path
      if (!response.ok) {
        const legacyBaseUrl = `${baseUrl.replace(/\/$/, '')}/${this.WELL_KNOWN_PATH_LEGACY}/${entry.name}`;
        const legacyPrimaryUrl = `${legacyBaseUrl}/${primaryFile}`;
        response = await fetch(legacyPrimaryUrl);
      }

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
      files.set(primaryFile, content);

      // Fetch remaining files in parallel
      const otherFiles = entry.files.filter((f) => f.toLowerCase() !== primaryFile.toLowerCase());
      const filePromises = otherFiles.map(async (filePath) => {
        try {
          const fileUrl = `${cognitiveBaseUrl}/${filePath}`;
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
        sourceUrl: primaryUrl,
        metadata: data.metadata,
        cognitiveType,
        files,
        indexEntry: entry,
      };
    } catch {
      return null;
    }
  }

  /**
   * Fetch all cognitives from a well-known endpoint.
   */
  async fetchAllCognitives(url: string): Promise<WellKnownCognitive[]> {
    try {
      const result = await this.fetchIndex(url);
      if (!result) {
        return [];
      }

      const { index, resolvedBaseUrl } = result;

      // Fetch all cognitives in parallel
      const cognitivePromises = index.cognitives.map((entry: WellKnownCognitiveEntry) =>
        this.fetchCognitiveByEntry(resolvedBaseUrl, entry)
      );
      const results = await Promise.all(cognitivePromises);

      return results.filter((s: WellKnownCognitive | null): s is WellKnownCognitive => s !== null);
    } catch {
      return [];
    }
  }

  /**
   * Convert a user-facing URL to a cognitive URL.
   * For well-known, this extracts the base domain and constructs the proper path.
   */
  toRawUrl(url: string): string {
    try {
      const parsed = new URL(url);
      // If already pointing to a cognitive file, return as-is
      const cognitiveFileNames = Object.values(COGNITIVE_FILE_NAMES).map((n) => n.toLowerCase());
      const lower = url.toLowerCase();
      if (cognitiveFileNames.some((f) => lower.endsWith('/' + f))) {
        return url;
      }

      // Check if URL specifies a cognitive path (with or without a cognitive file)
      // Matches both new and legacy paths
      const pathMatch =
        parsed.pathname.match(/\/.well-known\/cognitives\/([^/]+?)(?:\/([^/]+))?\/?$/) ??
        parsed.pathname.match(/\/.well-known\/skills\/([^/]+?)(?:\/([^/]+))?\/?$/);
      if (pathMatch && pathMatch[1]) {
        const matchedWkPath = parsed.pathname.includes('.well-known/cognitives')
          ? this.WELL_KNOWN_PATH
          : this.WELL_KNOWN_PATH_LEGACY;
        const basePath = parsed.pathname.replace(/\/.well-known\/(?:cognitives|skills)\/.*$/, '');
        // If the URL already ends with a known cognitive file name, preserve it
        const trailingFile = pathMatch[2]?.toLowerCase();
        const cognitiveFile = cognitiveFileNames.find((f) => f === trailingFile)
          ? pathMatch[2]!
          : COGNITIVE_FILE_NAMES.skill; // Default to SKILL.md for backward compat
        return `${parsed.protocol}//${parsed.host}${basePath}/${matchedWkPath}/${pathMatch[1]}/${cognitiveFile}`;
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
   * Returns the domain in owner/repo format: second-level-domain/top-level-domain.
   * e.g., "mintlify.com" -> "mintlify/com", "lovable.dev" -> "lovable/dev"
   * This matches the owner/repo pattern used by GitHub sources for consistency in the leaderboard.
   */
  getSourceIdentifier(url: string): string {
    try {
      const parsed = new URL(url);
      // Extract the main domain (ignore subdomains like "docs." or "api.")
      const hostParts = parsed.hostname.split('.');

      // Handle common cases:
      // - example.com -> example/com
      // - docs.example.com -> example/com (strip subdomain)
      // - example.co.uk -> example/co.uk (keep compound TLD)

      if (hostParts.length >= 2) {
        // Get the last two parts as the main domain
        const tld = hostParts[hostParts.length - 1]; // com, dev, io, etc.
        const sld = hostParts[hostParts.length - 2]; // mintlify, lovable, etc.
        return `${sld}/${tld}`;
      }

      // Fallback for unusual hostnames
      return parsed.hostname.replace('.', '/');
    } catch {
      return 'unknown/unknown';
    }
  }

  /**
   * Check if a URL has a well-known cognitives index.
   */
  async hasCognitivesIndex(url: string): Promise<boolean> {
    const result = await this.fetchIndex(url);
    return result !== null;
  }

  /** @deprecated Use hasCognitivesIndex */
  async hasSkillsIndex(url: string): Promise<boolean> {
    return this.hasCognitivesIndex(url);
  }

  /** @deprecated Use fetchCognitive */
  async fetchSkill(url: string): Promise<RemoteCognitive | null> {
    return this.fetchCognitive(url);
  }

  /** @deprecated Use fetchCognitiveByEntry */
  async fetchSkillByEntry(
    baseUrl: string,
    entry: WellKnownCognitiveEntry
  ): Promise<WellKnownCognitive | null> {
    return this.fetchCognitiveByEntry(baseUrl, entry);
  }

  /** @deprecated Use fetchAllCognitives */
  async fetchAllSkills(url: string): Promise<WellKnownCognitive[]> {
    return this.fetchAllCognitives(url);
  }
}

export const wellKnownProvider = new WellKnownProvider();
