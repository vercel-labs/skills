import type { CognitiveType as _CognitiveType } from './__generated__/cognitive-types.ts';

export type { CognitiveType } from './__generated__/cognitive-types.ts';
export {
  COGNITIVE_SUBDIRS,
  COGNITIVE_FILE_NAMES,
  AGENTS_DIR,
} from './__generated__/cognitive-types.ts';

export type { AgentType } from './__generated__/agent-type.ts';

export interface Cognitive {
  name: string;
  description: string;
  path: string;
  /** Raw SKILL.md/AGENT.md/PROMPT.md content for hashing */
  rawContent?: string;
  metadata?: Record<string, unknown>;
  /** The cognitive type of this cognitive. Defaults to 'skill'. */
  cognitiveType?: _CognitiveType;
}

/** @deprecated Use Cognitive */
export type Skill = Cognitive;

export interface AgentConfig {
  name: string;
  displayName: string;
  dirs: Record<_CognitiveType, { local: string; global: string | undefined }>;
  detectInstalled: () => Promise<boolean>;
  /** Whether to show this agent in the universal agents list. Defaults to true. */
  showInUniversalList?: boolean;
}

export interface ParsedSource {
  type: 'github' | 'gitlab' | 'git' | 'local' | 'direct-url' | 'well-known';
  url: string;
  subpath?: string;
  localPath?: string;
  ref?: string;
  /** Name extracted from @name syntax (e.g., owner/repo@cognitive-name) */
  nameFilter?: string;
  /** @deprecated Use nameFilter */
  skillFilter?: string;
  /** Filter by cognitive type (--type flag) */
  cognitiveFilter?: _CognitiveType;
}

export interface MintlifyCognitive {
  name: string;
  description: string;
  content: string;
  mintlifySite: string;
  sourceUrl: string;
}

/** @deprecated Use MintlifyCognitive */
export type MintlifySkill = MintlifyCognitive;

/**
 * Represents a cognitive fetched from a remote host provider.
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
  /** The provider that fetched this cognitive */
  providerId: string;
  /** Source identifier for telemetry (e.g., "mintlify/bun.com") */
  sourceIdentifier: string;
  /** Any additional metadata from frontmatter */
  metadata?: Record<string, unknown>;
  /** The cognitive type of this remote cognitive */
  cognitiveType?: _CognitiveType;
}

/** @deprecated Use RemoteCognitive */
export type RemoteSkill = RemoteCognitive;
