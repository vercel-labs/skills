import * as p from '@clack/prompts';
import pc from 'picocolors';
import { readLocalLock } from './local-lock.ts';
import { runAdd } from './add.ts';
import { runSync, parseSyncOptions } from './sync.ts';
import { getPresentAgents } from './agents.ts';
import { buildLocalUpdateSource } from './update-source.ts';

/**
 * Install all skills from the local skills-lock.json.
 * Groups skills by source and calls `runAdd` for each group.
 *
 * Installs for every agent whose config root directory is present at
 * the current working directory -- universal agents via `.agents/`,
 * non-universal agents (e.g. `.claude/`) via the first component of
 * their `skillsDir`. This makes `experimental_install` honour the
 * agent targeting recorded at install time, including Claude Code's
 * `.claude/skills/` symlinks, instead of writing only to the universal
 * `.agents/skills/` directory.
 *
 * node_modules skills are handled via experimental_sync.
 */
export async function runInstallFromLock(args: string[]): Promise<void> {
  const cwd = process.cwd();
  const lock = await readLocalLock(cwd);
  const skillEntries = Object.entries(lock.skills);

  if (skillEntries.length === 0) {
    p.log.warn('No project skills found in skills-lock.json');
    p.log.info(
      `Add project-level skills with ${pc.cyan('npx skills add <package>')} (without ${pc.cyan('-g')})`
    );
    return;
  }

  // Determine which agents to target: every agent whose config root
  // exists at cwd. Falls back to an empty list (and the auto-detect
  // branch in `runAdd`) when no config roots are present.
  const targetAgents = getPresentAgents(cwd);

  // Separate node_modules skills from remote skills
  const nodeModuleSkills: string[] = [];
  const bySource = new Map<string, { sourceType: string; skills: string[] }>();

  for (const [skillName, entry] of skillEntries) {
    if (entry.sourceType === 'node_modules') {
      nodeModuleSkills.push(skillName);
      continue;
    }

    const installSource = buildLocalUpdateSource(entry);
    if (!installSource) {
      p.log.error(
        `Cannot restore ${pc.cyan(skillName)}: skills-lock.json is missing sourceUrl for this generic Git source`
      );
      continue;
    }
    const existing = bySource.get(installSource);
    if (existing) {
      existing.skills.push(skillName);
    } else {
      bySource.set(installSource, {
        sourceType: entry.sourceType,
        skills: [skillName],
      });
    }
  }

  const remoteCount = skillEntries.length - nodeModuleSkills.length;
  if (remoteCount > 0) {
    const agentsHint =
      targetAgents.length > 0
        ? ` for ${pc.dim(`${targetAgents.length} agent${targetAgents.length !== 1 ? 's' : ''}`)}`
        : '';
    p.log.info(
      `Restoring ${pc.cyan(String(remoteCount))} skill${remoteCount !== 1 ? 's' : ''} from skills-lock.json${agentsHint}`
    );
  }

  // Install remote skills grouped by source
  for (const [source, { skills }] of bySource) {
    try {
      await runAdd([source], {
        skill: skills,
        agent: targetAgents,
        yes: true,
      });
    } catch (error) {
      p.log.error(
        `Failed to install from ${pc.cyan(source)}: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  // Handle node_modules skills via sync
  if (nodeModuleSkills.length > 0) {
    p.log.info(
      `${pc.cyan(String(nodeModuleSkills.length))} skill${nodeModuleSkills.length !== 1 ? 's' : ''} from node_modules`
    );
    try {
      const { options: syncOptions } = parseSyncOptions(args);
      await runSync(args, { ...syncOptions, yes: true, agent: targetAgents });
    } catch (error) {
      p.log.error(
        `Failed to sync node_modules skills: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }
}
