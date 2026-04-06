import { lstat, readlink } from 'fs/promises';
import { homedir } from 'os';
import { dirname, join, resolve } from 'path';
import pc from 'picocolors';

import { agents, detectInstalledAgents } from './agents.ts';
import {
  getAgentBaseDir,
  getCanonicalSkillsDir,
  listInstalledSkills,
  type InstalledSkill,
} from './installer.ts';
import { computeSkillFolderHash, readLocalLock } from './local-lock.ts';
import { readSkillLock } from './skill-lock.ts';
import { parseSkillMd } from './skills.ts';
import { track } from './telemetry.ts';
import type { AgentType } from './types.ts';

export interface VerifyOptions {
  global?: boolean;
  agent?: string[];
  verbose?: boolean;
  json?: boolean;
}

export type VerifyStatus = 'ok' | 'modified' | 'missing' | 'untracked' | 'invalid';

export interface BrokenSymlink {
  agent: AgentType;
  link: string;
}

export interface VerifyResult {
  name: string;
  path: string;
  status: VerifyStatus;
  expectedHash?: string;
  actualHash?: string;
  agents: AgentType[];
  brokenSymlinks: BrokenSymlink[];
  error?: string;
}

export interface VerifySummary {
  scope: 'project' | 'global';
  results: VerifyResult[];
  counts: {
    ok: number;
    modified: number;
    missing: number;
    untracked: number;
    invalid: number;
    brokenSymlinks: number;
  };
}

export function parseVerifyOptions(args: string[]): VerifyOptions {
  const options: VerifyOptions = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '-g' || arg === '--global') {
      options.global = true;
    } else if (arg === '-v' || arg === '--verbose') {
      options.verbose = true;
    } else if (arg === '--json') {
      options.json = true;
    } else if (arg === '-a' || arg === '--agent') {
      options.agent = options.agent || [];
      // Collect all following arguments until next flag
      while (i + 1 < args.length && !args[i + 1]!.startsWith('-')) {
        options.agent.push(args[++i]!);
      }
    }
  }

  return options;
}

async function checkSymlinkIntegrity(
  skillName: string,
  canonicalPath: string,
  agentsToCheck: AgentType[],
  options: { global?: boolean; cwd?: string }
): Promise<BrokenSymlink[]> {
  const brokenSymlinks: BrokenSymlink[] = [];
  const cwd = options.cwd || process.cwd();

  for (const agentType of agentsToCheck) {
    const agentDir = getAgentBaseDir(agentType, options.global ?? false, cwd);
    const skillLink = join(agentDir, skillName);

    // Skip if this is the canonical directory (no symlink needed)
    if (agentDir === getCanonicalSkillsDir(options.global ?? false, cwd)) {
      continue;
    }

    try {
      const stats = await lstat(skillLink);

      if (stats.isSymbolicLink()) {
        const target = await readlink(skillLink);
        const resolvedTarget = resolve(dirname(skillLink), target);
        if (resolvedTarget !== canonicalPath) {
          brokenSymlinks.push({ agent: agentType, link: skillLink });
        }
      }
      // If it's a directory (copy mode), it's fine
    } catch {
      // Link doesn't exist - not necessarily broken, might just not be linked to this agent
    }
  }

  return brokenSymlinks;
}

export async function verifySkills(options: {
  global?: boolean;
  cwd?: string;
  agentFilter?: AgentType[];
}): Promise<VerifySummary> {
  const cwd = options.cwd || process.cwd();
  const isGlobal = options.global ?? false;
  const scope = isGlobal ? 'global' : 'project';
  const agentFilter = options.agentFilter;

  const results: VerifyResult[] = [];
  const counts = {
    ok: 0,
    modified: 0,
    missing: 0,
    untracked: 0,
    invalid: 0,
    brokenSymlinks: 0,
  };

  // Read lock file
  const lockFile = isGlobal ? await readSkillLock() : await readLocalLock(cwd);
  const lockedSkills = lockFile.skills;

  // List installed skills
  const installedSkills = await listInstalledSkills({
    global: isGlobal,
    cwd,
    agentFilter: agentFilter,
  });

  // Build a map of installed skills by name
  const installedMap = new Map<string, InstalledSkill>();
  for (const skill of installedSkills) {
    installedMap.set(skill.name, skill);
  }

  // Detect installed agents for symlink checking
  const detectedAgents = await detectInstalledAgents();
  const agentsToCheck = agentFilter
    ? detectedAgents.filter((a) => agentFilter.includes(a))
    : detectedAgents;

  // Check skills that are in the lock file
  for (const [skillName, lockEntry] of Object.entries(lockedSkills)) {
    const installed = installedMap.get(skillName);

    if (!installed) {
      // Skill in lock file but not on disk
      results.push({
        name: skillName,
        path: '',
        status: 'missing',
        agents: [],
        brokenSymlinks: [],
        error: 'Skill in lock file but not found on disk',
      });
      counts.missing++;
      continue;
    }

    // Remove from map so we can track untracked skills later
    installedMap.delete(skillName);

    // Check if SKILL.md is valid
    const skillMd = await parseSkillMd(join(installed.canonicalPath, 'SKILL.md'));
    if (!skillMd) {
      results.push({
        name: skillName,
        path: installed.canonicalPath,
        status: 'invalid',
        agents: installed.agents,
        brokenSymlinks: [],
        error: 'SKILL.md is missing or invalid',
      });
      counts.invalid++;
      continue;
    }

    // Check hash (only for project skills, global uses GitHub tree SHA which can't be recomputed locally)
    let status: VerifyStatus = 'ok';
    let expectedHash: string | undefined;
    let actualHash: string | undefined;

    if (!isGlobal) {
      const localLockEntry = lockEntry as { computedHash: string };
      expectedHash = localLockEntry.computedHash;

      try {
        actualHash = await computeSkillFolderHash(installed.canonicalPath);
        if (expectedHash && actualHash !== expectedHash) {
          status = 'modified';
          counts.modified++;
        } else {
          counts.ok++;
        }
      } catch (error) {
        status = 'invalid';
        counts.invalid++;
      }
    } else {
      // For global skills, we only check existence (hash is GitHub tree SHA)
      counts.ok++;
    }

    // Check symlink integrity
    const brokenSymlinks = await checkSymlinkIntegrity(
      skillName,
      installed.canonicalPath,
      agentsToCheck,
      { global: isGlobal, cwd }
    );
    counts.brokenSymlinks += brokenSymlinks.length;

    results.push({
      name: skillName,
      path: installed.canonicalPath,
      status,
      expectedHash,
      actualHash,
      agents: installed.agents,
      brokenSymlinks,
    });
  }

  // Check for untracked skills (on disk but not in lock file)
  for (const [skillName, installed] of installedMap) {
    const brokenSymlinks = await checkSymlinkIntegrity(
      skillName,
      installed.canonicalPath,
      agentsToCheck,
      { global: isGlobal, cwd }
    );
    counts.brokenSymlinks += brokenSymlinks.length;

    results.push({
      name: skillName,
      path: installed.canonicalPath,
      status: 'untracked',
      agents: installed.agents,
      brokenSymlinks,
      error: 'Skill on disk but not in lock file',
    });
    counts.untracked++;
  }

  // Sort results by name for consistent output
  results.sort((a, b) => a.name.localeCompare(b.name));

  return { scope, results, counts };
}

// ─────────────────────────────────────────────────────────────────────────────
// Output Formatting
// ─────────────────────────────────────────────────────────────────────────────

function shortenPath(fullPath: string, cwd: string): string {
  const home = homedir();
  if (fullPath.startsWith(home)) {
    return fullPath.replace(home, '~');
  }
  if (fullPath.startsWith(cwd)) {
    return '.' + fullPath.slice(cwd.length);
  }
  return fullPath;
}

function formatStandardOutput(summary: VerifySummary, cwd: string): void {
  const scopeLabel = summary.scope === 'global' ? 'global' : 'project';
  console.log(`Verifying ${scopeLabel} skills...\n`);

  if (summary.results.length === 0) {
    console.log(pc.dim(`No ${scopeLabel} skills found.`));
    return;
  }

  const hasIssues =
    summary.counts.modified > 0 ||
    summary.counts.missing > 0 ||
    summary.counts.untracked > 0 ||
    summary.counts.invalid > 0 ||
    summary.counts.brokenSymlinks > 0;

  // Show issues
  for (const result of summary.results) {
    if (result.status === 'ok' && result.brokenSymlinks.length === 0) {
      continue;
    }

    switch (result.status) {
      case 'modified':
        console.log(`  ${pc.yellow(result.name)} ${pc.dim('(modified - hash mismatch)')}`);
        break;
      case 'missing':
        console.log(
          `  ${pc.red(result.name)} ${pc.dim('(missing - in lock file but not on disk)')}`
        );
        break;
      case 'untracked':
        console.log(`  ${pc.cyan(result.name)} ${pc.dim('(untracked - not in lock file)')}`);
        break;
      case 'invalid':
        console.log(`  ${pc.red(result.name)} ${pc.dim(`(invalid - ${result.error})`)}`);
        break;
    }

    for (const broken of result.brokenSymlinks) {
      const shortLink = shortenPath(broken.link, cwd);
      console.log(`    ${pc.red('broken symlink:')} ${shortLink}`);
    }
  }

  // Summary
  console.log();
  const parts: string[] = [];

  if (summary.counts.ok > 0) {
    parts.push(pc.green(`${summary.counts.ok} verified`));
  }
  if (summary.counts.modified > 0) {
    parts.push(pc.yellow(`${summary.counts.modified} modified`));
  }
  if (summary.counts.missing > 0) {
    parts.push(pc.red(`${summary.counts.missing} missing`));
  }
  if (summary.counts.untracked > 0) {
    parts.push(pc.cyan(`${summary.counts.untracked} untracked`));
  }
  if (summary.counts.invalid > 0) {
    parts.push(pc.red(`${summary.counts.invalid} invalid`));
  }
  if (summary.counts.brokenSymlinks > 0) {
    parts.push(pc.red(`${summary.counts.brokenSymlinks} broken symlinks`));
  }

  if (parts.length > 0) {
    console.log(`Summary: ${parts.join(', ')}`);
  }

  if (!hasIssues && summary.results.length > 0) {
    console.log(pc.green(`All ${summary.results.length} skills verified successfully.`));
  }
}

function formatVerboseOutput(summary: VerifySummary, cwd: string): void {
  const scopeLabel = summary.scope === 'global' ? 'global' : 'project';
  console.log(`Verifying ${scopeLabel} skills...\n`);

  if (summary.results.length === 0) {
    console.log(pc.dim(`No ${scopeLabel} skills found.`));
    return;
  }

  for (const result of summary.results) {
    const shortPath = result.path ? shortenPath(result.path, cwd) : 'N/A';
    const statusIcon =
      result.status === 'ok' && result.brokenSymlinks.length === 0
        ? pc.green('\u2713')
        : pc.red('\u2717');

    console.log(`${statusIcon} ${pc.bold(result.name)}`);
    console.log(`    Path: ${pc.dim(shortPath)}`);

    if (result.status !== 'ok') {
      console.log(`    Status: ${pc.yellow(result.status)}`);
    }

    if (result.expectedHash) {
      const hashMatch = result.expectedHash === result.actualHash;
      console.log(`    Hash: ${hashMatch ? pc.green('matches') : pc.yellow('mismatch')}`);
      if (!hashMatch && result.actualHash) {
        console.log(`      Expected: ${pc.dim(result.expectedHash.slice(0, 16))}...`);
        console.log(`      Actual:   ${pc.dim(result.actualHash.slice(0, 16))}...`);
      }
    }

    if (result.agents.length > 0) {
      const agentNames = result.agents.map((a) => agents[a].displayName).join(', ');
      console.log(`    Agents: ${agentNames}`);
    }

    for (const broken of result.brokenSymlinks) {
      const shortLink = shortenPath(broken.link, cwd);
      console.log(
        `    ${pc.red('Broken symlink:')} ${shortLink} (${agents[broken.agent].displayName})`
      );
    }

    if (result.error && result.status !== 'ok') {
      console.log(`    Error: ${pc.dim(result.error)}`);
    }

    console.log();
  }

  // Summary
  const parts: string[] = [];
  if (summary.counts.ok > 0) parts.push(`${summary.counts.ok} ok`);
  if (summary.counts.modified > 0) parts.push(`${summary.counts.modified} modified`);
  if (summary.counts.missing > 0) parts.push(`${summary.counts.missing} missing`);
  if (summary.counts.untracked > 0) parts.push(`${summary.counts.untracked} untracked`);
  if (summary.counts.invalid > 0) parts.push(`${summary.counts.invalid} invalid`);
  if (summary.counts.brokenSymlinks > 0)
    parts.push(`${summary.counts.brokenSymlinks} broken symlinks`);

  console.log(`Summary: ${parts.join(', ')}`);
}

function formatJsonOutput(summary: VerifySummary): void {
  console.log(JSON.stringify(summary, null, 2));
}

export async function runVerify(args: string[]): Promise<void> {
  const options = parseVerifyOptions(args);
  const cwd = process.cwd();

  // Validate agent filter if provided
  let agentFilter: AgentType[] | undefined;
  if (options.agent && options.agent.length > 0) {
    const validAgents = Object.keys(agents);
    const invalidAgents = options.agent.filter((a) => !validAgents.includes(a));

    if (invalidAgents.length > 0) {
      console.log(pc.yellow(`Invalid agents: ${invalidAgents.join(', ')}`));
      console.log(pc.dim(`Valid agents: ${validAgents.join(', ')}`));
      process.exit(1);
    }

    agentFilter = options.agent as AgentType[];
  }

  const summary = await verifySkills({
    global: options.global,
    cwd,
    agentFilter,
  });

  // Track telemetry
  track({
    event: 'verify',
    scope: summary.scope,
    skillCount: String(summary.results.length),
    okCount: String(summary.counts.ok),
    modifiedCount: String(summary.counts.modified),
    missingCount: String(summary.counts.missing),
    untrackedCount: String(summary.counts.untracked),
    invalidCount: String(summary.counts.invalid),
    brokenSymlinksCount: String(summary.counts.brokenSymlinks),
  });

  // Output results
  if (options.json) {
    formatJsonOutput(summary);
  } else if (options.verbose) {
    formatVerboseOutput(summary, cwd);
  } else {
    formatStandardOutput(summary, cwd);
  }

  // Exit with code 1 if any issues found
  const hasIssues =
    summary.counts.modified > 0 ||
    summary.counts.missing > 0 ||
    summary.counts.invalid > 0 ||
    summary.counts.brokenSymlinks > 0;

  if (hasIssues) {
    process.exit(1);
  }
}
