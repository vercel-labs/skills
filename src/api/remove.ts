import { agents as agentConfigs } from '../agents.ts';
import { diagnostics, type DiagnosticCode } from '../diagnostics.ts';
import { readMergedLocalLock } from '../local-lock.ts';
import {
  findGloballyTrackedSkills,
  findUntrackedSkills,
  removeInstalledSkills,
  resolveSkillsToRemove,
  scanInstalledSkillNames,
  trackRemovals,
} from '../remove.ts';
import { readSkillLock } from '../skill-lock.ts';
import { flushTelemetry, setVersion } from '../telemetry.ts';
import type { AgentType } from '../types.ts';
import { version } from './version.ts';
import { assertKnownAgents, isAgentAllowed, resolveConfig } from './config.ts';
import { warn, withWarnings } from '../warnings.ts';
import type { RemoveFailure, RemoveOptions, RemoveResult } from './types.ts';

/**
 * Remove installed skills by name (or by the source recorded in the lock
 * file; `*` removes every skill the scope's lock file tracks, skipping
 * untracked dirs with a SKILLS_REMOVE_UNTRACKED_SKIPPED warning). Without `agents`, skills are
 * removed from every agent `config.agents` allows. A skill's shared copy and
 * lock entry are kept while another installed agent still uses it.
 */
export function removeSkills(
  names: readonly string[],
  options: RemoveOptions = {}
): Promise<RemoveResult> {
  return withWarnings(options.onWarning, () => remove(names, options));
}

async function remove(names: readonly string[], options: RemoveOptions): Promise<RemoveResult> {
  const config = resolveConfig(options);
  if (!Array.isArray(names) || names.some((name) => typeof name !== 'string' || name === '')) {
    throw diagnostics.SKILLS_INVALID_OPTION_VALUE({
      option: 'names',
      expected: 'an array of non-empty strings',
    });
  }
  assertKnownAgents(options.agents);
  const disallowed = options.agents?.filter((agent) => !isAgentAllowed(agent, config.agents));
  if (disallowed && disallowed.length > 0) {
    throw diagnostics.SKILLS_AGENT_NOT_ALLOWED({ agents: disallowed });
  }
  const targetAgents = ((options.agents ?? Object.keys(agentConfigs)) as AgentType[]).filter(
    (agent) => isAgentAllowed(agent, config.agents)
  );
  if (targetAgents.length === 0) {
    throw diagnostics.SKILLS_NO_TARGET_AGENTS();
  }
  options.signal?.throwIfAborted();

  const global = config.scope === 'global';
  const { cwd } = config;
  const installed = await scanInstalledSkillNames(global, cwd);
  const lockEntries = global ? (await readSkillLock()).skills : (await readProjectLock(cwd)).skills;
  const lockKeys = Object.keys(lockEntries);
  const sourceByKey = Object.fromEntries(lockKeys.map((key) => [key, lockEntries[key]?.source]));
  const resolve = (requested: string[]) =>
    resolveSkillsToRemove(requested, installed, lockKeys, sourceByKey);

  const all = names.includes('*');
  const notFound = all ? [] : names.filter((name) => resolve([name]).length === 0);
  // `*` only removes skills the lock tracks; user-authored dirs are skipped (#604).
  let selected = all ? resolve(lockKeys) : resolve([...names]);
  if (all) {
    const untracked = findUntrackedSkills(installed, lockKeys);
    if (untracked.length > 0)
      warn(diagnostics.SKILLS_REMOVE_UNTRACKED_SKIPPED({ skills: untracked }));
  }

  const failed: RemoveFailure[] = [];
  if (!global) {
    const tracked = new Set(await findGloballyTrackedSkills(selected, cwd));
    for (const skill of tracked) {
      const diagnostic = diagnostics.SKILLS_REMOVE_GLOBALLY_TRACKED({ skills: [skill] });
      failed.push({ skill, code: diagnostic.code as DiagnosticCode, message: diagnostic.message });
    }
    selected = selected.filter((skill) => !tracked.has(skill));
  }
  options.signal?.throwIfAborted();

  const results = await removeInstalledSkills(selected, {
    global,
    cwd,
    targetAgents,
    lockfile: config.lockfile,
  });
  for (const r of results) {
    if (!r.success) {
      const diagnostic = diagnostics.SKILLS_REMOVE_FAILED({
        skill: r.skill,
        detail: r.error ?? 'unknown error',
      });
      failed.push({
        skill: r.skill,
        code: diagnostic.code as DiagnosticCode,
        message: diagnostic.message,
      });
    }
  }

  if (config.telemetry) {
    setVersion(version);
    trackRemovals(results, targetAgents, global);
    await flushTelemetry(3000);
  }

  return Object.freeze({
    removed: Object.freeze(results.filter((r) => r.success).map((r) => r.skill)),
    notFound: Object.freeze(notFound),
    failed: Object.freeze(failed),
  });
}

/** Throws SKILLS_INVALID_LOCAL_LOCK when the project lock is unusable. */
async function readProjectLock(cwd: string) {
  return (await readMergedLocalLock(cwd)).lock;
}
