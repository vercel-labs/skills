/**
 * Programmatic API for the skills ecosystem.
 *
 * This module exposes the core building blocks of the `skills` CLI as a
 * library so that other tools, CI pipelines, and applications can manage
 * agent skills without shelling out to the CLI.
 *
 * @example
 * ```ts
 * import { parseSource, getOwnerRepo, tryBlobInstall } from 'skills';
 *
 * const parsed = parseSource('vercel-labs/agent-skills');
 * const ownerRepo = getOwnerRepo(parsed)!;
 * const result = await tryBlobInstall(ownerRepo, { skillFilter: 'web-design-guidelines' });
 *
 * if (result) {
 *   for (const skill of result.skills) {
 *     console.log(skill.name, skill.repoPath);
 *   }
 * }
 * ```
 *
 * @packageDocumentation
 */

// ── Types ────────────────────────────────────────────────────────────

export type { AgentType, Skill, AgentConfig, ParsedSource, RemoteSkill } from './types.ts';

export type { SkillLockEntry, DismissedPrompts, SkillLockFile } from './skill-lock.ts';

export type { LocalSkillLockEntry, LocalSkillLockFile } from './local-lock.ts';

export type {
  SkillSnapshotFile,
  SkillDownloadResponse,
  BlobSkill,
  TreeEntry,
  RepoTree,
  BlobInstallResult,
} from './blob.ts';

export type { UpdateSourceEntry, LocalUpdateSourceEntry } from './update-source.ts';

export type { DiscoverSkillsOptions } from './skills.ts';

export type { InstallMode, InstalledSkill } from './installer.ts';

export type { SearchSkill } from './find.ts';

// ── Source Parsing ───────────────────────────────────────────────────

export {
  parseSource,
  getOwnerRepo,
  parseOwnerRepo,
  isRepoPrivate,
  sanitizeSubpath,
} from './source-parser.ts';

// ── Frontmatter & Sanitization ──────────────────────────────────────

export { parseFrontmatter } from './frontmatter.ts';
export { sanitizeMetadata, stripTerminalEscapes } from './sanitize.ts';

// ── Lock Files (project-scoped) ─────────────────────────────────────

export {
  getLocalLockPath,
  readLocalLock,
  writeLocalLock,
  computeSkillFolderHash,
  addSkillToLocalLock,
  removeSkillFromLocalLock,
} from './local-lock.ts';

// ── Lock Files (global) ─────────────────────────────────────────────

export {
  getSkillLockPath,
  readSkillLock,
  writeSkillLock,
  computeContentHash,
  getGitHubToken,
  fetchSkillFolderHash,
  addSkillToLock,
  removeSkillFromLock,
  getSkillFromLock,
  getAllLockedSkills,
  getSkillsBySource,
} from './skill-lock.ts';

// ── GitHub Blob Fast Path ───────────────────────────────────────────

export {
  toSkillSlug,
  fetchRepoTree,
  getSkillFolderHashFromTree,
  findSkillMdPaths,
  tryBlobInstall,
  BLOB_ALLOWED_REPOS,
} from './blob.ts';

// ── Skill Discovery (on-disk) ───────────────────────────────────────

export {
  discoverSkills,
  parseSkillMd,
  filterSkills,
  getSkillDisplayName,
  shouldInstallInternalSkills,
} from './skills.ts';

// ── Update Source URL Builders ───────────────────────────────────────

export {
  formatSourceInput,
  buildUpdateInstallSource,
  buildLocalUpdateSource,
} from './update-source.ts';

// ── Agent Registry ──────────────────────────────────────────────────

export {
  agents,
  getAgentConfig,
  detectInstalledAgents,
  getUniversalAgents,
  getVisibleUniversalAgents,
  getNonUniversalAgents,
  isUniversalAgent,
} from './agents.ts';

// ── Installer ───────────────────────────────────────────────────────

export {
  sanitizeName,
  getCanonicalSkillsDir,
  getAgentBaseDir,
  getInstallPath,
  getCanonicalPath,
  installSkillForAgent,
  installRemoteSkillForAgent,
  installBlobSkillForAgent,
  isSkillInstalled,
  listInstalledSkills,
} from './installer.ts';

// ── Git Clone Fallback ──────────────────────────────────────────────

export {
  GitCloneError,
  cloneRepo,
  cleanupTempDir,
  isGitHubHttpsCloneUrl,
  isGitHubSsoAuthError,
} from './git.ts';

// ── Constants ───────────────────────────────────────────────────────

export { AGENTS_DIR, SKILLS_SUBDIR, UNIVERSAL_SKILLS_DIR } from './constants.ts';

// ── Plugin Manifest ─────────────────────────────────────────────────

export { getPluginSkillPaths, getPluginGroupings } from './plugin-manifest.ts';

// ── Providers ───────────────────────────────────────────────────────

export type { HostProvider, ProviderMatch, ProviderRegistry } from './providers/types.ts';

export { registry, registerProvider, findProvider, getProviders } from './providers/registry.ts';

export type {
  WellKnownIndex,
  WellKnownIndexV1,
  WellKnownIndexV2,
  WellKnownSkillEntry,
  WellKnownSkillEntryV1,
  WellKnownSkillEntryV2,
  WellKnownSkill,
  WellKnownFileContent,
} from './providers/wellknown.ts';

export { WellKnownProvider, wellKnownProvider } from './providers/wellknown.ts';

// ── Search ──────────────────────────────────────────────────────────

export { searchSkillsAPI } from './find.ts';

// ── Telemetry ───────────────────────────────────────────────────────

export type { PartnerAudit, SkillAuditData, AuditResponse } from './telemetry.ts';
export { fetchAuditData } from './telemetry.ts';
