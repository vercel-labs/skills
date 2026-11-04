import {
  defaultInstallMode,
  installedSkillHash,
  installToTargets,
  nonInteractiveTargetAgents,
  recordGlobalLock,
  recordGlobalWellKnownLock,
  recordProjectLock,
  trackSourceInstall,
  type FetchedSource,
  type InstalledSkill,
  type InstallPlacement,
  type TargetInstallResult,
} from '../add.ts';
import { agents as agentConfigs } from '../agents.ts';
import { InvalidLocalLockError, readLocalLock } from '../local-lock.ts';
import { filterSkills, getSkillDisplayName } from '../skills.ts';
import { flushTelemetry, setVersion } from '../telemetry.ts';
import type { AgentType, Skill } from '../types.ts';
import { version } from './version.ts';
import { assertKnownAgents, isAgentAllowed, resolveConfig, type ResolvedConfig } from './config.ts';
import { errorMessage, SkillsError, throwIfAborted } from './errors.ts';
import { getFetchedSource, openSource } from './resolve.ts';
import type {
  InstalledSkillTarget,
  InstallFailure,
  InstallOptions,
  InstallResult,
  SkippedSkillTarget,
  SkillSource,
} from './types.ts';

/**
 * Install skills from `source` without prompting. `source` is a source string
 * (fetched and cleaned up by this call) or a SkillSource from resolveSource
 * (left for the caller to dispose).
 *
 * Throws SkillsError when nothing can be attempted; failures of single skills
 * or agents are returned in `failed`.
 */
export async function installSkills(
  source: string | SkillSource,
  options: InstallOptions = {}
): Promise<InstallResult> {
  const config = resolveConfig(options);
  const requested = validateNames(options.skills, 'skills');
  assertKnownAgents(validateNames(options.agents, 'agents'));
  if (config.scope === 'project' && config.lockfile) await assertReadableLock(config.cwd);
  throwIfAborted(options.signal);

  const owned = typeof source === 'string';
  const handle = owned ? await openSource(source, config, requested ?? [], options) : source;
  try {
    const fetched = getFetchedSource(handle);
    const skills = selectSkills(fetched, requested);
    const { targets, failures } = await resolveTargets(options.agents, config, skills);
    throwIfAborted(options.signal);

    const explicit = new Set<AgentType>(
      (options.agents ?? config.agents.default ?? []) as AgentType[]
    );
    const placement: InstallPlacement = {
      global: config.scope === 'global',
      cwd: config.cwd,
      targets: targets.map((agent) => ({ agent })),
      mode:
        config.mode === 'auto'
          ? defaultInstallMode(targets.map((agent) => ({ agent })))
          : config.mode,
      createMissingAgentRoot: (agent) => explicit.has(agent),
    };

    options.onProgress?.({ type: 'install:start', skills: skills.length, agents: targets.length });
    const results = await installToTargets(fetched.resolved!, skills, placement);
    const result = buildResult(handle, results, failures, config);
    options.onProgress?.({
      type: 'install:done',
      installed: result.installed.length,
      failed: result.failed.length,
    });

    const installed = await installedSkills(skills, results);
    if (config.lockfile && installed.length > 0) {
      await recordLock(fetched, installed, config, config.mode === 'copy');
    }
    if (config.telemetry && installed.length > 0) {
      setVersion(version);
      await trackSourceInstall(
        fetched,
        installed.map(({ skill }) => skill),
        {
          agents: targets,
          global: placement.global,
          ...(options.metadata && { metadata: JSON.stringify(options.metadata) }),
        }
      );
      await flushTelemetry(3000);
    }
    return result;
  } finally {
    if (owned) await handle.dispose();
  }
}

function validateNames(
  names: readonly string[] | undefined,
  option: string
): readonly string[] | undefined {
  if (names === undefined) return undefined;
  if (!Array.isArray(names) || names.some((name) => typeof name !== 'string' || name === '')) {
    throw new SkillsError('INVALID_OPTIONS', `\`${option}\` must be an array of non-empty strings`);
  }
  return names;
}

async function assertReadableLock(cwd: string): Promise<void> {
  try {
    await readLocalLock(cwd);
  } catch (error) {
    if (error instanceof InvalidLocalLockError) {
      throw new SkillsError('INVALID_LOCKFILE', error.message, { cause: error });
    }
    throw error;
  }
}

/** The skills of `fetched` to install: all, or those `requested` names (`*` means all). */
function selectSkills(fetched: FetchedSource, requested: readonly string[] | undefined): Skill[] {
  const available = fetched.resolved!.skills;
  const names =
    requested ?? (fetched.parsed.skillFilter ? [fetched.parsed.skillFilter] : undefined);
  if (!names || names.length === 0 || names.includes('*')) return available;

  const missing = names.filter((name) => filterSkills(available, [name]).length === 0);
  if (missing.length > 0) {
    throw new SkillsError(
      'SKILL_NOT_FOUND',
      `Skill${missing.length > 1 ? 's' : ''} not found in source: ${missing.join(', ')}`
    );
  }
  return filterSkills(available, [...names]);
}

/**
 * The agents to install into, after `config.agents` limits. Agents the call
 * names but cannot use become failures; agents chosen automatically are
 * dropped silently when they cannot be used.
 */
async function resolveTargets(
  requested: readonly string[] | undefined,
  config: ResolvedConfig,
  skills: Skill[]
): Promise<{ targets: AgentType[]; failures: InstallFailure[] }> {
  const named = (requested ?? config.agents.default) as readonly AgentType[] | undefined;
  const candidates = named ? [...new Set(named)] : await nonInteractiveTargetAgents(config.cwd);
  const global = config.scope === 'global';

  const targets: AgentType[] = [];
  const failures: InstallFailure[] = [];
  const fail = (agent: AgentType, code: InstallFailure['code'], message: string) => {
    if (!named) return;
    for (const skill of skills) {
      failures.push({ skill: getSkillDisplayName(skill), agent, code, message });
    }
  };

  for (const agent of candidates) {
    if (!isAgentAllowed(agent, config.agents)) {
      fail(agent, 'AGENT_NOT_ALLOWED', `${agent} is not allowed by config.agents`);
    } else if (global && agentConfigs[agent].globalSkillsDir === undefined) {
      fail(
        agent,
        'GLOBAL_NOT_SUPPORTED',
        `${agentConfigs[agent].displayName} does not support global skill installation`
      );
    } else {
      targets.push(agent);
    }
  }

  if (targets.length === 0) {
    throw new SkillsError('NO_TARGET_AGENTS', 'No allowed agents to install into');
  }
  return { targets, failures };
}

function buildResult(
  handle: SkillSource,
  results: TargetInstallResult[],
  failures: InstallFailure[],
  config: ResolvedConfig
): InstallResult {
  const installed: InstalledSkillTarget[] = [];
  const skipped: SkippedSkillTarget[] = [];
  const failed: InstallFailure[] = [...failures];

  for (const r of results) {
    if (!r.success) {
      failed.push({
        skill: r.skill,
        agent: r.agentType,
        code: 'INSTALL_FAILED',
        message: r.error ?? 'Unknown error',
      });
    } else if (r.skipReason === 'missing-agent-project-directory') {
      skipped.push({ skill: r.skill, agent: r.agentType, reason: 'missing-agent-directory' });
    } else {
      installed.push(
        Object.freeze({
          skill: r.skill,
          agent: r.agentType,
          scope: config.scope,
          mode: r.mode === 'copy' || r.symlinkFailed ? 'copy' : 'symlink',
          path: r.path,
          ...(r.canonicalPath && { canonicalPath: r.canonicalPath }),
        })
      );
    }
  }

  return Object.freeze({
    source: handle.source,
    installed: Object.freeze(installed),
    skipped: Object.freeze(skipped),
    failed: Object.freeze(failed),
  });
}

/** Skills at least one target accepted, hashed as the lock files record them. */
async function installedSkills(
  skills: Skill[],
  results: TargetInstallResult[]
): Promise<InstalledSkill[]> {
  const installed: InstalledSkill[] = [];
  for (const skill of skills) {
    const name = getSkillDisplayName(skill);
    const target =
      results.find((r) => r.success && !r.skipped && r.skill === name) ??
      results.find((r) => r.success && r.skill === name);
    if (!target) continue;
    try {
      installed.push({ skill, hash: await installedSkillHash(skill, target) });
    } catch {
      // Without a hash the skill stays installed but cannot be locked.
    }
  }
  return installed;
}

async function recordLock(
  fetched: FetchedSource,
  installed: InstalledSkill[],
  config: ResolvedConfig,
  explicitCopy: boolean
): Promise<void> {
  const lockedInstallMode = explicitCopy ? { installMode: 'copy' as const } : {};
  try {
    if (config.scope === 'project') {
      // Direct downloads cannot be fetched again, so they are not locked (as in `add`).
      if (fetched.parsed.type === 'download') return;
      await recordProjectLock(fetched, installed, { cwd: config.cwd, ...lockedInstallMode });
    } else if (installed.some(({ skill }) => 'wellKnown' in skill)) {
      await recordGlobalWellKnownLock(fetched.parsed.url, installed);
    } else {
      await recordGlobalLock(
        fetched,
        installed.map(({ skill }) => skill),
        { lockedInstallMode }
      );
    }
  } catch (error) {
    throw new SkillsError(
      'INVALID_LOCKFILE',
      `Skills were installed but the lock file could not be updated: ${errorMessage(error)}`,
      { cause: error }
    );
  }
}
