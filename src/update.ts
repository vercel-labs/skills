import { spawnSync } from 'child_process';
import { existsSync, readdirSync } from 'fs';
import { join, dirname, relative, sep } from 'path';
import { fileURLToPath } from 'url';
import * as p from '@clack/prompts';
import pc from 'picocolors';

import {
  readSkillLock,
  fetchSkillFolderHash,
  getGitHubToken,
  type SkillLockEntry,
} from './skill-lock.ts';
import { readLocalLock, type LocalSkillLockEntry } from './local-lock.ts';
import {
  formatSourceInput,
  buildUpdateInstallSource,
  buildLocalUpdateSource,
} from './update-source.ts';
import { cloneRepo, cleanupTempDir } from './git.ts';
import { discoverSkills } from './skills.ts';
import { fetchRepoTree, findSkillMdPaths, getSkillFolderHashFromTree } from './blob.ts';
import { parsePluginManifests } from './plugin-manifest.ts';
import { toCloneUrl } from './remote-plugin.ts';
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
  if (entry.resolvedFrom) {
    return 'Marketplace remote plugin (update with project scope)';
  }
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
    if (entry.sourceType === 'node_modules') {
      continue;
    }
    // Local sources can't be re-fetched — unless they're a marketplace whose
    // entries resolve to remote repositories (resolvedFrom present).
    if (entry.sourceType === 'local' && !entry.resolvedFrom) {
      continue;
    }
    skills.push({ name, source: entry.source, entry });
  }

  return skills;
}

// ============================================
// Remote Plugin Entries (marketplace remote sources)
// ============================================

export interface RemotePluginCheckResult {
  /** Skills whose marketplace entry is unchanged — safe to reinstall */
  updatable: string[];
  /** Skills whose plugin is no longer declared by the marketplace */
  deleted: string[];
  /** Skills whose resolved source changed and the change was not accepted */
  sourceChanged: string[];
}

/**
 * Check remote-plugin lock entries against the marketplace's current manifest.
 *
 * Implements the warn-on-change trust model:
 * - plugin gone from the manifest → offer removal (like deleted upstream)
 * - resolved source (url/path) changed → ask for consent; in non-interactive
 *   mode the skill is skipped so a redirected source never auto-installs in CI
 * - a local skill of the same name now ships in the marketplace → the content
 *   source would flip from the domain repo to the marketplace-local skill: a
 *   remote→local source change, handled with the same consent flow
 * - source unchanged → eligible for reinstall
 *
 * localSkillNames are the names of skills discovered on disk in the marketplace
 * itself; a collision with an installed remote-plugin skill is a source change.
 */
export async function checkRemotePluginEntries(
  source: string,
  remoteEntries: Array<{ name: string; entry: LocalSkillLockEntry }>,
  manifestBase: string,
  options: UpdateCheckOptions,
  localSkillNames: string[] = []
): Promise<RemotePluginCheckResult> {
  const result: RemotePluginCheckResult = { updatable: [], deleted: [], sourceChanged: [] };
  if (remoteEntries.length === 0) return result;

  const manifest = await parsePluginManifests(manifestBase);
  const isNonInteractive = options.yes || !process.stdin.isTTY;
  const localSkillNameSet = new Set(localSkillNames.map((n) => n.toLowerCase()));

  for (const { name, entry } of remoteEntries) {
    const resolvedFrom = entry.resolvedFrom!;
    const plugin = manifest.remotePlugins.find((rp) => rp.name === resolvedFrom.pluginName);

    if (!plugin) {
      result.deleted.push(name);
      continue;
    }

    const currentUrl = toCloneUrl(plugin.source);
    const currentPath = plugin.source.source === 'git-subdir' ? plugin.source.path : undefined;

    // A local skill of the same name now in the marketplace would shadow the
    // remote plugin in `add` (local wins) — the content source would flip from
    // the domain repo to the marketplace-local skill.
    const shadowedByLocal = localSkillNameSet.has(name.toLowerCase());

    if (shadowedByLocal || currentUrl !== resolvedFrom.url || currentPath !== resolvedFrom.path) {
      // The marketplace now points somewhere else than what was installed
      console.log();
      console.log(
        `${DIM}Warning:${RESET} ${BOLD}${sanitizeMetadata(name)}${RESET} resolved source changed:`
      );
      console.log(
        `  ${DIM}was:${RESET} ${resolvedFrom.url}${resolvedFrom.path ? ` (${resolvedFrom.path})` : ''}`
      );
      if (shadowedByLocal) {
        console.log(`  ${DIM}now:${RESET} local skill in ${source}`);
      } else {
        console.log(`  ${DIM}now:${RESET} ${currentUrl}${currentPath ? ` (${currentPath})` : ''}`);
      }

      if (isNonInteractive) {
        console.log(
          `  ${DIM}Skipping in non-interactive mode. Run interactively to review and accept.${RESET}`
        );
        result.sourceChanged.push(name);
        continue;
      }

      const accepted = await p.confirm({
        message: `Accept the new source for ${sanitizeMetadata(name)} and update?`,
      });

      if (!accepted || p.isCancel(accepted)) {
        result.sourceChanged.push(name);
        continue;
      }
    }

    result.updatable.push(name);
  }

  // Offer to remove skills whose plugin disappeared from the marketplace
  if (result.deleted.length > 0) {
    console.log();
    console.log(
      `${DIM}Warning:${RESET} The following skills are no longer declared by ${DIM}${source}${RESET}:`
    );
    for (const s of result.deleted) {
      console.log(`  ${DIM}•${RESET} ${sanitizeMetadata(s)}`);
    }

    if (options.yes || !process.stdin.isTTY) {
      console.log(`${DIM}Skipping deletion in non-interactive mode.${RESET}`);
    } else {
      const confirmed = await p.confirm({
        message: 'Would you like to remove the local copies of these skills?',
      });

      if (confirmed && !p.isCancel(confirmed)) {
        for (const s of result.deleted) {
          console.log(`${DIM}Removing${RESET} ${s}...`);
          await removeCommand([s], { yes: true, global: false });
        }
      }
    }
  }

  return result;
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

  if (deletedSkills.length > 0) {
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
    } else {
      const confirmed = await p.confirm({
        message: `Would you like to remove the local copies of these deleted skills?`,
      });

      if (confirmed && !p.isCancel(confirmed)) {
        for (const s of deletedSkills) {
          console.log(`${DIM}Removing${RESET} ${s}...`);
          await removeCommand([s], { yes: true, global: isGlobal });
        }
      }
    }
  }
  return deletedSkills;
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

  for (const skillName of skillNames) {
    if (!matchesSkillFilter(skillName, options.skills)) continue;

    const entry = lock.skills[skillName];
    if (!entry) continue;

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

  const bySource = new Map<string, typeof checkable>();
  for (const item of checkable) {
    const source = item.entry.source;
    const existing = bySource.get(source) || [];
    existing.push(item);
    bySource.set(source, existing);
  }

  for (const [source, itemsForSource] of bySource) {
    const firstEntry = itemsForSource[0]!.entry;

    process.stdout.write(`\r${DIM}Checking skills from source: ${source}${RESET}\x1b[K\n`);

    try {
      const tree = await fetchRepoTree(source, firstEntry.ref, getGitHubToken);

      if (tree) {
        const discoveredPaths = findSkillMdPaths(tree);

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

        for (const { name: skillName, entry } of itemsForSource) {
          const latestHash = getSkillFolderHashFromTree(tree, entry.skillPath!);
          if (latestHash && latestHash !== entry.skillFolderHash) {
            updates.push({ name: skillName, source, entry });
          }
        }
      } else {
        console.log(`  ${DIM}✗ Failed to fetch tree for ${source}${RESET}`);
      }
    } catch (error) {
      console.log(`  ${DIM}✗ Error checking skills from ${source}${RESET}`);
    }
  }

  if (checkable.length > 0) {
    process.stdout.write('\r\x1b[K');
  }

  const checkedCount = checkable.length + skipped.length;

  if (checkable.length === 0 && skipped.length === 0) {
    if (!options.skills) {
      console.log(`${DIM}No global skills to check.${RESET}`);
    }
    return { successCount, failCount, checkedCount: 0 };
  }

  if (checkable.length === 0 && skipped.length > 0) {
    printSkippedSkills(skipped);
    return { successCount, failCount, checkedCount };
  }

  if (updates.length === 0) {
    console.log(`${TEXT}✓ All global skills are up to date${RESET}`);
    return { successCount, failCount, checkedCount };
  }

  console.log(`${TEXT}Found ${updates.length} global update(s)${RESET}`);
  console.log();

  for (const update of updates) {
    const safeName = sanitizeMetadata(update.name);
    console.log(`${TEXT}Updating ${safeName}...${RESET}`);
    const installUrl = buildUpdateInstallSource(update.entry);

    const cliEntry = join(__dirname, '..', 'bin', 'cli.mjs');
    if (!existsSync(cliEntry)) {
      failCount++;
      console.log(
        `  ${DIM}✗ Failed to update ${safeName}: CLI entrypoint not found at ${cliEntry}${RESET}`
      );
      continue;
    }
    const result = spawnSync(process.execPath, [cliEntry, 'add', installUrl, '-g', '-y'], {
      stdio: ['inherit', 'pipe', 'pipe'],
      encoding: 'utf-8',
      shell: process.platform === 'win32',
    });

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

export async function updateProjectSkills(options: UpdateCheckOptions = {}): Promise<{
  successCount: number;
  failCount: number;
  foundCount: number;
  sourceChangedCount: number;
}> {
  const projectSkills = await getProjectSkillsForUpdate(options.skills);
  let successCount = 0;
  let failCount = 0;
  let sourceChangedCount = 0;

  if (projectSkills.length === 0) {
    if (!options.skills) {
      console.log(`${DIM}No project skills to update.${RESET}`);
      console.log(
        `${DIM}Install project skills with${RESET} ${TEXT}npx skills add <package>${RESET}`
      );
    }
    return { successCount, failCount, foundCount: 0, sourceChangedCount };
  }

  // Skills are updatable when we know how to re-fetch them: either by their
  // path within the source repo, or via their marketplace remote plugin entry.
  const updatable = projectSkills.filter((s) => s.entry.skillPath || s.entry.resolvedFrom);
  const legacy = projectSkills.filter((s) => !s.entry.skillPath && !s.entry.resolvedFrom);

  if (updatable.length === 0) {
    console.log(`${DIM}No project skills can be updated in place.${RESET}`);
    printLegacyProjectSkills(legacy);
    return { successCount, failCount, foundCount: projectSkills.length, sourceChangedCount };
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

  console.log(`${TEXT}Refreshing ${updatable.length} skill(s)...${RESET}`);
  console.log();

  const bySource = new Map<string, typeof updatable>();
  for (const skill of updatable) {
    const source = skill.entry.source;
    const existing = bySource.get(source) || [];
    existing.push(skill);
    bySource.set(source, existing);
  }

  const localLock = await readLocalLock();
  const cliEntry = join(__dirname, '..', 'bin', 'cli.mjs');

  if (!existsSync(cliEntry)) {
    console.log(`${DIM}✗ CLI entrypoint not found at ${cliEntry}${RESET}`);
    return {
      successCount,
      failCount: updatable.length,
      foundCount: projectSkills.length,
      sourceChangedCount,
    };
  }

  for (const [source, skillsForSource] of bySource) {
    const firstEntry = skillsForSource[0]!.entry;
    const sourceUrl = firstEntry.source;
    const ref = firstEntry.ref;

    const allLockedForSource = Object.entries(localLock.skills)
      .filter(([_, entry]) => entry.source === source)
      .map(([name, _]) => name);

    // Remote-plugin entries are checked against the marketplace manifest
    // (warn-on-change); regular entries against discovered SKILL.md paths.
    const remoteEntries = skillsForSource.filter((s) => s.entry.resolvedFrom);

    let tempDir: string | null = null;
    let deletedSkills: string[] = [];
    let remoteCheck: RemotePluginCheckResult = { updatable: [], deleted: [], sourceChanged: [] };
    let checkFailed = false;

    try {
      // Local marketplace sources are read in place; everything else is cloned
      let manifestBase: string;
      if (firstEntry.sourceType === 'local') {
        if (!existsSync(sourceUrl)) {
          throw new Error(`Local marketplace path not found: ${sourceUrl}`);
        }
        manifestBase = sourceUrl;
      } else {
        tempDir = await cloneRepo(sourceUrl, ref);
        manifestBase = tempDir;
      }

      const discovered = await discoverSkills(manifestBase);

      const discoveredPaths = discovered.map((s) => {
        const relPath = relative(manifestBase, s.path);
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

      remoteCheck = await checkRemotePluginEntries(
        source,
        remoteEntries,
        manifestBase,
        options,
        discovered.map((s) => s.name)
      );
    } catch (error) {
      console.log(`${DIM}✗ Failed to check for deleted skills from ${source}${RESET}`);
      checkFailed = true;
    } finally {
      if (tempDir) {
        await cleanupTempDir(tempDir);
      }
    }

    sourceChangedCount += remoteCheck.sourceChanged.length;

    const remainingSkills = skillsForSource.filter((s) => {
      if (deletedSkills.includes(s.name)) return false;
      // Remote-plugin skills only update when the manifest check confirmed them
      if (s.entry.resolvedFrom) {
        return !checkFailed && remoteCheck.updatable.includes(s.name);
      }
      return true;
    });

    for (const skill of remainingSkills) {
      const safeName = sanitizeMetadata(skill.name);
      console.log(`${TEXT}Updating ${safeName}...${RESET}`);
      const installUrl = formatSourceInput(skill.entry.source, skill.entry.ref);

      const result = spawnSync(
        process.execPath,
        [cliEntry, 'add', installUrl, '--skill', skill.name, '-y'],
        {
          stdio: ['inherit', 'pipe', 'pipe'],
          encoding: 'utf-8',
          shell: process.platform === 'win32',
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
  return { successCount, failCount, foundCount: projectSkills.length, sourceChangedCount };
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
    const reinstall = formatSourceInput(skill.entry.source, skill.entry.ref);
    console.log(`  ${TEXT}•${RESET} ${sanitizeMetadata(skill.name)}`);
    console.log(`    ${DIM}To refresh: ${TEXT}npx skills add ${reinstall} -y${RESET}`);
  }
}

export async function runUpdate(args: string[] = []): Promise<void> {
  const options = parseUpdateOptions(args);
  const scope = await resolveUpdateScope(options);

  if (options.skills) {
    console.log(`${TEXT}Updating ${options.skills.join(', ')}...${RESET}`);
  } else {
    console.log(`${TEXT}Checking for skill updates...${RESET}`);
  }
  console.log();

  let totalSuccess = 0;
  let totalFail = 0;
  let totalFound = 0;
  let totalSourceChanged = 0;

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
    const { successCount, failCount, foundCount, sourceChangedCount } =
      await updateProjectSkills(options);
    totalSuccess += successCount;
    totalFail += failCount;
    totalFound += foundCount;
    totalSourceChanged += sourceChangedCount;
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
  }

  track({
    event: 'update',
    scope,
    skillCount: String(totalSuccess + totalFail),
    successCount: String(totalSuccess),
    failCount: String(totalFail),
  });

  console.log();

  // Skills skipped because their marketplace entry now points at a different
  // repository require explicit review — exit non-zero so CI surfaces it.
  if (totalSourceChanged > 0) {
    console.log(
      `${DIM}⚠ ${totalSourceChanged} skill(s) skipped: resolved source changed. Run ${TEXT}npx skills update${DIM} interactively to review.${RESET}`
    );
    console.log();
    process.exit(1);
  }
}
