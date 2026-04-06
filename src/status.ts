import pc from 'picocolors';
import { readFile } from 'fs/promises';
import { join } from 'path';
import matter from 'gray-matter';
import { listInstalledSkills } from './installer.ts';
import {
  parseLifecycle,
  formatDeprecationWarning,
  formatYankWarning,
  type SkillStatus,
} from './lifecycle.ts';

/**
 * Run the `skills status` command.
 * Shows lifecycle state of all installed skills.
 */
export async function runStatus(args: string[]): Promise<void> {
  const isGlobal = args.includes('-g') || args.includes('--global');

  console.log();
  console.log(pc.bold('Checking skill lifecycle status...'));
  console.log();

  const installed = await listInstalledSkills({ global: isGlobal });

  if (installed.length === 0) {
    console.log(pc.dim('No installed skills found.'));
    return;
  }

  // Deduplicate by name (listInstalledSkills may return multiple entries per agent)
  const seen = new Set<string>();
  const unique = installed.filter((s) => {
    if (seen.has(s.name)) return false;
    seen.add(s.name);
    return true;
  });

  const counts: Record<SkillStatus, number> = { active: 0, deprecated: 0, yanked: 0 };

  for (const skill of unique) {
    const skillMdPath = join(skill.path, 'SKILL.md');
    let frontmatter: Record<string, unknown> = {};

    try {
      const content = await readFile(skillMdPath, 'utf-8');
      const { data } = matter(content);
      frontmatter = data;
    } catch {
      // Can't read SKILL.md, assume active
    }

    const lifecycle = parseLifecycle(frontmatter);
    counts[lifecycle.status]++;

    const statusLabels: Record<SkillStatus, string> = {
      active: pc.green('[active]    '),
      deprecated: pc.yellow('[deprecated]'),
      yanked: pc.red('[yanked]    '),
    };

    console.log(`  ${statusLabels[lifecycle.status]} ${pc.bold(skill.name)}`);

    if (lifecycle.status === 'deprecated' && lifecycle.deprecated) {
      console.log(`               ${pc.dim('Reason:')} ${lifecycle.deprecated.reason}`);
      if (lifecycle.deprecated.replacement) {
        console.log(
          `               ${pc.dim('Replacement:')} ${pc.cyan(`npx skills add ${lifecycle.deprecated.replacement}`)}`
        );
      }
      if (lifecycle.deprecated.sunset) {
        console.log(`               ${pc.dim('Sunset:')} ${lifecycle.deprecated.sunset}`);
      }
    }

    if (lifecycle.status === 'yanked' && lifecycle.yanked) {
      console.log(`               ${pc.dim('Reason:')} ${lifecycle.yanked.reason}`);
      if (lifecycle.yanked.advisory) {
        console.log(`               ${pc.dim('Advisory:')} ${pc.cyan(lifecycle.yanked.advisory)}`);
      }
    }
  }

  console.log();

  const parts: string[] = [];
  if (counts.active > 0) parts.push(pc.green(`${counts.active} active`));
  if (counts.deprecated > 0) parts.push(pc.yellow(`${counts.deprecated} deprecated`));
  if (counts.yanked > 0) parts.push(pc.red(`${counts.yanked} yanked`));

  console.log(parts.join(', '));
  console.log();
}
