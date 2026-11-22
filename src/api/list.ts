import { listInstalledSkills } from '../installer.ts';
import { readLocalLock } from '../local-lock.ts';
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

  const locked: Record<Scope, Record<string, LockedSkill>> = {
    project: scope === 'global' ? {} : await lockedSkills(() => readLocalLock(cwd)),
    global: scope === 'project' ? {} : await lockedSkills(readSkillLock),
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
          ...lockInfo(locked[skill.scope][skill.name]),
        })
      )
    ),
  });
}

interface LockedSkill {
  source: string;
  skillName?: string;
}

function lockInfo(
  entry: LockedSkill | undefined
): Pick<InstalledSkillInfo, 'source' | 'renamedFrom'> {
  if (!entry) return {};
  return { source: entry.source, ...(entry.skillName && { renamedFrom: entry.skillName }) };
}

/** Lock entry per skill name from a lock file; an unreadable lock yields none. */
async function lockedSkills(
  read: () => Promise<{ skills: Record<string, LockedSkill> }>
): Promise<Record<string, LockedSkill>> {
  try {
    return (await read()).skills;
  } catch {
    return {};
  }
}
