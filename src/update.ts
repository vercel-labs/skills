import { spawnSync } from 'child_process';
import { existsSync, readdirSync } from 'fs';
import { join, dirname, relative, sep } from 'path';
import { fileURLToPath } from 'url';
import * as p from '@clack/prompts';
import pc from 'picocolors';

import { readSkillLock, getGitHubToken, type SkillLockEntry } from './skill-lock.ts';
import { computeSkillFolderHash, readLocalLock, type LocalSkillLockEntry } from './local-lock.ts';
import {
  formatSourceInput,
  buildUpdateInstallSource,
  buildLocalUpdateSource,
  buildLocalCloneSource,
  shouldUseFullDepthForUpdate,
} from './update-source.ts';
import { cloneRepo, cleanupTempDir, getGitTreeHash } from './git.ts';
import { discoverSkills } from './skills.ts';
import { fetchRepoTree, getSkillFolderHashFromTree } from './blob.ts';
import { wellKnownProvider, computeWellKnownSkillDigest } from './providers/index.ts';
import { removeCommand } from './remove.ts';
import { sanitizeMetadata } from './sanitize.ts';
import { track } from './telemetry.ts';
import { agents, isUniversalAgent } from './agents.ts';
import type { AgentType } from './types.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[38;5;102m';
const TEXT = '\x1b[38;5;145m';

// ============================================
// Scope Detection and Prompt
// ============================================

export type UpdateScope = 'project' | 'global' | 'both';

export interface UpdateCheckOptions {
  global?: boolean;
  project?: boolean;
  yes?: boolean;
  /** Optional skill name(s) to filter on (positional args) */
  skills?: string[];
}

/**
 * Public GitHub lock entries use owner/repo shorthand to preserve the exact
 * skill subpath. Pin that shorthand to github.com so an ambient GH_HOST for a
 * GitHub Enterprise account cannot redirect an existing public installation.
 */
function getUpdateChildEnv(sourceType: string): NodeJS.ProcessEnv | undefined {
  if (sourceType !== 'github') {
    return undefined;
  }
  return { ...process.env, GH_HOST: 'github.com' };
}

export function parseUpdateOptions(args: string[]): UpdateCheckOptions {
  const options: UpdateCheckOptions = {};
  const positional: string[] = [];
  for (const arg of args) {
    if (arg === '-g' || arg === '--global') {
      options.global = true;
    } else if (arg === '-p' || arg === '--project') {
      options.project = true;
    } else if (arg === '-y' || arg === '--yes') {
      options.yes = true;
    } else if (!arg.startsWith('-')) {
      positional.push(arg);
    }
  }
  if (positional.length > 0) {
    options.skills = positional;
  }
  return options;
}

/**
 * Check whether the current working directory has project-level skills.
 * Returns true if either:
 * - skills-lock.json exists in cwd, OR
 * - .agents/skills/ contains at least one subdirectory with a SKILL.md
 */
export function hasProjectSkills(cwd?: string): boolean {
  const dir = cwd || process.cwd();

  // Check 1: skills-lock.json exists
  const lockPath = join(dir, 'skills-lock.json');
  if (existsSync(lockPath)) {
    return true;
  }

  // Check 2: .agents/skills/ has at least one skill
  const skillsDir = join(dir, '.agents', 'skills');
  try {
    const entries = readdirSync(skillsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const skillMd = join(skillsDir, entry.name, 'SKILL.md');
        if (existsSync(skillMd)) {
          return true;
        }
      }
    }
  } catch {
    // Directory doesn't exist
  }

  return false;
}

/**
 * Determine the update/check scope via interactive prompt or auto-detection.
 */
export async function resolveUpdateScope(options: UpdateCheckOptions): Promise<UpdateScope> {
  if (options.skills && options.skills.length > 0) {
    if (options.global) return 'global';
    if (options.project) return 'project';
    return 'both';
  }

  if (options.global && options.project) {
    return 'both';
  }
  if (options.global) {
    return 'global';
  }
  if (options.project) {
    return 'project';
  }

  if (options.yes || !process.stdin.isTTY) {
    return hasProjectSkills() ? 'project' : 'global';
  }

  const scope = await p.select({
    message: 'Update scope',
    options: [
      {
        value: 'project' as UpdateScope,
        label: 'Project',
        hint: 'Update skills in current directory',
      },
      {
        value: 'global' as UpdateScope,
        label: 'Global',
        hint: 'Update skills in home directory',
      },
      {
        value: 'both' as UpdateScope,
        label: 'Both',
        hint: 'Update all skills',
      },
    ],
  });

  if (p.isCancel(scope)) {
    p.cancel('Cancelled');
    process.exit(0);
  }

  return scope as UpdateScope;
}

export function matchesSkillFilter(name: string, filter?: string[]): boolean {
  if (!filter || filter.length === 0) return true;
  const lower = name.toLowerCase();
  return filter.some((f) => f.toLowerCase() === lower);
}

export interface SkippedSkill {
  name: string;
  reason: string;
  sourceUrl: string;
  sourceType: string;
  ref?: string;
}

export function getSkipReason(entry: SkillLockEntry): string {
  if (entry.sourceType === 'local') {
    return 'Local path';
  }
  if (entry.sourceType === 'git') {
    return 'Git URL';
  }
  if (entry.sourceType === 'well-known') {
    return 'Well-known skill';
  }
  if (!entry.skillFolderHash) {
    return 'Private or deleted repo';
  }
  if (!entry.skillPath) {
    return 'No skill path recorded';
  }
  return 'No version tracking';
}

export function getInstallSource(skill: SkippedSkill): string {
  let url = skill.sourceUrl;
  if (skill.sourceType === 'well-known') {
    const idx = url.indexOf('/.well-known/');
    if (idx !== -1) {
      url = url.slice(0, idx);
    }
  }
  return formatSourceInput(url, skill.ref);
}

export function printSkippedSkills(skipped: SkippedSkill[]): void {
  if (skipped.length === 0) return;
  console.log();
  console.log(`${DIM}${skipped.length} skill(s) cannot be checked automatically:${RESET}`);

  const grouped = new Map<string, SkippedSkill[]>();
  for (const skill of skipped) {
    const source = getInstallSource(skill);
    const existing = grouped.get(source) || [];
    existing.push(skill);
    grouped.set(source, existing);
  }

  for (const [source, skills] of grouped) {
    if (skills.length === 1) {
      const skill = skills[0]!;
      console.log(
        `  ${TEXT}•${RESET} ${sanitizeMetadata(skill.name)} ${DIM}(${skill.reason})${RESET}`
      );
    } else {
      const reason = skills[0]!.reason;
      const names = skills.map((s) => sanitizeMetadata(s.name)).join(', ');
      console.log(`  ${TEXT}•${RESET} ${names} ${DIM}(${reason})${RESET}`);
    }
    console.log(`    ${DIM}To update: ${TEXT}npx skills add ${source} -g -y${RESET}`);
  }
}

export async function getProjectSkillsForUpdate(
  skillFilter?: string[]
): Promise<Array<{ name: string; source: string; entry: LocalSkillLockEntry }>> {
  const localLock = await readLocalLock();
  const skills: Array<{ name: string; source: string; entry: LocalSkillLockEntry }> = [];

  for (const [name, entry] of Object.entries(localLock.skills)) {
    if (!matchesSkillFilter(name, skillFilter)) continue;
    if (entry.sourceType === 'node_modules' || entry.sourceType === 'local') {
      continue;
    }
    skills.push({ name, source: entry.sourceUrl || entry.source, entry });
  }

  return skills;
}

export async function promptDeletions(
  source: string,
  deletedSkills: string[],
  isGlobal: boolean,
  options: UpdateCheckOptions
): Promise<void> {
  if (deletedSkills.length === 0) return;

  console.log();
  console.log(
    `${DIM}Warning:${RESET} The following skills from ${DIM}${source}${RESET} appear to have been deleted upstream:`
  );
  for (const s of deletedSkills) {
    console.log(`  ${DIM}•${RESET} ${s}`);
  }

  const isNonInteractive = options.yes || !process.stdin.isTTY;

  if (isNonInteractive) {
    console.log(`${DIM}Skipping deletion in non-interactive mode.${RESET}`);
    return;
  }

  const confirmed = await p.confirm({
    message: `Would you like to remove the local copies of these deleted skills?`,
  });

  if (confirmed && !p.isCancel(confirmed)) {
    for (const s of deletedSkills) {
      console.log(`${DIM}Removing${RESET} ${s}…`);
      await removeCommand([s], { yes: true, global: isGlobal });
    }
  }
}

export async function checkAndPromptForDeletions(
  source: string,
  allLockedForSource: string[],
  lockSkills: Record<string, { skillPath?: string }>,
  isGlobal: boolean,
  options: UpdateCheckOptions,
  discoveredPaths: string[]
): Promise<string[]> {
  const deletedSkills = allLockedForSource.filter((name) => {
    const entry = lockSkills[name];
    if (!entry?.skillPath) return false;
    return !discoveredPaths.includes(entry.skillPath);
  });

  await promptDeletions(source, deletedSkills, isGlobal, options);
  return deletedSkills;
}

export interface WellKnownUpdateItem {
  name: string;
  digest: string;
  subagents?: string[];
}

export type WellKnownCheckResult =
  | { status: 'error' }
  | { status: 'current'; newSkills: string[] }
  | {
      status: 'changed';
      changedSkills: string[];
      removedSkills: string[];
      newSkills: string[];
    };

export async function checkWellKnownForUpdates(
  baseUrl: string,
  items: WellKnownUpdateItem[]
): Promise<WellKnownCheckResult> {
  let indexResult: Awaited<ReturnType<typeof wellKnownProvider.fetchIndex>>;
  try {
    indexResult = await wellKnownProvider.fetchIndex(baseUrl, { updateCheck: true });
  } catch {
    return { status: 'error' };
  }
  if (!indexResult) return { status: 'error' };

  const byName = new Map(indexResult.entries.map((entry) => [entry.name, entry]));
  const removedSkills = items.filter((item) => !byName.has(item.name)).map((item) => item.name);
  const localNames = new Set(items.map((item) => item.name));
  const newSkills = indexResult.entries
    .map((entry) => entry.name)
    .filter((name) => !localNames.has(name));
  const changedSkills: string[] = [];
  const needsContentCheck: WellKnownUpdateItem[] = [];

  for (const item of items) {
    const entry = byName.get(item.name);
    if (!entry) continue;
    if (entry.version === '0.2.0') {
      if (!item.digest || entry.digest !== item.digest) {
        changedSkills.push(item.name);
      }
    } else {
      needsContentCheck.push(item);
    }
  }

  if (needsContentCheck.length > 0) {
    const tracked = new Set(needsContentCheck.map((item) => item.name));
    const skills = (
      await Promise.all(
        indexResult.entries
          .filter((entry) => tracked.has(entry.name))
          .map((entry) => wellKnownProvider.fetchSkillByEntry(entry).catch(() => null))
      )
    ).filter((skill): skill is NonNullable<typeof skill> => skill !== null);
    if (skills.length === 0) return { status: 'error' };
    const digests = new Map(
      skills.map((skill) => [skill.installName, computeWellKnownSkillDigest(skill)])
    );
    for (const item of needsContentCheck) {
      const digest = digests.get(item.name);
      if (!digest || !item.digest || digest !== item.digest) {
        changedSkills.push(item.name);
      }
    }
  }

  if (changedSkills.length === 0 && removedSkills.length === 0) {
    return { status: 'current', newSkills };
  }
  return { status: 'changed', changedSkills, removedSkills, newSkills };
}

function printNewSkills(baseUrl: string, newSkills: string[], isGlobal: boolean): void {
  if (newSkills.length === 0) return;
  const names = newSkills.map(sanitizeMetadata);
  console.log(
    `  ${DIM}${newSkills.length} new skill(s) available from this source:${RESET} ${names.join(', ')}`
  );
  console.log(
    `    ${DIM}To install: ${TEXT}npx skills add ${baseUrl} --skill ${names.join(' ')}${isGlobal ? ' -g' : ''}${RESET}`
  );
}

export async function processWellKnownUpdates(
  groups: Map<string, WellKnownUpdateItem[]>,
  isGlobal: boolean,
  options: UpdateCheckOptions
): Promise<{ successCount: number; failCount: number; changed: boolean }> {
  let successCount = 0;
  let failCount = 0;
  let changed = false;

  for (const [baseUrl, items] of groups) {
    process.stdout.write(`\r${DIM}Checking skills from source: ${baseUrl}${RESET}\x1b[K\n`);

    const result = await checkWellKnownForUpdates(baseUrl, items);

    if (result.status === 'error') {
      console.log(`  ${DIM}✗ Failed to check skills from ${baseUrl}${RESET}`);
      continue;
    }

    if (result.status === 'current') {
      printNewSkills(baseUrl, result.newSkills, isGlobal);
      continue;
    }

    changed = true;

    await promptDeletions(baseUrl, result.removedSkills, isGlobal, options);
    printNewSkills(baseUrl, result.newSkills, isGlobal);

    if (result.changedSkills.length === 0) continue;

    const cliEntry = join(__dirname, '..', 'bin', 'cli.mjs');
    if (!existsSync(cliEntry)) {
      failCount += result.changedSkills.length;
      console.log(`  ${DIM}✗ CLI entrypoint not found at ${cliEntry}${RESET}`);
      continue;
    }

    const itemByName = new Map(items.map((item) => [item.name, item]));

    for (const name of result.changedSkills) {
      const safeName = sanitizeMetadata(name);
      console.log(`${TEXT}Updating ${safeName}…${RESET}`);

      const subagents = itemByName.get(name)?.subagents;
      const subagentArgs =
        !isGlobal && subagents?.length
          ? ['--subagent', ...subagents.map((s) => (s === '' ? 'root' : s))]
          : [];

      const spawnResult = spawnSync(
        process.execPath,
        [
          cliEntry,
          'add',
          baseUrl,
          '--skill',
          name,
          ...subagentArgs,
          ...(isGlobal ? ['-g'] : []),
          '-y',
        ],
        {
          stdio: ['inherit', 'pipe', 'pipe'],
          encoding: 'utf-8',
          shell: false,
        }
      );

      if (spawnResult.status === 0) {
        successCount++;
        console.log(`  ${TEXT}✓${RESET} Updated ${safeName}`);
      } else {
        failCount++;
        console.log(`  ${DIM}✗ Failed to update ${safeName}${RESET}`);
      }
    }
  }

  return { successCount, failCount, changed };
}

export async function updateGlobalSkills(
  options: UpdateCheckOptions = {}
): Promise<{ successCount: number; failCount: number; checkedCount: number }> {
  const lock = await readSkillLock();
  const skillNames = Object.keys(lock.skills);
  let successCount = 0;
  let failCount = 0;

  if (skillNames.length === 0) {
    if (!options.skills) {
      console.log(`${DIM}No global skills tracked in lock file.${RESET}`);
      console.log(`${DIM}Install skills with${RESET} ${TEXT}npx skills add <package> -g${RESET}`);
    }
    return { successCount, failCount, checkedCount: 0 };
  }

  const updates: Array<{ name: string; source: string; entry: SkillLockEntry }> = [];
  const skipped: SkippedSkill[] = [];
  const checkable: Array<{ name: string; entry: SkillLockEntry }> = [];
  const wellKnownGroups = new Map<string, WellKnownUpdateItem[]>();

  for (const skillName of skillNames) {
    if (!matchesSkillFilter(skillName, options.skills)) continue;

    const entry = lock.skills[skillName];
    if (!entry) continue;

    if (entry.sourceType === 'well-known' && entry.sourceBaseUrl && entry.wellKnownDigest) {
      const group = wellKnownGroups.get(entry.sourceBaseUrl) || [];
      group.push({ name: skillName, digest: entry.wellKnownDigest });
      wellKnownGroups.set(entry.sourceBaseUrl, group);
      continue;
    }

    if (!entry.skillFolderHash || !entry.skillPath) {
      skipped.push({
        name: skillName,
        reason: getSkipReason(entry),
        sourceUrl: entry.sourceUrl,
        sourceType: entry.sourceType,
        ref: entry.ref,
      });
      continue;
    }

    checkable.push({ name: skillName, entry });
  }

  const wellKnownCount = Array.from(wellKnownGroups.values()).reduce(
    (sum, items) => sum + items.length,
    0
  );
  const {
    successCount: wkSuccessCount,
    failCount: wkFailCount,
    changed: wkChanged,
  } = await processWellKnownUpdates(wellKnownGroups, true, options);
  successCount += wkSuccessCount;
  failCount += wkFailCount;

  const bySource = new Map<string, typeof checkable>();
  for (const item of checkable) {
    const source = item.entry.source;
    const existing = bySource.get(source) || [];
    existing.push(item);
    bySource.set(source, existing);
  }

  for (const [source, itemsForSource] of bySource) {
    const firstEntry = itemsForSource[0]!.entry;
    const sourceUrl = firstEntry.sourceUrl || firstEntry.source;
    let tempDir: string | null = null;

    process.stdout.write(`\r${DIM}Checking skills from source: ${source}${RESET}\x1b[K\n`);

    try {
      const isGitHubSource = firstEntry.sourceType === 'github';

      if (isGitHubSource) {
        const tree = await fetchRepoTree(source, firstEntry.ref, getGitHubToken);

        if (tree) {
          const discoveredPaths = tree.tree
            .filter((entry) => entry.type === 'blob')
            .map((entry) => entry.path);

          const allLockedForSource = Object.entries(lock.skills)
            .filter(([_, entry]) => entry.source === source)
            .map(([name, _]) => name);

          const deletedSkills = await checkAndPromptForDeletions(
            source,
            allLockedForSource,
            lock.skills,
            true,
            options,
            discoveredPaths
          );

          const deletedSkillSet = new Set(deletedSkills);

          for (const { name: skillName, entry } of itemsForSource) {
            if (deletedSkillSet.has(skillName)) continue;

            const latestHash = getSkillFolderHashFromTree(tree, entry.skillPath!);
            if (latestHash && latestHash !== entry.skillFolderHash) {
              updates.push({ name: skillName, source, entry });
            }
          }

          continue;
        }

        console.log(`  ${DIM}GitHub API unavailable; checking via Git clone${RESET}`);
      }

      tempDir = await cloneRepo(sourceUrl, firstEntry.ref);
      const discoveredPaths = (await discoverSkills(tempDir, undefined, { fullDepth: true })).map(
        (skill) => {
          return join(relative(tempDir!, skill.path), 'SKILL.md').split(sep).join('/');
        }
      );

      const allLockedForSource = Object.entries(lock.skills)
        .filter(([_, entry]) => entry.source === source)
        .map(([name, _]) => name);

      const deletedSkills = await checkAndPromptForDeletions(
        source,
        allLockedForSource,
        lock.skills,
        true,
        options,
        discoveredPaths
      );

      const deletedSkillSet = new Set(deletedSkills);

      for (const { name: skillName, entry } of itemsForSource) {
        if (deletedSkillSet.has(skillName)) continue;

        const skillPath = entry.skillPath!;
        if (!discoveredPaths.includes(skillPath)) continue;

        const usesGitTreeHash = isGitHubSource && /^[0-9a-f]{40}$/i.test(entry.skillFolderHash);
        const latestHash = usesGitTreeHash
          ? await getGitTreeHash(tempDir, skillPath)
          : await computeSkillFolderHash(join(tempDir, dirname(skillPath)));
        if (latestHash && latestHash !== entry.skillFolderHash) {
          updates.push({ name: skillName, source, entry });
        }
      }
    } catch (error) {
      console.log(`  ${DIM}✗ Failed to check skills from ${source}${RESET}`);
    } finally {
      if (tempDir) await cleanupTempDir(tempDir);
    }
  }

  if (checkable.length > 0) {
    process.stdout.write('\r\x1b[K');
  }

  const checkedCount = checkable.length + skipped.length + wellKnownCount;

  if (checkable.length === 0 && skipped.length === 0 && wellKnownCount === 0) {
    if (!options.skills) {
      console.log(`${DIM}No global skills to check.${RESET}`);
    }
    return { successCount, failCount, checkedCount: 0 };
  }

  if (checkable.length === 0 && skipped.length === 0) {
    if (!wkChanged) {
      console.log(`${TEXT}✓ All global skills are up to date${RESET}`);
    }
    return { successCount, failCount, checkedCount };
  }

  if (checkable.length === 0 && skipped.length > 0) {
    printSkippedSkills(skipped);
    return { successCount, failCount, checkedCount };
  }

  if (updates.length === 0) {
    if (!wkChanged) {
      console.log(`${TEXT}✓ All global skills are up to date${RESET}`);
    }
    return { successCount, failCount, checkedCount };
  }

  console.log(`${TEXT}Found ${updates.length} global update(s)${RESET}`);
  console.log();

  for (const update of updates) {
    const safeName = sanitizeMetadata(update.name);
    console.log(`${TEXT}Updating ${safeName}…${RESET}`);
    const installUrl = buildUpdateInstallSource(update.entry);
    if (!installUrl) {
      failCount++;
      console.log(
        `  ${DIM}✗ Cannot update ${safeName}: lock file is missing sourceUrl for this generic Git source${RESET}`
      );
      continue;
    }

    const cliEntry = join(__dirname, '..', 'bin', 'cli.mjs');
    if (!existsSync(cliEntry)) {
      failCount++;
      console.log(
        `  ${DIM}✗ Failed to update ${safeName}: CLI entrypoint not found at ${cliEntry}${RESET}`
      );
      continue;
    }
    const fullDepthArgs = shouldUseFullDepthForUpdate(update.entry) ? ['--full-depth'] : [];
    const result = spawnSync(
      process.execPath,
      [cliEntry, 'add', installUrl, '--skill', update.name, ...fullDepthArgs, '-g', '-y'],
      {
        stdio: ['inherit', 'pipe', 'pipe'],
        encoding: 'utf-8',
        env: getUpdateChildEnv(update.entry.sourceType),
        // Never spawn through a shell. process.execPath is an absolute path to the
        // node binary, so no shell is needed to resolve it. installUrl is derived
        // from the lock file (and ref is URL-decoded, so influenceable by whoever
        // publishes a skill); a shell on Windows would let metacharacters in that
        // value inject commands. Passing argv directly keeps it inert.
        shell: false,
      }
    );

    if (result.status === 0) {
      successCount++;
      console.log(`  ${TEXT}✓${RESET} Updated ${safeName}`);
    } else {
      failCount++;
      console.log(`  ${DIM}✗ Failed to update ${safeName}${RESET}`);
    }
  }

  printSkippedSkills(skipped);
  return { successCount, failCount, checkedCount };
}

export async function updateProjectSkills(
  options: UpdateCheckOptions = {}
): Promise<{ successCount: number; failCount: number; foundCount: number }> {
  const projectSkills = await getProjectSkillsForUpdate(options.skills);
  let successCount = 0;
  let failCount = 0;

  if (projectSkills.length === 0) {
    if (!options.skills) {
      console.log(`${DIM}No project skills to update.${RESET}`);
      console.log(
        `${DIM}Install project skills with${RESET} ${TEXT}npx skills add <package>${RESET}`
      );
    }
    return { successCount, failCount, foundCount: 0 };
  }

  const wellKnownGroups = new Map<string, WellKnownUpdateItem[]>();
  const nonWellKnown: typeof projectSkills = [];
  for (const skill of projectSkills) {
    const { entry } = skill;
    if (entry.sourceType === 'well-known' && entry.sourceUrl && entry.wellKnownDigest) {
      const group = wellKnownGroups.get(entry.sourceUrl) || [];
      group.push({
        name: skill.name,
        digest: entry.wellKnownDigest,
        subagents: entry.subagents,
      });
      wellKnownGroups.set(entry.sourceUrl, group);
    } else {
      nonWellKnown.push(skill);
    }
  }
  const wellKnownCount = Array.from(wellKnownGroups.values()).reduce(
    (sum, items) => sum + items.length,
    0
  );

  const updatable = nonWellKnown.filter((s) => s.entry.skillPath);
  const legacy = nonWellKnown.filter((s) => !s.entry.skillPath);

  if (updatable.length === 0 && wellKnownCount === 0) {
    console.log(`${DIM}No project skills can be updated in place.${RESET}`);
    printLegacyProjectSkills(legacy);
    return { successCount, failCount, foundCount: projectSkills.length };
  }

  const cwd = process.cwd();
  const targetAgentNames: string[] = [];
  let hasUniversal = false;

  for (const [type, config] of Object.entries(agents)) {
    if (isUniversalAgent(type as AgentType)) {
      if (!hasUniversal && existsSync(join(cwd, '.agents'))) {
        hasUniversal = true;
      }
    } else {
      const agentRoot = config.skillsDir.split('/')[0]!;
      if (existsSync(join(cwd, agentRoot))) {
        targetAgentNames.push(config.displayName);
      }
    }
  }

  const targetParts: string[] = [];
  if (hasUniversal) targetParts.push('Universal');
  targetParts.push(...targetAgentNames);

  if (targetParts.length > 0) {
    console.log(`${TEXT}Updating for: ${targetParts.join(', ')}${RESET}`);
  }

  console.log(`${TEXT}Refreshing ${updatable.length + wellKnownCount} skill(s)…${RESET}`);
  console.log();

  const { successCount: wkSuccessCount, failCount: wkFailCount } = await processWellKnownUpdates(
    wellKnownGroups,
    false,
    options
  );
  successCount += wkSuccessCount;
  failCount += wkFailCount;

  const bySource = new Map<string, typeof updatable>();
  for (const skill of updatable) {
    const source = skill.entry.sourceUrl || skill.entry.source;
    const existing = bySource.get(source) || [];
    existing.push(skill);
    bySource.set(source, existing);
  }

  const localLock = await readLocalLock();
  const cliEntry = join(__dirname, '..', 'bin', 'cli.mjs');

  if (updatable.length > 0 && !existsSync(cliEntry)) {
    console.log(`${DIM}✗ CLI entrypoint not found at ${cliEntry}${RESET}`);
    return {
      successCount,
      failCount: failCount + updatable.length,
      foundCount: projectSkills.length,
    };
  }

  for (const [source, skillsForSource] of bySource) {
    const firstEntry = skillsForSource[0]!.entry;
    const cloneSource = buildLocalCloneSource(firstEntry);
    const ref = firstEntry.ref;

    const allLockedForSource = Object.entries(localLock.skills)
      .filter(([_, entry]) => (entry.sourceUrl || entry.source) === source)
      .map(([name, _]) => name);

    let tempDir: string | null = null;
    let deletedSkills: string[] = [];

    if (cloneSource === null) {
      failCount += skillsForSource.length;
      console.log(
        `${DIM}✗ Cannot update ${source}: skills-lock.json is missing sourceUrl for this generic Git source${RESET}`
      );
      continue;
    }

    try {
      tempDir = await cloneRepo(cloneSource, ref);
      const discovered = await discoverSkills(tempDir, undefined, { fullDepth: true });

      const discoveredPaths = discovered.map((s) => {
        const relPath = relative(tempDir!, s.path);
        return join(relPath, 'SKILL.md').split(sep).join('/');
      });

      deletedSkills = await checkAndPromptForDeletions(
        source,
        allLockedForSource,
        localLock.skills,
        false,
        options,
        discoveredPaths
      );
    } catch (error) {
      console.log(`${DIM}✗ Failed to check for deleted skills from ${source}${RESET}`);
    } finally {
      if (tempDir) {
        await cleanupTempDir(tempDir);
      }
    }

    const remainingSkills = skillsForSource.filter((s) => !deletedSkills.includes(s.name));

    for (const skill of remainingSkills) {
      const safeName = sanitizeMetadata(skill.name);
      console.log(`${TEXT}Updating ${safeName}…${RESET}`);
      const installUrl = buildLocalUpdateSource(skill.entry);
      if (!installUrl) {
        failCount++;
        console.log(
          `  ${DIM}✗ Cannot update ${safeName}: skills-lock.json is missing sourceUrl for this generic Git source${RESET}`
        );
        continue;
      }

      // Preserve Eve subagent placement recorded at install time. The lock stores
      // '' for the root agent, which maps to the `root` keyword for `add --subagent`.
      const subagentArgs = skill.entry.subagents?.length
        ? ['--subagent', ...skill.entry.subagents.map((s) => (s === '' ? 'root' : s))]
        : [];
      const fullDepthArgs = shouldUseFullDepthForUpdate(skill.entry) ? ['--full-depth'] : [];

      const result = spawnSync(
        process.execPath,
        [
          cliEntry,
          'add',
          installUrl,
          '--skill',
          skill.name,
          ...subagentArgs,
          ...fullDepthArgs,
          '-y',
        ],
        {
          stdio: ['inherit', 'pipe', 'pipe'],
          encoding: 'utf-8',
          env: getUpdateChildEnv(skill.entry.sourceType),
          // Never spawn through a shell — same reasoning as updateGlobalSkills:
          // execPath is absolute (no shell resolution needed) and installUrl/ref
          // come from the lock file, so a shell would allow command injection on
          // Windows. Pass argv directly instead.
          shell: false,
        }
      );

      if (result.status === 0) {
        successCount++;
        console.log(`  ${TEXT}✓${RESET} Updated ${safeName}`);
      } else {
        failCount++;
        console.log(`  ${DIM}✗ Failed to update ${safeName}${RESET}`);
      }
    }
  }

  printLegacyProjectSkills(legacy);
  return { successCount, failCount, foundCount: projectSkills.length };
}

export function printLegacyProjectSkills(
  legacy: Array<{ name: string; source: string; entry: LocalSkillLockEntry }>
): void {
  if (legacy.length === 0) return;
  console.log();
  console.log(
    `${DIM}${legacy.length} project skill(s) cannot be updated automatically (installed before skillPath tracking):${RESET}`
  );
  for (const skill of legacy) {
    const reinstall = buildLocalUpdateSource(skill.entry);
    console.log(`  ${TEXT}•${RESET} ${sanitizeMetadata(skill.name)}`);
    if (reinstall) {
      console.log(`    ${DIM}To refresh: ${TEXT}npx skills add ${reinstall} -y${RESET}`);
    } else {
      console.log(
        `    ${DIM}To refresh: reinstall using the original full Git URL; this lock entry only has an ambiguous shorthand.${RESET}`
      );
    }
  }
}

export async function runUpdate(args: string[] = []): Promise<void> {
  const options = parseUpdateOptions(args);
  const scope = await resolveUpdateScope(options);

  if (options.skills) {
    console.log(`${TEXT}Updating ${options.skills.join(', ')}…${RESET}`);
  } else {
    console.log(`${TEXT}Checking for skill updates…${RESET}`);
  }
  console.log();

  let totalSuccess = 0;
  let totalFail = 0;
  let totalFound = 0;

  if (scope === 'global' || scope === 'both') {
    if (scope === 'both' && !options.skills) {
      console.log(`${BOLD}Global Skills${RESET}`);
    }
    const { successCount, failCount, checkedCount } = await updateGlobalSkills(options);
    totalSuccess += successCount;
    totalFail += failCount;
    totalFound += checkedCount;
    if (scope === 'both' && !options.skills) {
      console.log();
    }
  }

  if (scope === 'project' || scope === 'both') {
    if (scope === 'both' && !options.skills) {
      console.log(`${BOLD}Project Skills${RESET}`);
    }
    const { successCount, failCount, foundCount } = await updateProjectSkills(options);
    totalSuccess += successCount;
    totalFail += failCount;
    totalFound += foundCount;
  }

  if (options.skills && totalFound === 0) {
    console.log(`${DIM}No installed skills found matching: ${options.skills.join(', ')}${RESET}`);
  }

  console.log();
  if (totalSuccess > 0) {
    console.log(`${TEXT}✓ Updated ${totalSuccess} skill(s)${RESET}`);
  }
  if (totalFail > 0) {
    console.log(`${DIM}Failed to update ${totalFail} skill(s)${RESET}`);
    process.exitCode = 1;
  }

  track({
    event: 'update',
    scope,
    skillCount: String(totalSuccess + totalFail),
    successCount: String(totalSuccess),
    failCount: String(totalFail),
  });

  console.log();
}
