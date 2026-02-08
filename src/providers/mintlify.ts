import matter from 'gray-matter';
import type { CognitiveType } from '../core/types.ts';
import { COGNITIVE_FILE_NAMES } from '../core/types.ts';
import type { HostProvider, ProviderMatch, RemoteCognitive } from './types.ts';

/** Map lowercase file names to their cognitive type. */
const FILE_NAME_TO_TYPE = new Map<string, CognitiveType>(
  (Object.entries(COGNITIVE_FILE_NAMES) as [CognitiveType, string][]).map(([type, name]) => [
    name.toLowerCase(),
    type,
  ])
);

/**
 * Detect the cognitive type from a URL based on the trailing file name.
 * Returns 'skill' as fallback.
 */
function detectCognitiveType(url: string): CognitiveType {
  const lower = url.toLowerCase();
  for (const [fileName, type] of FILE_NAME_TO_TYPE) {
    if (lower.endsWith('/' + fileName)) return type;
  }
  return 'skill';
}

/**
 * Check whether a URL ends with any known cognitive file name.
 */
function matchesCognitiveFile(url: string): boolean {
  const lower = url.toLowerCase();
  for (const fileName of FILE_NAME_TO_TYPE.keys()) {
    if (lower.endsWith('/' + fileName)) return true;
  }
  return false;
}

/**
 * Mintlify-hosted cognitive provider.
 *
 * Mintlify cognitives are identified by:
 * 1. URL ending in /SKILL.md, /AGENT.md, or /PROMPT.md (case insensitive)
 * 2. Frontmatter containing `metadata.mintlify-proj`
 *
 * The `mintlify-proj` value is used as:
 * - The cognitive's installation directory name
 * - Part of the source identifier for telemetry
 */
export class MintlifyProvider implements HostProvider {
  readonly id = 'mintlify';
  readonly displayName = 'Mintlify';

  match(url: string): ProviderMatch {
    // Must be a valid HTTP(S) URL
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      return { matches: false };
    }

    // Must end with a known cognitive file name (case insensitive)
    if (!matchesCognitiveFile(url)) {
      return { matches: false };
    }

    // Exclude GitHub and GitLab - they have their own handling
    if (url.includes('github.com') || url.includes('gitlab.com')) {
      return { matches: false };
    }

    // Exclude HuggingFace - it has its own provider
    if (url.includes('huggingface.co')) {
      return { matches: false };
    }

    return { matches: true };
  }

  async fetchCognitive(url: string): Promise<RemoteCognitive | null> {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(30000) });

      if (!response.ok) {
        return null;
      }

      const content = await response.text();
      const { data } = matter(content);

      // Must have mintlify-proj in metadata
      const mintlifySite = data.metadata?.['mintlify-proj'];
      if (!mintlifySite) {
        return null;
      }

      // Must have name and description
      if (!data.name || !data.description) {
        return null;
      }

      return {
        name: data.name,
        description: data.description,
        content,
        installName: mintlifySite,
        sourceUrl: url,
        metadata: data.metadata,
        cognitiveType: detectCognitiveType(url),
      };
    } catch {
      return null;
    }
  }

  /** @deprecated Use fetchCognitive */
  async fetchSkill(url: string): Promise<RemoteCognitive | null> {
    return this.fetchCognitive(url);
  }

  toRawUrl(url: string): string {
    // Mintlify URLs are already direct content URLs
    return url;
  }

  getSourceIdentifier(url: string): string {
    // For Mintlify, we use "mintlify/com" as the identifier
    // This groups all Mintlify skills together under a single "repo"
    // The individual skill name (mintlify-proj) serves as the skill identifier
    // Leaderboard URL: /mintlify/com/{skill-name}
    return 'mintlify/com';
  }
}

export const mintlifyProvider = new MintlifyProvider();
