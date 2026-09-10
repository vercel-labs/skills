import * as p from '@clack/prompts';
import pc from 'picocolors';
import { readdir, lstat, rename, rm, stat, mkdir, cp, readFile, writeFile } from 'fs/promises';
import { join, dirname, resolve } from 'path';
import { parseSkillMd } from './skills.ts';
import { computeSkillFolderHash } from './local-lock.ts';
import { getCanonicalSkillsDir, sanitizeName, createSymlink } from './installer.ts';
import { agents, detectInstalledAgents } from './agents.ts';
import { track } from './telemetry.ts';
import type { AgentType } from './types.ts';

export interface ConsolidateOptions {
  global?: boolean;
  yes?: boolean;
  dryRun?: boolean;
  /** Sync all canonical skills to all installed agents after consolidation */
  syncAll?: boolean;
  /** @internal For testing — override the canonical directory */
  _canonicalDir?: string;
}

interface DiscoveredSkill {
  name: string;
  dirName: string;
  path: string;
  agent: AgentType;
  hash: string;
}

interface ConsolidateAction {
  type: 'move-and-link' | 'link-only' | 'fork';
  skill: DiscoveredSkill;
  canonicalPath: string;
  canonicalHash?: string;
}

const SKIP_DIRS = new Set(['vendor_imports', '.git', 'node_modules', '__pycache__']);

export function parseConsolidateOptions(args: string[]): ConsolidateOptions {
  const options: ConsolidateOptions = { global: true };
  for (const arg of args) {
    if (arg === '-g' || arg === '--global') options.global = true;
    else if (arg === '-y' || arg === '--yes') options.yes = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--sync-all') options.syncAll = true;
  }
  return options;
}

/**
 * Scan agent global skill directories for real (non-symlink) skill folders.
 */
async function scanAgentSkills(canonicalDir: string): Promise<DiscoveredSkill[]> {
  const discovered: DiscoveredSkill[] = [];
  const installedAgents = await detectInstalledAgents();

  // Collect unique globalSkillsDir paths to scan (skip universal agents whose dir IS canonical)
  const dirsToScan = new Map<string, AgentType>();
  for (const agentType of installedAgents) {
    const agent = agents[agentType];
    const globalDir = agent.globalSkillsDir;
    if (!globalDir) continue;
    // Skip if this agent's global dir is the canonical dir
    if (resolve(globalDir) === resolve(canonicalDir)) continue;
    if (!dirsToScan.has(globalDir)) {
      dirsToScan.set(globalDir, agentType);
    }
  }

  for (const [agentDir, agentType] of dirsToScan) {
    let entries;
    try {
      entries = await readdir(agentDir, { withFileTypes: true });
    } catch {
      continue; // Directory doesn't exist
    }

    for (const entry of entries) {
      if (SKIP_DIRS.has(entry.name)) continue;

      const skillPath = join(agentDir, entry.name);

      // Skip symlinks — already consolidated
      try {
        const stats = await lstat(skillPath);
        if (stats.isSymbolicLink()) continue;
        if (!stats.isDirectory()) continue;
      } catch {
        continue;
      }

      // Must have SKILL.md
      try {
        await stat(join(skillPath, 'SKILL.md'));
      } catch {
        continue;
      }

      const skill = await parseSkillMd(join(skillPath, 'SKILL.md'));
      if (!skill) continue;

      let hash: string;
      try {
        hash = await computeSkillFolderHash(skillPath);
      } catch {
        continue;
      }

      discovered.push({
        name: skill.name,
        dirName: entry.name,
        path: skillPath,
        agent: agentType,
        hash,
      });
    }
  }

  return discovered;
}

/**
 * Plan consolidation actions by comparing discovered skills with canonical.
 */
async function planActions(
  discovered: DiscoveredSkill[],
  canonicalDir: string
): Promise<ConsolidateAction[]> {
  const actions: ConsolidateAction[] = [];

  // Group by sanitized name to handle duplicates across agents
  const byName = new Map<string, DiscoveredSkill[]>();
  for (const skill of discovered) {
    const key = sanitizeName(skill.name);
    const group = byName.get(key) || [];
    group.push(skill);
    byName.set(key, group);
  }

  for (const [sanitized, skills] of byName) {
    const canonicalPath = join(canonicalDir, sanitized);

    // Check if canonical already has this skill
    let canonicalExists = false;
    let canonicalHash: string | undefined;
    try {
      await stat(join(canonicalPath, 'SKILL.md'));
      canonicalExists = true;
      canonicalHash = await computeSkillFolderHash(canonicalPath);
    } catch {
      // Doesn't exist in canonical
    }

    for (const skill of skills) {
      if (canonicalExists) {
        if (skill.hash === canonicalHash) {
          actions.push({ type: 'link-only', skill, canonicalPath });
        } else {
          // Conflict: different content — fork into <skill>-<agent>
          const agentName = agents[skill.agent]?.name || skill.agent;
          const forkedName = `${sanitized}-${agentName}`;
          const forkedPath = join(canonicalDir, forkedName);
          actions.push({ type: 'fork', skill, canonicalPath: forkedPath, canonicalHash });
        }
      } else {
        // First one becomes the canonical version
        actions.push({ type: 'move-and-link', skill, canonicalPath });
        canonicalExists = true;
        canonicalHash = skill.hash;
      }
    }
  }

  return actions;
}

/**
 * Move a directory, falling back to copy+delete for cross-device moves.
 */
async function moveDir(src: string, dest: string): Promise<void> {
  try {
    await rename(src, dest);
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'code' in err && err.code === 'EXDEV') {
      await mkdir(dest, { recursive: true });
      await cp(src, dest, { recursive: true });
      await rm(src, { recursive: true, force: true });
    } else {
      throw err;
    }
  }
}

/**
 * Execute consolidation actions.
 */
async function executeActions(actions: ConsolidateAction[]): Promise<{
  moved: number;
  linked: number;
  forked: number;
  forkRecords: ForkManifest;
}> {
  let moved = 0;
  let linked = 0;
  let forked = 0;
  const forkRecords: ForkManifest = {};

  for (const action of actions) {
    const { skill, canonicalPath } = action;

    try {
      if (action.type === 'move-and-link') {
        await mkdir(dirname(canonicalPath), { recursive: true });
        await moveDir(skill.path, canonicalPath);
        await createSymlink(canonicalPath, skill.path);
        moved++;
      } else if (action.type === 'link-only') {
        await rm(skill.path, { recursive: true, force: true });
        await createSymlink(canonicalPath, skill.path);
        linked++;
      } else if (action.type === 'fork') {
        // Move to agent-specific canonical path (e.g. my-skill-codex)
        await mkdir(dirname(canonicalPath), { recursive: true });
        await moveDir(skill.path, canonicalPath);
        await createSymlink(canonicalPath, skill.path);
        // Record in fork manifest
        const dirName = canonicalPath.split('/').pop()!;
        const agentName = agents[skill.agent]?.name || skill.agent;
        forkRecords[dirName] = agentName;
        forked++;
      }
    } catch (err) {
      p.log.error(
        `Failed to consolidate ${pc.cyan(skill.name)} from ${pc.dim(skill.path)}: ${err instanceof Error ? err.message : 'Unknown error'}`
      );
    }
  }

  return { moved, linked, forked, forkRecords };
}

/** Fork manifest: maps canonical dir name → agent name */
interface ForkManifest {
  [dirName: string]: string; // e.g. { "my-skill-codex": "codex" }
}

const FORK_MANIFEST_FILE = '.forks.json';

async function readForkManifest(canonicalDir: string): Promise<ForkManifest> {
  try {
    const content = await readFile(join(canonicalDir, FORK_MANIFEST_FILE), 'utf-8');
    return JSON.parse(content);
  } catch {
    return {};
  }
}

async function writeForkManifest(canonicalDir: string, manifest: ForkManifest): Promise<void> {
  const sorted = Object.fromEntries(
    Object.entries(manifest).sort(([a], [b]) => a.localeCompare(b))
  );
  await writeFile(join(canonicalDir, FORK_MANIFEST_FILE), JSON.stringify(sorted, null, 2) + '\n');
}

/**
 * Sync all skills from canonical to all installed non-universal agents.
 * Creates symlinks for skills that don't yet exist in each agent's directory.
 * Agent-specific forks (recorded in .forks.json) are only synced to that agent.
 */
async function syncAllToAgents(canonicalDir: string, dryRun?: boolean): Promise<number> {
  const installedAgents = await detectInstalledAgents();
  const forkManifest = await readForkManifest(canonicalDir);
  let created = 0;

  // Get all skill dirs in canonical
  let canonicalEntries;
  try {
    canonicalEntries = await readdir(canonicalDir, { withFileTypes: true });
  } catch {
    return 0;
  }

  const skillDirs: string[] = [];
  for (const entry of canonicalEntries) {
    const entryPath = join(canonicalDir, entry.name);
    // Include both real dirs and symlinks-to-dirs
    try {
      const s = await stat(entryPath);
      if (!s.isDirectory()) continue;
    } catch {
      continue;
    }
    // Must have SKILL.md
    try {
      await stat(join(entryPath, 'SKILL.md'));
      skillDirs.push(entry.name);
    } catch {
      continue;
    }
  }

  // For each non-universal agent, create missing symlinks
  for (const agentType of installedAgents) {
    const agent = agents[agentType];
    const globalDir = agent.globalSkillsDir;
    if (!globalDir) continue;
    // Skip agents whose dir IS canonical
    if (resolve(globalDir) === resolve(canonicalDir)) continue;

    // Ensure agent skills dir exists
    if (!dryRun) {
      await mkdir(globalDir, { recursive: true });
    }

    for (const skillName of skillDirs) {
      // Check fork manifest: if this is a forked skill, only sync to its agent
      const forkAgent = forkManifest[skillName];
      if (forkAgent && forkAgent !== agent.name) continue;

      // Strip agent suffix for the link name (my-skill-codex → my-skill)
      const linkName = forkAgent ? skillName.slice(0, -(forkAgent.length + 1)) : skillName;
      const agentSkillPath = join(globalDir, linkName);

      // Skip if already exists (real dir or symlink)
      try {
        await lstat(agentSkillPath);
        continue; // Already exists
      } catch {
        // Doesn't exist — create symlink
      }

      if (!dryRun) {
        const canonicalSkillPath = join(canonicalDir, skillName);
        const success = await createSymlink(canonicalSkillPath, agentSkillPath);
        if (success) created++;
      } else {
        created++;
      }
    }
  }

  return created;
}

export async function runConsolidate(
  _args: string[],
  options: ConsolidateOptions = {}
): Promise<void> {
  const isGlobal = options.global ?? true;
  const canonicalDir = options._canonicalDir ?? getCanonicalSkillsDir(isGlobal);

  console.log();
  p.intro(pc.bgCyan(pc.black(' skills consolidate ')));

  // Step 1: Scan
  const spinner = p.spinner();
  spinner.start('Scanning agent skill directories...');
  const discovered = await scanAgentSkills(canonicalDir);

  if (discovered.length === 0) {
    spinner.stop(pc.green('All skills are already consolidated'));

    // Still run sync-all even if nothing to consolidate
    if (options.syncAll && !options.dryRun) {
      spinner.start('Syncing all skills to installed agents...');
      const synced = await syncAllToAgents(canonicalDir);
      spinner.stop(
        synced > 0
          ? `Synced ${pc.cyan(String(synced))} symlink(s) to agents`
          : pc.dim('All agents already up to date')
      );
    }

    p.outro(pc.dim('Nothing to consolidate.'));
    return;
  }

  spinner.stop(
    `Found ${pc.cyan(String(discovered.length))} skill${discovered.length !== 1 ? 's' : ''} to consolidate`
  );

  // Step 2: Plan
  const actions = await planActions(discovered, canonicalDir);

  const moveActions = actions.filter((a) => a.type === 'move-and-link');
  const linkActions = actions.filter((a) => a.type === 'link-only');
  const forkActions = actions.filter((a) => a.type === 'fork');

  // Step 3: Display plan
  const summaryLines: string[] = [];

  if (moveActions.length > 0) {
    summaryLines.push(pc.green(`${moveActions.length} skill(s) to move to canonical:`));
    for (const a of moveActions) {
      summaryLines.push(`  ${pc.cyan(a.skill.name)} ${pc.dim(`← ${a.skill.agent}`)}`);
    }
  }

  if (linkActions.length > 0) {
    summaryLines.push(pc.blue(`${linkActions.length} duplicate(s) to replace with symlinks:`));
    for (const a of linkActions) {
      summaryLines.push(`  ${pc.cyan(a.skill.name)} ${pc.dim(`← ${a.skill.agent}`)}`);
    }
  }

  if (forkActions.length > 0) {
    summaryLines.push(pc.yellow(`${forkActions.length} conflict(s) to fork as agent-specific:`));
    for (const a of forkActions) {
      const basename = a.canonicalPath.split('/').pop();
      summaryLines.push(
        `  ${pc.cyan(a.skill.name)} → ${pc.yellow(basename!)} ${pc.dim(`← ${a.skill.agent}`)}`
      );
    }
  }

  p.note(summaryLines.join('\n'), 'Consolidation Plan');

  if (options.dryRun) {
    p.outro(pc.dim('Dry run — no changes made.'));
    return;
  }

  // Step 4: Confirm
  if (!options.yes) {
    const confirmed = await p.confirm({ message: 'Proceed with consolidation?' });
    if (p.isCancel(confirmed) || !confirmed) {
      p.cancel('Consolidation cancelled');
      return;
    }
  }

  // Step 5: Execute
  spinner.start('Consolidating skills...');
  const { moved, linked, forked, forkRecords } = await executeActions(actions);
  spinner.stop('Done');

  // Write fork manifest if any forks were created
  if (Object.keys(forkRecords).length > 0) {
    const existing = await readForkManifest(canonicalDir);
    await writeForkManifest(canonicalDir, { ...existing, ...forkRecords });
  }

  // Step 6: Summary
  const resultLines: string[] = [];
  if (moved > 0) resultLines.push(`${pc.green('✓')} ${moved} skill(s) moved to canonical`);
  if (linked > 0)
    resultLines.push(`${pc.green('✓')} ${linked} duplicate(s) replaced with symlinks`);
  if (forked > 0)
    resultLines.push(`${pc.yellow('✓')} ${forked} conflict(s) forked as agent-specific`);

  if (resultLines.length > 0) {
    p.note(resultLines.join('\n'), pc.green('Results'));
  }

  // Step 7: Sync all canonical skills to all agents (optional)
  let synced = 0;
  if (options.syncAll) {
    spinner.start('Syncing all skills to installed agents...');
    synced = await syncAllToAgents(canonicalDir, options.dryRun);
    spinner.stop(
      synced > 0
        ? `Synced ${pc.cyan(String(synced))} symlink(s) to agents`
        : pc.dim('All agents already up to date')
    );
  }

  track({
    event: 'consolidate',
    skillsMoved: String(moved),
    skillsLinked: String(linked),
    skillsForked: String(forked),
  });

  console.log();
  p.outro(pc.green('Consolidation complete!'));
}
