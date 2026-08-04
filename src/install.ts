import * as p from '@clack/prompts';
import pc from 'picocolors';
import { readLocalLock } from './local-lock.ts';
import { runAdd } from './add.ts';
import { runSync, parseSyncOptions } from './sync.ts';
import { getUniversalAgents } from './agents.ts';
import { buildLocalUpdateSource } from './update-source.ts';
import { t } from './messages.ts';

/**
 * Install all skills from the local skills-lock.json.
 * Groups skills by source and calls `runAdd` for each group.
 *
 * Only installs to .agents/skills/ (universal agents) -- the canonical
 * project-level location. Does not install to agent-specific directories.
 *
 * node_modules skills are handled via experimental_sync.
 */
export async function runInstallFromLock(args: string[]): Promise<void> {
  const cwd = process.cwd();
  const lock = await readLocalLock(cwd);
  const skillEntries = Object.entries(lock.skills);

  if (skillEntries.length === 0) {
    p.log.warn(t('No project skills found in skills-lock.json'));
    p.log.info(
      t('Add project-level skills with {cmd} (without {flag})', {
        cmd: pc.cyan('npx skills add <package>'),
        flag: pc.cyan('-g'),
      })
    );
    return;
  }

  // Only install to .agents/skills/ (universal agents)
  const universalAgentNames = getUniversalAgents();

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
        t(
          'Cannot restore {name}: skills-lock.json is missing sourceUrl for this generic Git source',
          {
            name: pc.cyan(skillName),
          }
        )
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
    p.log.info(
      t('Restoring {count} skill(s) from skills-lock.json into {dir}', {
        count: pc.cyan(String(remoteCount)),
        dir: pc.dim('.agents/skills/'),
      })
    );
  }

  // Install remote skills grouped by source
  for (const [source, { skills }] of bySource) {
    try {
      await runAdd([source], {
        skill: skills,
        agent: universalAgentNames,
        yes: true,
      });
    } catch (error) {
      p.log.error(
        t('Failed to install from {source}: {error}', {
          source: pc.cyan(source),
          error: error instanceof Error ? error.message : t('Unknown error'),
        })
      );
    }
  }

  // Handle node_modules skills via sync
  if (nodeModuleSkills.length > 0) {
    p.log.info(
      t('{count} skill(s) from node_modules', {
        count: pc.cyan(String(nodeModuleSkills.length)),
      })
    );
    try {
      const { options: syncOptions } = parseSyncOptions(args);
      await runSync(args, { ...syncOptions, yes: true, agent: universalAgentNames });
    } catch (error) {
      p.log.error(
        t('Failed to sync node_modules skills: {error}', {
          error: error instanceof Error ? error.message : t('Unknown error'),
        })
      );
    }
  }
}
