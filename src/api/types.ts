/**
 * Public types of the `skills` programmatic API.
 *
 * These are written by hand and never alias internal types, so internal
 * refactors cannot change the public contract by accident. Every change here
 * shows up in the tsnapi snapshot (`__snapshots__/tsnapi`).
 */

import type { Diagnostic } from 'nostics';
import type { DiagnosticCode } from '../diagnostics.ts';

export type { Diagnostic, DiagnosticCode };

/** Where skills are installed: the project (`cwd`) or the user's home. */
export type Scope = 'project' | 'global';

/**
 * How skills are placed into agent directories. `auto` symlinks from one
 * canonical copy when targets span several skills directories and copies
 * otherwise, the same choice `skills add -y` makes.
 */
export type InstallMode = 'auto' | 'symlink' | 'copy';

/** The kind of source a skill came from. */
export type SourceType = 'github' | 'gitlab' | 'git' | 'local' | 'well-known' | 'download';

/** Settings that can come from shared config and be overridden per call. */
export interface InstallSettings {
  /** @default 'project' */
  scope?: Scope;
  /** @default 'auto' */
  mode?: InstallMode;
  /** Record installs and removals in `skills-lock.json` or the global lock. @default true */
  lockfile?: boolean;
  /** Search the whole source tree for skills, not only the usual locations. @default false */
  fullDepth?: boolean;
  /** Include skills marked `metadata.internal`. @default false */
  includeInternal?: boolean;
  /**
   * When a source has several folders declaring the same skill name: `first`
   * installs the first one found (as `skills add` does); `error` makes
   * installSkills throw SKILLS_DUPLICATE_SKILL_NAME before writing anything when a selected
   * skill's name is declared more than once. @default 'first'
   */
  duplicates?: 'first' | 'error';
  /**
   * Symlinks inside a skill folder: `follow` copies what in-skill links point
   * to and skips unsafe ones with a warning; `reject` makes installSkills throw
   * SKILLS_SKILL_CONTAINS_SYMLINKS before writing anything when a selected skill contains a
   * symlink. @default 'follow'
   */
  symlinks?: 'follow' | 'reject';
}

/** Which agents may be targeted, and which ones to target when a call names none. */
export interface AgentsConfig {
  /** When set, only these agents may be targeted. */
  include?: readonly string[];
  /** These agents are never targeted. */
  exclude?: readonly string[];
  /** Agents to target when a call names none, instead of detecting them. */
  default?: readonly string[];
}

/**
 * Shared settings for a project or user. JSON-serializable by design (no
 * functions, no secrets) so it can later be read from a `skills.config` file.
 * The library never reads such files itself; pass the config explicitly.
 */
export interface SkillsConfig extends InstallSettings {
  agents?: AgentsConfig;
  /**
   * Send anonymous usage telemetry, as the CLI does. Setting `DISABLE_TELEMETRY`
   * or `DO_NOT_TRACK` always turns it off. @default true
   */
  telemetry?: boolean;
}

/** Progress reported while an operation runs. */
export type ProgressEvent =
  | { readonly type: 'resolve:start'; readonly source: string }
  | { readonly type: 'resolve:done'; readonly source: SourceInfo; readonly skills: number }
  | { readonly type: 'install:start'; readonly skills: number; readonly agents: number }
  | { readonly type: 'install:done'; readonly installed: number; readonly failed: number };

export type ProgressHandler = (event: ProgressEvent) => void;

/**
 * Receives non-fatal problems as diagnostics, the same ones the CLI prints:
 * SKILLS_SKILL_SKIPPED (an invalid SKILL.md was not discovered) and
 * SKILLS_BROKEN_SYMLINK / SKILLS_SYMLINK_OUTSIDE_SKILL / SKILLS_SYMLINK_CYCLE
 * (an unsafe symlink inside a skill was not copied).
 */
export type WarningHandler = (warning: Diagnostic<unknown>) => void;

/** Runtime context shared by every operation. Never comes from a config file. */
export interface BaseOptions {
  /** Project directory. @default process.cwd() */
  cwd?: string;
  /** Cancels the operation; checked between steps. */
  signal?: AbortSignal;
  onProgress?: ProgressHandler;
  /** Receives non-fatal problems. Without it they are dropped silently. */
  onWarning?: WarningHandler;
  /** Shared settings. Options passed to a call take precedence over these. */
  config?: SkillsConfig;
}

/** A supported agent. */
export interface AgentInfo {
  /**
   * Identifier used in `agents` options, e.g. `claude-code`. `universal` is a
   * neutral target: `.agents/skills` in the project (or its global
   * equivalent), which every universal agent reads.
   */
  readonly id: string;
  readonly name: string;
  /** Skills directory relative to the project root. */
  readonly projectSkillsDir: string;
  /** Absolute global skills directory, or null when the agent has none. */
  readonly globalSkillsDir: string | null;
  /** Reads skills from the shared `.agents/skills` directory. */
  readonly universal: boolean;
}

export interface DetectAgentsResult {
  /** Installed agents allowed by `config.agents`. */
  readonly agents: readonly AgentInfo[];
}

/** A parsed skill source. */
export interface SourceInfo {
  /** The source string as given. */
  readonly input: string;
  readonly type: SourceType;
  /** Repository or download URL, or the absolute path of a local source. */
  readonly url: string;
  readonly ref?: string;
  /**
   * Commit that was checked out, for git sources that were cloned. Absent for
   * other sources and for GitHub repositories read through the fast path,
   * which is only used when no `ref` is given.
   */
  readonly commit?: string;
  readonly subpath?: string;
}

/** A skill found in a source. */
export interface SkillInfo {
  readonly name: string;
  readonly description: string;
  /**
   * The skill folder relative to the source root, `/`-separated (`.` for a
   * skill at the root). Absent for well-known sources, which have no tree.
   */
  readonly path?: string;
  /**
   * Other folders in the source that declare the same name. They are ignored:
   * the first definition wins, in discovery order, as with `skills add`.
   */
  readonly duplicates?: readonly string[];
  readonly pluginName?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/**
 * A fetched source. It owns a temporary clone or download until disposed;
 * pass it to `installSkills` to install without fetching again.
 */
export interface SkillSource {
  readonly source: SourceInfo;
  readonly skills: readonly SkillInfo[];
  /** Remove the temporary files. Safe to call more than once. */
  dispose(): Promise<void>;
}

export interface ResolveOptions extends BaseOptions {
  /**
   * Branch, tag, or full commit SHA to check out, for git sources. Overrides
   * a `#ref` in the source string.
   */
  ref?: string;
  fullDepth?: boolean;
  includeInternal?: boolean;
}

export interface InstallOptions extends BaseOptions, InstallSettings {
  /** Branch, tag, or commit SHA, when `source` is a string. See ResolveOptions.ref. */
  ref?: string;
  /** Skill names to install. @default all skills in the source */
  skills?: readonly string[];
  /**
   * Install skills under new names, keyed by the name the source uses (matched
   * like `skills`): `{ shadcn: 'shadcn-ui' }`. The new name is used for the
   * folder, the lock entry and the SKILL.md `name`; the lock remembers the
   * source name, so update and restore keep the new name. Each key must match
   * one skill being installed, and no two skills may end up with one name.
   */
  rename?: Readonly<Record<string, string>>;
  /**
   * Agents to install into; each must be allowed by `config.agents`.
   * @default `config.agents.default`, else the agents `skills add -y` picks
   */
  agents?: readonly string[];
  telemetry?: boolean;
  /** JSON-serializable data attached to install telemetry. */
  metadata?: Readonly<Record<string, unknown>>;
}

/** A skill written into one agent's directory. */
export interface InstalledSkillTarget {
  readonly skill: string;
  readonly agent: string;
  readonly scope: Scope;
  readonly mode: 'symlink' | 'copy';
  /** Where the agent reads the skill from. */
  readonly path: string;
  /** The shared copy agents link to, when there is one. */
  readonly canonicalPath?: string;
}

/** A skill that was not installed into an agent because its directory is missing. */
export interface SkippedSkillTarget {
  readonly skill: string;
  readonly agent: string;
  readonly reason: 'missing-agent-directory';
}

export interface InstallFailure {
  readonly skill: string;
  readonly agent: string;
  readonly code: DiagnosticCode;
  readonly message: string;
}

export interface InstallResult {
  readonly source: SourceInfo;
  readonly installed: readonly InstalledSkillTarget[];
  readonly skipped: readonly SkippedSkillTarget[];
  readonly failed: readonly InstallFailure[];
}

export interface ListOptions extends BaseOptions {
  /** @default 'all' */
  scope?: Scope | 'all';
  /** Only skills installed for these agents. */
  agents?: readonly string[];
}

/** A skill installed on disk. */
export interface InstalledSkillInfo {
  readonly name: string;
  readonly description: string;
  readonly scope: Scope;
  /** The skill directory (the canonical copy when agents share one). */
  readonly path: string;
  /** Detected agents that have the skill. */
  readonly agents: readonly string[];
  /** Source recorded in the lock file, when the skill is tracked there. */
  readonly source?: string;
  /** The name the source publishes the skill under, when it was installed under another name. */
  readonly renamedFrom?: string;
}

export interface ListResult {
  readonly skills: readonly InstalledSkillInfo[];
}

export interface RemoveOptions extends BaseOptions {
  /** @default 'project' */
  scope?: Scope;
  /** Remove only from these agents. @default every agent */
  agents?: readonly string[];
  lockfile?: boolean;
  telemetry?: boolean;
}

export interface RemoveFailure {
  readonly skill: string;
  readonly code: DiagnosticCode;
  readonly message: string;
}

export interface RemoveResult {
  /** Skills removed from the requested agents. */
  readonly removed: readonly string[];
  /** Requested names that matched no installed or locked skill. */
  readonly notFound: readonly string[];
  readonly failed: readonly RemoveFailure[];
}
