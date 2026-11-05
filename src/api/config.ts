import { agents as agentConfigs } from '../agents.ts';
import type { AgentType } from '../types.ts';
import { diagnostics } from '../diagnostics.ts';
import type { AgentsConfig, BaseOptions, InstallMode, Scope, SkillsConfig } from './types.ts';

/** Every setting with its default applied. */
export interface ResolvedConfig {
  cwd: string;
  scope: Scope;
  mode: InstallMode;
  lockfile: boolean;
  fullDepth: boolean;
  includeInternal: boolean;
  duplicates: 'first' | 'error';
  symlinks: 'follow' | 'reject';
  telemetry: boolean;
  agents: AgentsConfig;
}

type Overrides = Omit<SkillsConfig, 'agents'>;

/**
 * Merge settings for one call. Precedence per key: the call's options, then
 * `options.config`, then defaults. A future config file slots in between
 * `options.config` and the defaults.
 */
export function resolveConfig(options: BaseOptions & Overrides = {}): ResolvedConfig {
  const config = options.config ?? {};
  const pick = <K extends keyof Overrides>(key: K): Overrides[K] =>
    options[key] !== undefined ? options[key] : config[key];

  const resolved: ResolvedConfig = {
    cwd: options.cwd ?? process.cwd(),
    scope: pick('scope') ?? 'project',
    mode: pick('mode') ?? 'auto',
    lockfile: pick('lockfile') ?? true,
    fullDepth: pick('fullDepth') ?? false,
    includeInternal: pick('includeInternal') ?? false,
    duplicates: pick('duplicates') ?? 'first',
    symlinks: pick('symlinks') ?? 'follow',
    telemetry: pick('telemetry') ?? true,
    agents: config.agents ?? {},
  };

  if (resolved.scope !== 'project' && resolved.scope !== 'global') {
    throw diagnostics.SKILLS_INVALID_OPTION_VALUE({
      option: 'scope',
      expected: "'project' or 'global'",
    });
  }
  if (!['auto', 'symlink', 'copy'].includes(resolved.mode)) {
    throw diagnostics.SKILLS_INVALID_OPTION_VALUE({
      option: 'mode',
      expected: "'auto', 'symlink' or 'copy'",
    });
  }
  if (resolved.duplicates !== 'first' && resolved.duplicates !== 'error') {
    throw diagnostics.SKILLS_INVALID_OPTION_VALUE({
      option: 'duplicates',
      expected: "'first' or 'error'",
    });
  }
  if (resolved.symlinks !== 'follow' && resolved.symlinks !== 'reject') {
    throw diagnostics.SKILLS_INVALID_OPTION_VALUE({
      option: 'symlinks',
      expected: "'follow' or 'reject'",
    });
  }
  assertKnownAgents(resolved.agents.include);
  assertKnownAgents(resolved.agents.exclude);
  assertKnownAgents(resolved.agents.default);
  return resolved;
}

function isKnownAgent(id: string): id is AgentType {
  return Object.hasOwn(agentConfigs, id);
}

/** Throw UNKNOWN_AGENT for any id that is not a supported agent. */
export function assertKnownAgents(
  ids: readonly string[] | undefined
): asserts ids is readonly AgentType[] | undefined {
  const unknown = ids?.filter((id) => !isKnownAgent(id)) ?? [];
  if (unknown.length > 0) {
    throw diagnostics.SKILLS_INVALID_AGENTS({ invalid: unknown, valid: Object.keys(agentConfigs) });
  }
}

/** Whether `config.agents` allows targeting `agent`. */
export function isAgentAllowed(agent: string, config: AgentsConfig): boolean {
  if (config.include && !config.include.includes(agent)) return false;
  return !config.exclude?.includes(agent);
}
