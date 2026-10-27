import * as p from '@clack/prompts';
import pc from 'picocolors';
import { readLocalLock } from './local-lock.ts';
import { fetchSources, installFromSource } from './add.ts';
import { runSync, parseSyncOptions } from './sync.ts';
import { getUniversalAgents } from './agents.ts';
import { diagnostics, formatError } from './diagnostics.ts';
import { buildLocalUpdateSource } from './update-source.ts';
import { parseSource } from './source-parser.ts';
import { isCI } from './ci.ts';

/**
 * Install all skills from the local skills-lock.json.
 * Groups skills by source and installs each group; a failing source does not
 * stop the others.
 *
 * Only installs to .agents/skills/ (universal agents) -- the canonical
 * project-level location. Does not install to agent-specific directories.
 *
 * node_modules skills are handled via sync.
 */
export async function runInstallFromLock(args: string[]): Promise<void> {
  const cwd = process.cwd();
  const { options: syncOptions } = parseSyncOptions(args);
  const frozen = syncOptions.frozenLockfile ?? isCI();
  const lock = await readLocalLock(cwd);
  const skillEntries = Object.entries(lock.skills);

  if (skillEntries.length === 0) {
    if (frozen) {
      p.log.error(
        'Cannot install with --frozen-lockfile because skills-lock.json is absent or has no skills'
      );
      process.exitCode = 1;
      return;
    }
    p.log.warn('No project skills found in skills-lock.json');
    p.log.info(
      `Add project-level skills with ${pc.cyan('npx skills add <package>')} (without ${pc.cyan('-g')})`
    );
    return;
  }

  // Only install to .agents/skills/ (universal agents)
  const universalAgentNames = getUniversalAgents();

  // Separate node_modules skills from remote skills
  const nodeModuleSkills: string[] = [];
  const bySource = new Map<string, string[]>();

  for (const [skillName, entry] of skillEntries) {
    if (entry.sourceType === 'node_modules') {
      nodeModuleSkills.push(skillName);
      continue;
    }

    const installSource = buildLocalUpdateSource(entry);
    if (!installSource) {
      p.log.error(formatError(diagnostics.SKILLS_I004({ skill: pc.cyan(skillName) })));
      continue;
    }
    bySource.set(installSource, [...(bySource.get(installSource) ?? []), skillName]);
  }

  const remoteCount = skillEntries.length - nodeModuleSkills.length;
  if (remoteCount > 0) {
    p.log.info(
      `Restoring ${pc.cyan(String(remoteCount))} skill${remoteCount !== 1 ? 's' : ''} from skills-lock.json into ${pc.dim('.agents/skills/')}`
    );
  }

  // Download every source at once, then install them in order
  const requests = [...bySource].map(([source, skills]) => ({
    source,
    parsed: parseSource(source),
    skills,
  }));
  const fetched = await fetchSources(requests);
  for (const [index, { source, skills }] of requests.entries()) {
    const result = await installFromSource(fetched[index]!, {
      skills,
      agents: universalAgentNames,
      ...(frozen && { frozenLock: lock }),
    });
    if (result.error) {
      p.log.error(`Failed to install from ${pc.cyan(source)}: ${result.error}`);
      process.exitCode = 1;
      continue;
    }
    p.log.success(`Restored ${result.installed.map((name) => pc.cyan(name)).join(', ')}`);
    for (const failure of result.failed) p.log.error(failure);
    if (result.failed.length > 0) process.exitCode = 1;
  }

  // Handle node_modules skills via sync
  if (nodeModuleSkills.length > 0) {
    p.log.info(
      `${pc.cyan(String(nodeModuleSkills.length))} skill${nodeModuleSkills.length !== 1 ? 's' : ''} from node_modules`
    );
    try {
      await runSync(args, {
        ...syncOptions,
        frozenLockfile: frozen,
        yes: true,
        agent: universalAgentNames,
      });
    } catch (error) {
      p.log.error(
        `Failed to sync node_modules skills: ${error instanceof Error ? formatError(error) : 'Unknown error'}`
      );
    }
  }
}
