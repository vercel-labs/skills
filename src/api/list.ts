import { listInstalledSkills } from '../installer.ts';
import { readMergedLocalLock } from '../local-lock.ts';
import { readSkillLock } from '../skill-lock.ts';
import { assertKnownAgents, resolveConfig } from './config.ts';
import { diagnostics } from '../diagnostics.ts';
import { withWarnings } from '../warnings.ts';
import type { InstalledSkillInfo, ListOptions, ListResult, Scope } from './types.ts';

/** Skills installed in the project (`cwd`), globally, or both. */
export function listSkills(options: ListOptions = {}): Promise<ListResult> {
  return withWarnings(options.onWarning, () => list(options));
}

async function list(options: ListOptions): Promise<ListResult> {
  const { cwd } = resolveConfig({ cwd: options.cwd, config: options.config });
  const scope = options.scope ?? 'all';
  if (scope !== 'all' && scope !== 'project' && scope !== 'global') {
    throw diagnostics.SKILLS_INVALID_OPTION_VALUE({
      option: 'scope',
      expected: "'project', 'global' or 'all'",
    });
  }
  assertKnownAgents(options.agents);
  options.signal?.throwIfAborted();

  const found = await listInstalledSkills({
    cwd,
    ...(scope !== 'all' && { global: scope === 'global' }),
    ...(options.agents && { agentFilter: [...options.agents] }),
  });
  options.signal?.throwIfAborted();

  const sources: Record<Scope, Record<string, string>> = {
    project:
      scope === 'global'
        ? {}
        : await lockSources(async () => (await readMergedLocalLock(cwd)).lock),
    global: scope === 'project' ? {} : await lockSources(readSkillLock),
  };

  return Object.freeze({
    skills: Object.freeze(
      found.map((skill): InstalledSkillInfo =>
        Object.freeze({
          name: skill.name,
          description: skill.description,
          scope: skill.scope,
          path: skill.canonicalPath || skill.path,
          agents: Object.freeze([...skill.agents]),
          ...(sources[skill.scope][skill.name] && { source: sources[skill.scope][skill.name] }),
        })
      )
    ),
  });
}

/** Source per skill name from a lock file; an unreadable lock yields none. */
async function lockSources(
  read: () => Promise<{ skills: Record<string, { source: string }> }>
): Promise<Record<string, string>> {
  try {
    const { skills } = await read();
    return Object.fromEntries(Object.entries(skills).map(([name, entry]) => [name, entry.source]));
  } catch {
    return {};
  }
}
