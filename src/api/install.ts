import { lstat, readdir } from 'fs/promises';
import { join, posix } from 'path';
import {
  defaultInstallMode,
  collectInstalled,
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
  renameSkill,
  validateRename,
} from '../add.ts';
import { agents as agentConfigs } from '../agents.ts';
import type { Diagnostic } from 'nostics';
import { diagnostics, type DiagnosticCode } from '../diagnostics.ts';
import { readLocalLock } from '../local-lock.ts';
import { filterSkills, getSkillDisplayName } from '../skills.ts';
import { sanitizeName } from '../installer.ts';
import { flushTelemetry, setVersion } from '../telemetry.ts';
import type { AgentType, Skill } from '../types.ts';
import { version } from './version.ts';
import { assertKnownAgents, isAgentAllowed, resolveConfig, type ResolvedConfig } from './config.ts';
import { getFetchedSource, openSource } from './resolve.ts';
import { withWarnings } from '../warnings.ts';
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
 * Throws a diagnostic when nothing can be attempted; failures of single skills
 * or agents are returned in `failed`.
 */
export async function installSkills(
  source: string | SkillSource,
  options: InstallOptions = {}
): Promise<InstallResult> {
  const config = resolveConfig(options);
  const requested = validateNames(options.skills, 'skills');
  validateRenames(options.rename);
  assertKnownAgents(validateNames(options.agents, 'agents'));
  if (typeof source !== 'string' && options.ref !== undefined) {
    throw diagnostics.SKILLS_INVALID_OPTION_VALUE({
      option: 'ref',
      expected: 'used with a source string; pass it to resolveSource() instead',
    });
  }
  return withWarnings(options.onWarning, () => install(source, options, config, requested));
}

async function install(
  source: string | SkillSource,
  options: InstallOptions,
  config: ResolvedConfig,
  requested: readonly string[] | undefined
): Promise<InstallResult> {
  if (config.scope === 'project' && config.lockfile) await assertReadableLock(config.cwd);
  options.signal?.throwIfAborted();

  const owned = typeof source === 'string';
  const handle = owned ? await openSource(source, config, requested ?? [], options) : source;
  try {
    const fetched = getFetchedSource(handle);
    const skills = applyRenames(selectSkills(fetched, requested), options.rename);
    if (config.duplicates === 'error') rejectDuplicates(handle, skills);
    if (config.symlinks === 'reject') await rejectSymlinks(fetched, skills);
    const { targets, failures } = await resolveTargets(options.agents, config, skills);
    options.signal?.throwIfAborted();

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

    const installed = await collectInstalled(skills, results);
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
    throw diagnostics.SKILLS_INVALID_OPTION_VALUE({
      option: option,
      expected: 'an array of non-empty strings',
    });
  }
  return names;
}

/** Throws unless `rename` maps skill names to safe folder names. */
function validateRenames(rename: unknown): void {
  if (rename === undefined) return;
  if (typeof rename !== 'object' || rename === null || Array.isArray(rename)) {
    throw diagnostics.SKILLS_INVALID_OPTION_VALUE({
      option: 'rename',
      expected: 'an object mapping skill names to new names',
    });
  }
  for (const [from, to] of Object.entries(rename)) {
    const option = `rename[${JSON.stringify(from)}]`;
    const error =
      typeof to === 'string'
        ? validateRename(to, option)
        : diagnostics.SKILLS_INVALID_OPTION_VALUE({ option, expected: 'a string' });
    if (error) throw error;
  }
}

/**
 * `skills` with the `rename` map applied. Throws before anything is written
 * when a key matches no skill or several, or when two skills would share a
 * name (one renamed onto another, or two renamed to the same name).
 */
function applyRenames(
  skills: Skill[],
  rename: Readonly<Record<string, string>> | undefined
): Skill[] {
  if (!rename) return skills;
  const newNames = new Map<Skill, string>();
  for (const [from, to] of Object.entries(rename)) {
    const matches = filterSkills(skills, [from]);
    if (matches.length === 0) {
      throw diagnostics.SKILLS_NO_MATCHING_SKILLS({
        requested: [from],
        available: skills.map(getSkillDisplayName),
      });
    }
    if (matches.length > 1) throw diagnostics.SKILLS_AMBIGUOUS_SKILL_SELECTOR({ selector: from });
    newNames.set(matches[0]!, to);
  }
  const renamed = skills.map((skill) => {
    const name = newNames.get(skill);
    return name === undefined ? skill : renameSkill(skill, name);
  });
  // Folder name -> whether a renamed skill claimed it
  const claimed = new Map<string, boolean>();
  for (const skill of renamed) {
    const key = sanitizeName(getSkillDisplayName(skill));
    const isRenamed = skill.renamedFrom !== undefined;
    if (claimed.has(key) && (isRenamed || claimed.get(key))) {
      throw diagnostics.SKILLS_INVALID_OPTION_VALUE({
        option: 'rename',
        expected: `a map to distinct names, but two skills would be installed as ${key}`,
      });
    }
    claimed.set(key, isRenamed || (claimed.get(key) ?? false));
  }
  return renamed;
}

/** Throws SKILLS_INVALID_LOCAL_LOCK before anything is written when the project lock is unusable. */
async function assertReadableLock(cwd: string): Promise<void> {
  await readLocalLock(cwd);
}

/** The skills of `fetched` to install: all, or those `requested` names (`*` means all). */
function selectSkills(fetched: FetchedSource, requested: readonly string[] | undefined): Skill[] {
  const available = fetched.resolved!.skills;
  const names =
    requested ?? (fetched.parsed.skillFilter ? [fetched.parsed.skillFilter] : undefined);
  if (!names || names.length === 0 || names.includes('*')) return available;

  const ambiguous = names.find((name) => filterSkills(available, [name]).length > 1);
  if (ambiguous !== undefined) {
    throw diagnostics.SKILLS_AMBIGUOUS_SKILL_SELECTOR({ selector: ambiguous });
  }

  const missing = names.filter((name) => filterSkills(available, [name]).length === 0);
  if (missing.length > 0) {
    throw diagnostics.SKILLS_NO_MATCHING_SKILLS({
      requested: missing,
      available: available.map(getSkillDisplayName),
    });
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
  const fail = (agent: AgentType, diagnostic: Diagnostic<unknown>) => {
    if (!named) return;
    for (const skill of skills) {
      failures.push(failure(getSkillDisplayName(skill), agent, diagnostic));
    }
  };

  for (const agent of candidates) {
    if (!isAgentAllowed(agent, config.agents)) {
      fail(agent, diagnostics.SKILLS_AGENT_NOT_ALLOWED({ agents: [agent] }));
    } else if (global && agentConfigs[agent].globalSkillsDir === undefined) {
      fail(
        agent,
        diagnostics.SKILLS_GLOBAL_INSTALL_UNSUPPORTED({ agent: agentConfigs[agent].displayName })
      );
    } else {
      targets.push(agent);
    }
  }

  if (targets.length === 0) {
    throw diagnostics.SKILLS_NO_TARGET_AGENTS();
  }
  return { targets, failures };
}

function failure(skill: string, agent: string, diagnostic: Diagnostic<unknown>): InstallFailure {
  return Object.freeze({
    skill,
    agent,
    code: diagnostic.code as DiagnosticCode,
    message: diagnostic.message,
  });
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
      const diagnostic = diagnostics.SKILLS_INSTALL_FAILED({
        skill: r.skill,
        agent: r.agentType,
        detail: r.error ?? 'unknown error',
      });
      failed.push(failure(r.skill, r.agentType, diagnostic));
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

async function recordLock(
  fetched: FetchedSource,
  installed: InstalledSkill[],
  config: ResolvedConfig,
  explicitCopy: boolean
): Promise<void> {
  const lockedInstallMode = explicitCopy ? { installMode: 'copy' as const } : {};
  try {
    if (config.scope === 'project') {
      await recordProjectLock(fetched, installed, undefined, {
        cwd: config.cwd,
        ...lockedInstallMode,
      });
    } else if (installed.some(({ skill }) => 'wellKnown' in skill)) {
      await recordGlobalWellKnownLock(fetched.parsed.url, installed);
    } else {
      await recordGlobalLock(
        fetched,
        installed.map(({ skill }) => skill),
        {
          ...lockedInstallMode,
          onWriteFailure: (_skill, error) => {
            throw error;
          },
        }
      );
    }
  } catch (error) {
    throw diagnostics.SKILLS_LOCK_WRITE_FAILED({
      detail: error instanceof Error ? error.message : String(error),
      cause: error,
    });
  }
}

/** With `duplicates: 'error'`, refuse selected skills whose name more than one folder declares. */
function rejectDuplicates(handle: SkillSource, skills: Skill[]): void {
  const names = new Set(skills.map(getSkillDisplayName));
  const duplicated = handle.skills.filter((info) => names.has(info.name) && info.duplicates);
  if (duplicated.length === 0) return;
  throw diagnostics.SKILLS_DUPLICATE_SKILL_NAME({
    skills: duplicated.map(
      (info) => `${info.name}: ${[info.path ?? '?', ...info.duplicates!].join(', ')}`
    ),
  });
}

/** With `symlinks: 'reject'`, refuse selected skills that contain a symlink. */
async function rejectSymlinks(fetched: FetchedSource, skills: Skill[]): Promise<void> {
  const found: string[] = [];
  for (const skill of skills) {
    for (const link of await findSymlinks(fetched, skill)) {
      found.push(`${getSkillDisplayName(skill)}: ${link}`);
    }
  }
  if (found.length > 0) {
    throw diagnostics.SKILLS_SKILL_CONTAINS_SYMLINKS({ links: found });
  }
}

/** Symlinks inside a skill folder, relative to it (`.` when the folder itself is one). */
async function findSymlinks(fetched: FetchedSource, skill: Skill): Promise<string[]> {
  if ('repoPath' in skill && typeof skill.repoPath === 'string') {
    // Fast-path GitHub skills have no checkout; the tree records symlinks as mode 120000.
    const dir = posix.dirname(skill.repoPath);
    const prefix = dir === '.' ? '' : `${dir}/`;
    return (fetched.resolved?.blobResult?.tree.tree ?? [])
      .filter((entry) => entry.mode === '120000' && entry.path.startsWith(prefix))
      .map((entry) => entry.path.slice(prefix.length));
  }
  if (!skill.path) return []; // Well-known skills are fetched as plain files.

  const links: string[] = [];
  if ((await lstat(skill.path)).isSymbolicLink()) return ['.'];
  const walk = async (dir: string, rel: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const entryRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) links.push(entryRel);
      // .git is never copied, so links inside it are irrelevant.
      else if (entry.isDirectory() && entry.name !== '.git') {
        await walk(join(dir, entry.name), entryRel);
      }
    }
  };
  await walk(skill.path, '');
  return links;
}
