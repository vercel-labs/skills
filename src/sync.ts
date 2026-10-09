import * as p from '@clack/prompts';
import pc from 'picocolors';
import { existsSync } from 'fs';
import { lstat, readdir, readFile, readlink, realpath, rm } from 'fs/promises';
import { basename, dirname, join, posix, resolve, sep } from 'path';
import { homedir } from 'os';
import { hasSkillMd, parseSkillMd } from './skills.ts';
import {
  installSkillForAgent,
  getCanonicalPath,
  getCanonicalSkillsDir,
  getInstallPath,
  sanitizeName,
  type InstallMode,
} from './installer.ts';
import {
  detectInstalledAgents,
  agents,
  getUniversalAgents,
  getVisibleUniversalAgents,
  getNonUniversalAgents,
} from './agents.ts';
import { searchMultiselect } from './prompts/search-multiselect.ts';
import {
  addSkillToLocalLock,
  computeSkillFolderHash,
  readLocalLock,
  writeLocalLock,
  type LocalSkillLockEntry,
  type LocalSkillLockFile,
} from './local-lock.ts';
import type { Skill, AgentType } from './types.ts';
import { track } from './telemetry.ts';
import { detectAgent, getAgentType } from './detect-agent.ts';
import { getLastSelectedAgents, saveSelectedAgents } from './skill-lock.ts';
import { parseSkillsField, type RemoteSkillsRequest } from './skills-field.ts';
import { getProjectLockSource, installFromSource } from './add.ts';

const isCancelled = (value: unknown): value is symbol => typeof value === 'symbol';

export interface SyncOptions {
  agent?: string[];
  yes?: boolean;
  copy?: boolean;
  dryRun?: boolean;
  cleanup?: boolean;
  include?: string[];
  exclude?: string[];
  remote?: boolean;
}

/**
 * `<package>` matches every skill of a package, `<package>#<skill>` one of them.
 * Both parts are globs. Package names cannot contain `#`, so the split is unambiguous.
 */
function matchesSkill(skill: PackageSkill, patterns: string[]): boolean {
  return patterns.some((pattern) => {
    const hash = pattern.indexOf('#');
    const packagePattern = hash === -1 ? pattern : pattern.slice(0, hash);
    const skillPattern = hash === -1 ? '**' : pattern.slice(hash + 1);
    return (
      posix.matchesGlob(skill.packageName, packagePattern) &&
      posix.matchesGlob(sanitizeName(skill.name), skillPattern)
    );
  });
}

/**
 * Shortens a path for display: replaces homedir with ~ and cwd with .
 */
function shortenPath(fullPath: string, cwd: string): string {
  const home = homedir();
  if (fullPath === home || fullPath.startsWith(home + sep)) {
    return '~' + fullPath.slice(home.length);
  }
  if (fullPath === cwd || fullPath.startsWith(cwd + sep)) {
    return '.' + fullPath.slice(cwd.length);
  }
  return fullPath;
}

interface PackageSkill extends Skill {
  packageName: string;
  packageVersion?: string;
  /** `"private": true` in package.json, e.g. a linked workspace package; never published. */
  packagePrivate?: boolean;
  /** Path to SKILL.md relative to the package root, e.g. `skills/pdf/SKILL.md`. */
  skillPath: string;
  /** Package whose `skills` field requested this skill (`.` for the project). */
  via?: string;
  /** 0 for direct dependencies and the project's own `skills` field, +1 per `npm:` hop. */
  depth: number;
}

interface PackageJson {
  version?: string;
  private?: boolean;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  /** Validated by parseSkillsField. */
  skills?: unknown;
}

async function readPackageJson(dir: string): Promise<PackageJson | null> {
  try {
    return JSON.parse(await readFile(join(dir, 'package.json'), 'utf-8'));
  } catch {
    return null;
  }
}

async function discoverPackageSkills(
  pkgDir: string,
  packageName: string,
  depth: number
): Promise<PackageSkill[]> {
  const pkg = await readPackageJson(pkgDir);
  if (!pkg) return []; // not installed

  const rootSkill = (await hasSkillMd(pkgDir))
    ? await parseSkillMd(join(pkgDir, 'SKILL.md'))
    : null;
  if (rootSkill) {
    return [
      {
        ...rootSkill,
        packageName,
        packageVersion: pkg.version,
        packagePrivate: pkg.private,
        skillPath: 'SKILL.md',
        depth,
      },
    ];
  }

  const skills: PackageSkill[] = [];
  for (const dir of ['skills', 'dist/skills']) {
    for (const name of await readdir(join(pkgDir, dir)).catch(() => [])) {
      const skillDir = join(pkgDir, dir, name);
      if (!(await hasSkillMd(skillDir))) continue;
      const skill = await parseSkillMd(join(skillDir, 'SKILL.md'));
      if (skill) {
        skills.push({
          ...skill,
          packageName,
          packageVersion: pkg.version,
          packagePrivate: pkg.private,
          skillPath: `${dir}/${name}/SKILL.md`,
          depth,
        });
      }
    }
  }
  return skills;
}

/**
 * Node's node_modules lookup from `from` (realpath, then walk up), so the
 * declaring package's own dependencies resolve in pnpm's isolated layout.
 */
function findInstalledPackage(from: string, name: string): string | undefined {
  for (let dir = from; ; dir = dirname(dir)) {
    const candidate = join(dir, 'node_modules', name);
    if (existsSync(join(candidate, 'package.json'))) return candidate;
    if (dirname(dir) === dir) return undefined;
  }
}

/**
 * Find skills shipped by the project's direct dependencies, plus the skills
 * that `npm:` entries in `skills` fields point at. Fields are read from the
 * project and its direct dependencies, then from every `npm:` target in turn.
 *
 * Only packages listed in package.json are scanned, so a transitive package
 * reaches the agent only when a direct dependency names it, and the package
 * manager's version resolution decides which copy of a package is seen.
 */
type FieldRemoteRequest = RemoteSkillsRequest & { via: string };

async function discoverNodeModuleSkills(cwd: string): Promise<{
  skills: PackageSkill[];
  remote: FieldRemoteRequest[];
  warnings: string[];
  errors: string[];
}> {
  const warnings: string[] = [];
  const errors: string[] = [];
  // identical requests from several packages are one
  const remote = new Map<string, FieldRemoteRequest>();
  const pkg = await readPackageJson(cwd);
  if (!pkg) return { skills: [], remote: [], warnings, errors };

  const skills: PackageSkill[] = [];
  const seen = new Set<string>();
  const add = async (found: PackageSkill[]) => {
    for (const skill of found) {
      const key = await realpath(skill.path).catch(() => skill.path);
      if (seen.has(key)) continue;
      seen.add(key);
      skills.push(skill);
    }
  };

  const deps = [
    ...new Set([...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})]),
  ];
  const shipped = await Promise.all(
    deps.map((name) => discoverPackageSkills(join(cwd, 'node_modules', name), name, 0))
  );
  await add(shipped.flat());

  // `depth` is what this declarer's npm: targets get
  const declarers = [
    { name: '.', dir: cwd, depth: 0 },
    ...deps.map((name) => ({ name, dir: join(cwd, 'node_modules', name), depth: 1 })),
  ];
  const visited = new Set<string>();
  for (const declarer of declarers) {
    const dir = await realpath(declarer.dir).catch(() => null);
    if (!dir || visited.has(dir)) continue;
    visited.add(dir);

    // the project's own field must be valid; a dependency's only produces warnings
    const problems = declarer.name === '.' ? errors : warnings;
    const field = (await readPackageJson(dir))?.skills;
    if (field === undefined) continue;
    if (!Array.isArray(field)) {
      // a dependency may use the key for something else
      if (problems === errors) errors.push('package.json: "skills" must be an array');
      continue;
    }

    const parsed = parseSkillsField(field, declarer.name);
    problems.push(...parsed.errors);
    for (const request of parsed.remote) {
      const { url, ref, subpath } = request.parsed;
      const key = JSON.stringify([url, ref, subpath, request.skills]);
      if (!remote.has(key)) remote.set(key, { ...request, via: declarer.name });
    }
    for (const request of parsed.npm) {
      const target = findInstalledPackage(dir, request.package);
      if (!target) {
        problems.push(
          `${declarer.name}: cannot resolve "npm:${request.package}"; is it a dependency?`
        );
        continue;
      }
      const found = await discoverPackageSkills(target, request.package, declarer.depth);
      await add(
        found
          .filter(
            (skill) =>
              request.skills.length === 0 ||
              request.skills.includes(basename(skill.path)) ||
              request.skills.includes(sanitizeName(skill.name))
          )
          .map((skill) => ({ ...skill, via: declarer.name }))
      );
      declarers.push({ name: request.package, dir: target, depth: declarer.depth + 1 });
    }
  }

  return { skills, remote: [...remote.values()], warnings, errors };
}

function isUnderNodeModules(path: string): boolean {
  return path.split(sep).includes('node_modules');
}

/** Sync installed this skill: shipped by a package, or requested by a `skills` field. */
function installedBySync(entry: LocalSkillLockEntry | undefined): boolean {
  return entry?.sourceType === 'node_modules' || entry?.via !== undefined;
}

/**
 * Why `dest` must not be touched, or null when it is free or already ours.
 * Sync owns a symlink whose target is in node_modules or is the canonical dir,
 * and a real directory whose lock entry sync wrote.
 */
async function foreignDestination(
  dest: string,
  canonicalDir: string,
  lockEntry: LocalSkillLockEntry | undefined,
  cwd: string
): Promise<string | null> {
  let stats;
  try {
    stats = await lstat(dest);
  } catch {
    return null;
  }
  if (stats.isSymbolicLink()) {
    const target = resolve(dirname(dest), await readlink(dest));
    if (isUnderNodeModules(target) || target === canonicalDir) return null;
    return `${shortenPath(dest, cwd)} is a symlink to ${shortenPath(target, cwd)}`;
  }
  if (installedBySync(lockEntry)) return null;
  return `${shortenPath(dest, cwd)} already exists and was not installed by sync`;
}

async function linksIntoNodeModules(path: string): Promise<boolean> {
  try {
    if (!(await lstat(path)).isSymbolicLink()) return false;
    return isUnderNodeModules(resolve(dirname(path), await readlink(path)));
  } catch {
    return false;
  }
}

/**
 * Remove skills that sync installed earlier and nothing provides anymore.
 * A name is a candidate when its lock entry comes from node_modules, or from a
 * remote `skills` entry that `keepRemote` rejects, or when its canonical dir
 * links into node_modules. Only destinations sync owns are removed.
 */
async function pruneStaleSkills(
  cwd: string,
  keep: Set<string>,
  keepRemote: (entry: LocalSkillLockEntry) => boolean,
  lock: LocalSkillLockFile,
  dryRun: boolean
): Promise<string[]> {
  const canonicalBase = getCanonicalSkillsDir(false, cwd);
  const lockKeys = new Map<string, string>();
  const explicit = new Set<string>();
  for (const [key, entry] of Object.entries(lock.skills)) {
    const remote = entry.sourceType !== 'node_modules';
    if (installedBySync(entry) && !(remote && keepRemote(entry))) {
      lockKeys.set(sanitizeName(key), key);
    } else {
      explicit.add(sanitizeName(key));
    }
  }

  const candidates = new Set(lockKeys.keys());
  for (const name of await readdir(canonicalBase).catch(() => [])) {
    if (await linksIntoNodeModules(join(canonicalBase, name))) candidates.add(name);
  }
  const stale = [...candidates].filter((name) => !keep.has(name) && !explicit.has(name)).sort();
  if (dryRun || stale.length === 0) return stale;

  const allAgents = Object.keys(agents) as AgentType[];
  for (const name of stale) {
    const canonicalDir = join(canonicalBase, name);
    const key = lockKeys.get(name);
    const lockEntry = key ? lock.skills[key] : undefined;
    const destinations = new Set([
      canonicalDir,
      ...allAgents.map((agent) => getInstallPath(name, agent, { cwd })),
    ]);
    for (const dest of destinations) {
      if (!(await foreignDestination(dest, canonicalDir, lockEntry, cwd))) {
        await rm(dest, { recursive: true, force: true });
      }
    }
    if (key) delete lock.skills[key];
  }
  await writeLocalLock(lock, cwd);
  return stale;
}

/**
 * Why sync must not install `name`, or null: a skill installed with
 * `skills add` is never shadowed, and a destination sync does not own is
 * never replaced.
 */
async function blockedReason(
  name: string,
  targetAgents: AgentType[],
  lockEntry: LocalSkillLockEntry | undefined,
  cwd: string
): Promise<string | null> {
  if (lockEntry && !installedBySync(lockEntry)) {
    return `installed with \`skills add\` from ${lockEntry.source}`;
  }
  const canonicalDir = getCanonicalPath(name, { cwd });
  const destinations = new Set([
    canonicalDir,
    ...targetAgents.map((agent) => getInstallPath(name, agent, { cwd })),
  ]);
  for (const dest of destinations) {
    const reason = await foreignDestination(dest, canonicalDir, lockEntry, cwd);
    if (reason) return reason;
  }
  return null;
}

interface SkippedSkill {
  skill: PackageSkill;
  reason: string;
}

/**
 * Conflict rules for shipped skills, in order:
 * 1. a skill from a direct dependency wins over one from a transitive package
 * 2. two packages at the same depth shipping the same skill name install neither
 * 3. blockedReason: never shadow `skills add`, never replace what sync does not own
 *
 * A shipped skill replaces one that a remote `skills` entry installed.
 */
async function resolveConflicts(
  skills: PackageSkill[],
  targetAgents: AgentType[],
  lockSkills: Record<string, LocalSkillLockEntry>,
  cwd: string
): Promise<{ install: PackageSkill[]; skipped: SkippedSkill[] }> {
  const lockBySanitizedName = new Map(
    Object.entries(lockSkills).map(([name, entry]) => [sanitizeName(name), entry])
  );
  const byName = Map.groupBy(skills, (skill) => sanitizeName(skill.name));
  const install: PackageSkill[] = [];
  const skipped: SkippedSkill[] = [];

  for (const [name, all] of byName) {
    // A direct dependency (or the project's own field) wins over a transitive package
    const depth = Math.min(...all.map((c) => c.depth));
    const candidates = all.filter((c) => c.depth === depth);
    for (const skill of all.filter((c) => c.depth !== depth)) {
      skipped.push({ skill, reason: `${candidates[0]!.packageName} is closer to the project` });
    }
    if (candidates.length > 1) {
      const packages = candidates.map((c) => c.packageName).join(', ');
      for (const skill of candidates) {
        skipped.push({
          skill,
          reason: `shipped by ${packages}; drop this one with --exclude ${skill.packageName}#${name}`,
        });
      }
      continue;
    }

    const skill = candidates[0]!;
    const reason = await blockedReason(name, targetAgents, lockBySanitizedName.get(name), cwd);
    if (reason) {
      skipped.push({ skill, reason });
    } else {
      install.push(skill);
    }
  }

  return { install, skipped };
}

/**
 * Ask which agents to sync to, with universal agents always included.
 * Preselects the last choice from `skills add` or sync when it is still offered.
 */
async function promptForAgentChoice(
  choices: AgentType[],
  fallback: AgentType[]
): Promise<AgentType[] | symbol> {
  const universalAgents = getUniversalAgents();
  const visibleUniversalAgents = getVisibleUniversalAgents();
  const last = await getLastSelectedAgents().catch(() => undefined);
  const remembered = choices.filter((a) => last?.includes(a));

  const selected = await searchMultiselect({
    message: 'Which agents do you want to install to?',
    items: choices.map((a) => ({
      value: a,
      label: agents[a].displayName,
      hint: agents[a].skillsDir,
    })),
    initialSelected: remembered.length > 0 ? remembered : fallback,
    lockedSection: {
      title: 'Universal (.agents/skills)',
      items: visibleUniversalAgents.map((a) => ({ value: a, label: agents[a].displayName })),
      hiddenCount: universalAgents.length - visibleUniversalAgents.length,
    },
  });
  if (!isCancelled(selected)) {
    await saveSelectedAgents(selected as string[]).catch(() => {});
  }
  return selected as AgentType[] | symbol;
}

/** `entry` was installed by sync for the remote `skills` entry `request`. */
function isFromRequest(entry: LocalSkillLockEntry, request: FieldRemoteRequest): boolean {
  return (
    entry.via !== undefined &&
    entry.source === getProjectLockSource(request.parsed) &&
    entry.ref === request.parsed.ref
  );
}

/** Every skill `request` asks for is in the lock and on disk; `skills update` refreshes them. */
function isRemoteInstalled(
  request: FieldRemoteRequest,
  lock: LocalSkillLockFile,
  cwd: string
): boolean {
  const installed = Object.entries(lock.skills)
    .filter(
      ([name, entry]) =>
        isFromRequest(entry, request) && existsSync(getCanonicalPath(name, { cwd }))
    )
    .map(([name]) => sanitizeName(name));
  return request.skills.length === 0
    ? installed.length > 0
    : request.skills.every((name) => installed.includes(sanitizeName(name)));
}

export async function runSync(args: string[], options: SyncOptions = {}): Promise<void> {
  const cwd = process.cwd();

  // Auto-enable non-interactive mode when running inside an AI agent
  const agentResult = await detectAgent();
  if (agentResult.isAgent) {
    options.yes = true;
    if (!options.agent || options.agent.length === 0) {
      const mappedAgent = getAgentType(agentResult.agent.name);
      if (mappedAgent) {
        const agentList: AgentType[] = [mappedAgent];
        for (const ua of getUniversalAgents()) {
          if (!agentList.includes(ua)) agentList.push(ua);
        }
        options.agent = agentList;
      }
    }
  }

  console.log();
  if (!agentResult.isAgent) {
    p.intro(pc.bgCyan(pc.black(' skills experimental_sync ')));
  }

  if (agentResult.isAgent) {
    p.log.info(
      pc.bgCyan(pc.black(pc.bold(` ${agentResult.agent.name} `))) +
        ' ' +
        'Agent detected — installing non-interactively'
    );
  }

  const spinner = p.spinner();

  // 1. Discover skills from node_modules
  spinner.start('Scanning node_modules for skills…');
  const discovery = await discoverNodeModuleSkills(cwd);
  if (discovery.errors.length > 0) {
    spinner.stop(pc.red('Invalid skills field'));
    for (const error of discovery.errors) p.log.error(error);
    p.outro(pc.red('Fix the "skills" field in package.json and run sync again.'));
    process.exitCode = 1;
    return;
  }
  const { include, exclude } = options;
  const discoveredSkills = discovery.skills.filter(
    (skill) =>
      (!include?.length || matchesSkill(skill, include)) &&
      !(exclude?.length && matchesSkill(skill, exclude))
  );
  spinner.stop(
    discoveredSkills.length === 0
      ? pc.yellow('No skills found')
      : `Found ${pc.green(String(discoveredSkills.length))} skill${discoveredSkills.length > 1 ? 's' : ''} in node_modules`
  );
  for (const warning of discovery.warnings) p.log.warn(warning);

  const localLock = await readLocalLock(cwd);
  if (options.cleanup !== false) {
    const keep = new Set(discoveredSkills.map((skill) => sanitizeName(skill.name)));
    // --no-remote leaves remote skills alone, both installing and removing
    const keepRemote = (entry: LocalSkillLockEntry) =>
      options.remote === false || discovery.remote.some((r) => isFromRequest(entry, r));
    const stale = await pruneStaleSkills(cwd, keep, keepRemote, localLock, options.dryRun ?? false);
    for (const name of stale) {
      p.log.info(
        `${options.dryRun ? 'Would remove' : 'Removed'} ${pc.cyan(name)} ${pc.dim('(no longer provided by a dependency)')}`
      );
    }
  }

  const remoteRequests = (options.remote === false ? [] : discovery.remote).filter(
    (request) => !isRemoteInstalled(request, localLock, cwd)
  );

  if (discoveredSkills.length === 0 && remoteRequests.length === 0) {
    p.outro(pc.dim('Nothing to sync.'));
    return;
  }

  // Show discovered skills
  for (const skill of discoveredSkills) {
    p.log.info(`${pc.cyan(skill.name)} ${pc.dim(`from ${skill.packageName}`)}`);
    if (skill.description) {
      p.log.message(pc.dim(`  ${skill.description}`));
    }
  }

  // 2. Select agents
  let targetAgents: AgentType[];
  const validAgents = Object.keys(agents);
  const universalAgents = getUniversalAgents();

  if (options.agent?.includes('*')) {
    targetAgents = validAgents as AgentType[];
    p.log.info(`Installing to all ${targetAgents.length} agents`);
  } else if (options.agent && options.agent.length > 0) {
    const invalidAgents = options.agent.filter((a) => !validAgents.includes(a));
    if (invalidAgents.length > 0) {
      p.log.error(`Invalid agents: ${invalidAgents.join(', ')}`);
      p.log.info(`Valid agents: ${validAgents.join(', ')}`);
      process.exit(1);
    }
    targetAgents = options.agent as AgentType[];
  } else {
    spinner.start('Loading agents…');
    const installedAgents = await detectInstalledAgents();
    const totalAgents = Object.keys(agents).length;
    spinner.stop(`${totalAgents} agents`);

    if (installedAgents.length === 0 && options.yes) {
      targetAgents = universalAgents;
      p.log.info('Installing to universal agents');
    } else if (installedAgents.length === 1 || options.yes) {
      // Ensure universal agents are included
      targetAgents = [...installedAgents];
      for (const ua of universalAgents) {
        if (!targetAgents.includes(ua)) {
          targetAgents.push(ua);
        }
      }
    } else {
      // No detected agents: offer all; several: offer the detected ones
      const choices = getNonUniversalAgents().filter(
        (a) => installedAgents.length === 0 || installedAgents.includes(a)
      );
      const selected = await promptForAgentChoice(
        choices,
        installedAgents.filter((a) => !universalAgents.includes(a))
      );
      if (isCancelled(selected)) {
        p.cancel('Sync cancelled');
        process.exit(0);
      }
      targetAgents = selected;
    }
  }

  // 3. Resolve conflicts
  const { install: toInstall, skipped } = await resolveConflicts(
    discoveredSkills,
    targetAgents,
    localLock.skills,
    cwd
  );
  for (const { skill, reason } of skipped) {
    p.log.warn(`Skipped ${pc.cyan(skill.name)} ${pc.dim(`from ${skill.packageName}`)}: ${reason}`);
  }
  if (toInstall.length === 0 && remoteRequests.length === 0) {
    console.log();
    p.outro(pc.yellow('Nothing to sync.'));
    return;
  }

  // 4. Build summary
  const mode: InstallMode = options.copy ? 'copy' : 'link';
  const summaryLines: string[] = [];
  for (const skill of toInstall) {
    const canonicalPath = getCanonicalPath(skill.name, { cwd });
    summaryLines.push(`${pc.cyan(skill.name)} ${pc.dim(`← ${skill.packageName}`)}`);
    summaryLines.push(
      `  ${pc.dim(`${shortenPath(canonicalPath, cwd)} ${mode === 'link' ? '→' : 'copied from'} ${shortenPath(skill.path, cwd)}`)}`
    );
  }

  for (const request of remoteRequests) {
    summaryLines.push(
      `${pc.cyan(getProjectLockSource(request.parsed))} ${pc.dim(`← ${request.via} (remote)`)}`
    );
  }

  console.log();
  p.note(summaryLines.join('\n'), 'Sync Summary');

  if (options.dryRun) {
    p.outro(pc.dim('Dry run — nothing changed.'));
    return;
  }

  if (!options.yes) {
    const confirmed = await p.confirm({ message: 'Proceed with sync?' });

    if (p.isCancel(confirmed) || !confirmed) {
      p.cancel('Sync cancelled');
      process.exit(0);
    }
  }

  // 5. Install skills (always project-scoped)
  spinner.start('Syncing skills…');

  const results: Array<{
    skill: string;
    packageName: string;
    agent: string;
    success: boolean;
    path: string;
    canonicalPath?: string;
    error?: string;
  }> = [];

  for (const skill of toInstall) {
    for (const agent of targetAgents) {
      const result = await installSkillForAgent(skill, agent, {
        global: false,
        cwd,
        // Eve rewrites SKILL.md frontmatter on install, which a link cannot do
        mode: agent === 'eve' ? 'copy' : mode,
      });
      results.push({
        skill: skill.name,
        packageName: skill.packageName,
        agent: agents[agent].displayName,
        success: result.success,
        path: result.path,
        canonicalPath: result.canonicalPath,
        error: result.error,
      });
    }
  }

  spinner.stop('Sync complete');

  // 6. Update local lock file
  const successful = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);
  const successfulSkillNames = new Set(successful.map((r) => r.skill));

  for (const skill of toInstall) {
    if (successfulSkillNames.has(skill.name)) {
      try {
        const computedHash = await computeSkillFolderHash(skill.path);
        await addSkillToLocalLock(
          skill.name,
          {
            source: skill.packageName,
            sourceType: 'node_modules',
            skillPath: skill.skillPath,
            ...(skill.packageVersion && { version: skill.packageVersion }),
            ...(skill.via && { via: skill.via }),
            computedHash,
          },
          cwd
        );
      } catch {
        // Don't fail sync if lock file update fails
      }
    }
  }

  // 7. Install skills that remote `skills` entries request
  const claimed = new Set(discoveredSkills.map((skill) => sanitizeName(skill.name)));
  const lockEntryFor = (name: string) =>
    Object.entries(localLock.skills).find(([key]) => sanitizeName(key) === name)?.[1];
  for (const request of remoteRequests) {
    const label = getProjectLockSource(request.parsed);
    const result = await installFromSource(request.parsed, {
      skills: request.skills,
      agents: targetAgents,
      via: request.via,
      select: async (skills) => {
        const selected: Skill[] = [];
        for (const skill of skills) {
          const name = sanitizeName(skill.name);
          const reason = claimed.has(name)
            ? 'another source in this sync provides it'
            : await blockedReason(name, targetAgents, lockEntryFor(name), cwd);
          if (reason) {
            p.log.warn(`Skipped ${pc.cyan(name)} from ${label}: ${reason}`);
            continue;
          }
          claimed.add(name);
          selected.push(skill);
        }
        return selected;
      },
    });
    if (result.error) {
      p.log.error(`Failed to install from ${pc.cyan(label)}: ${result.error}`);
      process.exitCode = 1;
      continue;
    }
    if (result.installed.length > 0) {
      p.log.success(
        `Installed ${result.installed.map((name) => pc.cyan(name)).join(', ')} from ${label}`
      );
    }
    for (const failure of result.failed) p.log.error(failure);
    if (result.failed.length > 0) process.exitCode = 1;
  }

  // 8. Display results
  console.log();

  if (successful.length > 0) {
    const bySkill = new Map<string, typeof results>();
    for (const r of successful) {
      const skillResults = bySkill.get(r.skill) || [];
      skillResults.push(r);
      bySkill.set(r.skill, skillResults);
    }

    const resultLines: string[] = [];
    for (const [skillName, skillResults] of bySkill) {
      const firstResult = skillResults[0]!;
      const pkg = toInstall.find((s) => s.name === skillName)?.packageName;
      if (firstResult.canonicalPath) {
        const shortPath = shortenPath(firstResult.canonicalPath, cwd);
        resultLines.push(`${pc.green('✓')} ${skillName} ${pc.dim(`← ${pkg}`)}`);
        resultLines.push(`  ${pc.dim(shortPath)}`);
      } else {
        resultLines.push(`${pc.green('✓')} ${skillName} ${pc.dim(`← ${pkg}`)}`);
      }
    }

    const skillCount = bySkill.size;
    const title = pc.green(`Synced ${skillCount} skill${skillCount !== 1 ? 's' : ''}`);
    p.note(resultLines.join('\n'), title);
  }

  if (failed.length > 0) {
    console.log();
    p.log.error(pc.red(`Failed to install ${failed.length}`));
    for (const r of failed) {
      p.log.message(`  ${pc.red('✗')} ${r.skill} → ${r.agent}: ${pc.dim(r.error)}`);
    }
  }

  // Track telemetry
  const packages = discoveredSkills.flatMap((skill) =>
    skill.packageVersion && !skill.packagePrivate
      ? [
          {
            skill: skill.name,
            package: skill.packageName,
            ecosystem: 'npm',
            registry: 'npm',
            version: skill.packageVersion,
          },
        ]
      : []
  );
  track({
    event: 'experimental_sync',
    skillCount: String(toInstall.length),
    successCount: String(successfulSkillNames.size),
    agents: targetAgents.join(','),
    ...(packages.length > 0 && { packages: JSON.stringify(packages) }),
  });

  console.log();
  p.outro(
    pc.green('Done!') + pc.dim('  Review skills before use; they run with full agent permissions.')
  );
}

export function parseSyncOptions(args: string[]): { options: SyncOptions } {
  const options: SyncOptions = {};
  let i = 0;
  /** Consume the values after a flag, up to the next flag. */
  const takeValues = (): string[] => {
    const values: string[] = [];
    while (args[i + 1] !== undefined && !args[i + 1]!.startsWith('-')) values.push(args[++i]!);
    return values;
  };

  for (; i < args.length; i++) {
    const arg = args[i];

    if (arg === '-y' || arg === '--yes') {
      options.yes = true;
    } else if (arg === '--copy') {
      options.copy = true;
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--no-cleanup') {
      options.cleanup = false;
    } else if (arg === '--no-remote') {
      options.remote = false;
    } else if (arg === '-a' || arg === '--agent') {
      options.agent = [...(options.agent ?? []), ...takeValues()];
    } else if (arg === '--include') {
      options.include = [...(options.include ?? []), ...takeValues()];
    } else if (arg === '--exclude') {
      options.exclude = [...(options.exclude ?? []), ...takeValues()];
    }
  }

  return { options };
}
