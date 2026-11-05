/**
 * Public programmatic API of `skills`.
 *
 * Every export is listed by name on purpose: this file is the whole public
 * contract and is guarded by the tsnapi snapshot in `__snapshots__/tsnapi`.
 * Never `export *`, and never re-export internal types. See docs/api.md.
 */

export { getSupportedAgents, detectAgents } from './api/agents.ts';
export { resolveSource } from './api/resolve.ts';
export { installSkills } from './api/install.ts';
export { listSkills } from './api/list.ts';
export { removeSkills } from './api/remove.ts';
export { diagnostics, isDiagnostic } from './diagnostics.ts';
export { version } from './api/version.ts';

export type {
  AgentInfo,
  AgentsConfig,
  BaseOptions,
  DetectAgentsResult,
  Diagnostic,
  DiagnosticCode,
  InstalledSkillInfo,
  InstalledSkillTarget,
  InstallFailure,
  InstallMode,
  InstallOptions,
  InstallResult,
  InstallSettings,
  ListOptions,
  ListResult,
  ProgressEvent,
  ProgressHandler,
  RemoveFailure,
  RemoveOptions,
  RemoveResult,
  ResolveOptions,
  Scope,
  SkillInfo,
  SkillsConfig,
  SkillSource,
  SkippedSkillTarget,
  SourceInfo,
  SourceType,
  WarningHandler,
} from './api/types.ts';
