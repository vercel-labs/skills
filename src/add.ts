import * as p from '@clack/prompts';
import pc from 'picocolors';
import { existsSync } from 'fs';
import { homedir } from 'os';
import { sep } from 'path';
import { parseSource, getOwnerRepo, parseOwnerRepo, isRepoPrivate } from './source-parser.ts';
import { searchMultiselect, cancelSymbol } from './prompts/search-multiselect.ts';

// Helper to check if a value is a cancel symbol (works with both clack and our custom prompts)
const isCancelled = (value: unknown): value is symbol => typeof value === 'symbol';

/**
 * Check if a source identifier (owner/repo format) represents a private GitHub repo.
 * Returns true if private, false if public, null if unable to determine or not a GitHub repo.
 */
async function isSourcePrivate(source: string): Promise<boolean | null> {
  const ownerRepo = parseOwnerRepo(source);
  if (!ownerRepo) {
    // Not in owner/repo format, assume not private (could be other providers)
    return false;
  }
  return isRepoPrivate(ownerRepo.owner, ownerRepo.repo);
}
import { cloneRepo, cleanupTempDir, GitCloneError } from './git.ts';
import { discoverAgents, getAgentDisplayName, filterAgents } from './agents.ts';
import {
  installAgentForTarget,
  isAgentInstalled,
  getInstallPath,
  getCanonicalPath,
  installWellKnownAgentForTarget,
  type InstallMode,
} from './installer.ts';
import {
  detectInstalledTargets,
  targets,
  getUniversalTargets,
  getNonUniversalTargets,
  isUniversalTarget,
} from './targets.ts';
import {
  track,
  setVersion,
  fetchAuditData,
  type AuditResponse,
  type AgentAuditData,
  type PartnerAudit,
} from './telemetry.ts';
import { wellKnownProvider, type WellKnownAgent } from './providers/index.ts';
import {
  addAgentToLock,
  fetchAgentFolderHash,
  getGitHubToken,
  isPromptDismissed,
  dismissPrompt,
  getLastSelectedTargets,
  saveSelectedTargets,
} from './agent-lock.ts';
import { addAgentToLocalLock, computeAgentFolderHash } from './local-lock.ts';
import type { Agent, TargetType } from './types.ts';
import packageJson from '../package.json' with { type: 'json' };
export function initTelemetry(version: string): void {
  setVersion(version);
}

// ─── Security Advisory ───

function riskLabel(risk: string): string {
  switch (risk) {
    case 'critical':
      return pc.red(pc.bold('Critical Risk'));
    case 'high':
      return pc.red('High Risk');
    case 'medium':
      return pc.yellow('Med Risk');
    case 'low':
      return pc.green('Low Risk');
    case 'safe':
      return pc.green('Safe');
    default:
      return pc.dim('--');
  }
}

function socketLabel(audit: PartnerAudit | undefined): string {
  if (!audit) return pc.dim('--');
  const count = audit.alerts ?? 0;
  return count > 0 ? pc.red(`${count} alert${count !== 1 ? 's' : ''}`) : pc.green('0 alerts');
}

/** Pad a string to a given visible width (ignoring ANSI escape codes). */
function padEnd(str: string, width: number): string {
  // Strip ANSI codes to measure visible length
  const visible = str.replace(/\x1b\[[0-9;]*m/g, '');
  const pad = Math.max(0, width - visible.length);
  return str + ' '.repeat(pad);
}

/**
 * Render a compact security table showing partner audit results.
 * Returns the lines to display, or empty array if no data.
 */
function buildSecurityLines(
  auditData: AuditResponse | null,
  agents: Array<{ slug: string; displayName: string }>,
  source: string
): string[] {
  if (!auditData) return [];

  // Check if we have any audit data at all
  const hasAny = agents.some((s) => {
    const data = auditData[s.slug];
    return data && Object.keys(data).length > 0;
  });
  if (!hasAny) return [];

  // Compute column width for agent names
  const nameWidth = Math.min(Math.max(...agents.map((s) => s.displayName.length)), 36);

  // Header
  const lines: string[] = [];
  const header =
    padEnd('', nameWidth + 2) +
    padEnd(pc.dim('Gen'), 18) +
    padEnd(pc.dim('Socket'), 18) +
    pc.dim('Snyk');
  lines.push(header);

  // Rows
  for (const agent of agents) {
    const data = auditData[agent.slug];
    const name =
      agent.displayName.length > nameWidth
        ? agent.displayName.slice(0, nameWidth - 1) + '\u2026'
        : agent.displayName;

    const ath = data?.ath ? riskLabel(data.ath.risk) : pc.dim('--');
    const socket = data?.socket ? socketLabel(data.socket) : pc.dim('--');
    const snyk = data?.snyk ? riskLabel(data.snyk.risk) : pc.dim('--');

    lines.push(padEnd(pc.cyan(name), nameWidth + 2) + padEnd(ath, 18) + padEnd(socket, 18) + snyk);
  }

  // Footer link
  lines.push('');
  lines.push(`${pc.dim('Details:')} ${pc.dim(`https://agents.sh/${source}`)}`);

  return lines;
}

/**
 * Shortens a path for display: replaces homedir with ~ and cwd with .
 * Handles both Unix and Windows path separators.
 */
function shortenPath(fullPath: string, cwd: string): string {
  const home = homedir();
  // Ensure we match complete path segments by checking for separator after the prefix
  if (fullPath === home || fullPath.startsWith(home + sep)) {
    return '~' + fullPath.slice(home.length);
  }
  if (fullPath === cwd || fullPath.startsWith(cwd + sep)) {
    return '.' + fullPath.slice(cwd.length);
  }
  return fullPath;
}

/**
 * Formats a list of items, truncating if too many
 */
function formatList(items: string[], maxShow: number = 5): string {
  if (items.length <= maxShow) {
    return items.join(', ');
  }
  const shown = items.slice(0, maxShow);
  const remaining = items.length - maxShow;
  return `${shown.join(', ')} +${remaining} more`;
}

/**
 * Splits agents into universal and non-universal (symlinked) groups.
 * Returns display names for each group.
 */
function splitAgentsByType(targetTypes: TargetType[]): {
  universal: string[];
  symlinked: string[];
} {
  const universal: string[] = [];
  const symlinked: string[] = [];

  for (const a of targetTypes) {
    if (isUniversalTarget(a)) {
      universal.push(targets[a].displayName);
    } else {
      symlinked.push(targets[a].displayName);
    }
  }

  return { universal, symlinked };
}

/**
 * Builds summary lines showing universal vs symlinked agents
 */
function buildAgentSummaryLines(targetAgents: TargetType[], installMode: InstallMode): string[] {
  const lines: string[] = [];
  const { universal, symlinked } = splitAgentsByType(targetAgents);

  if (installMode === 'symlink') {
    if (universal.length > 0) {
      lines.push(`  ${pc.green('universal:')} ${formatList(universal)}`);
    }
    if (symlinked.length > 0) {
      lines.push(`  ${pc.dim('symlink →')} ${formatList(symlinked)}`);
    }
  } else {
    // Copy mode - all agents get copies
    const allNames = targetAgents.map((a) => targets[a].displayName);
    lines.push(`  ${pc.dim('copy →')} ${formatList(allNames)}`);
  }

  return lines;
}

/**
 * Ensures universal agents are always included in the target agents list.
 * Used when -y flag is passed or when auto-selecting agents.
 */
function ensureUniversalAgents(targetAgents: TargetType[]): TargetType[] {
  const universalAgents = getUniversalTargets();
  const result = [...targetAgents];

  for (const ua of universalAgents) {
    if (!result.includes(ua)) {
      result.push(ua);
    }
  }

  return result;
}

/**
 * Builds result lines from installation results, splitting by universal vs symlinked
 */
function buildResultLines(
  results: Array<{
    agent: string;
    symlinkFailed?: boolean;
  }>,
  targetAgents: TargetType[]
): string[] {
  const lines: string[] = [];

  // Split target agents by type
  const { universal, symlinked: symlinkAgents } = splitAgentsByType(targetAgents);

  // For symlink results, also track which ones actually succeeded vs failed
  const successfulSymlinks = results
    .filter((r) => !r.symlinkFailed && !universal.includes(r.agent))
    .map((r) => r.agent);
  const failedSymlinks = results.filter((r) => r.symlinkFailed).map((r) => r.agent);

  if (universal.length > 0) {
    lines.push(`  ${pc.green('universal:')} ${formatList(universal)}`);
  }
  if (successfulSymlinks.length > 0) {
    lines.push(`  ${pc.dim('symlinked:')} ${formatList(successfulSymlinks)}`);
  }
  if (failedSymlinks.length > 0) {
    lines.push(`  ${pc.yellow('copied:')} ${formatList(failedSymlinks)}`);
  }

  return lines;
}

/**
 * Wrapper around p.multiselect that adds a hint for keyboard usage.
 * Accepts options with required labels (matching our usage pattern).
 */
function multiselect<Value>(opts: {
  message: string;
  options: Array<{ value: Value; label: string; hint?: string }>;
  initialValues?: Value[];
  required?: boolean;
}) {
  return p.multiselect({
    ...opts,
    // Cast is safe: our options always have labels, which satisfies p.Option requirements
    options: opts.options as p.Option<Value>[],
    message: `${opts.message} ${pc.dim('(space to toggle)')}`,
  }) as Promise<Value[] | symbol>;
}

/**
 * Prompts the user to select agents using interactive search.
 * Pre-selects the last used agents if available.
 * Saves the selection for future use.
 */
export async function promptForAgents(
  message: string,
  choices: Array<{ value: TargetType; label: string; hint?: string }>
): Promise<TargetType[] | symbol> {
  // Get last selected agents to pre-select
  let lastSelected: string[] | undefined;
  try {
    lastSelected = await getLastSelectedTargets();
  } catch {
    // Silently ignore errors reading lock file
  }

  const validAgents = choices.map((c) => c.value);

  // Default agents to pre-select when no valid history exists
  const defaultAgents: TargetType[] = ['claude-code', 'opencode', 'codex'];
  const defaultValues = defaultAgents.filter((a) => validAgents.includes(a));

  let initialValues: TargetType[] = [];

  if (lastSelected && lastSelected.length > 0) {
    // Filter stored agents against currently valid agents
    initialValues = lastSelected.filter((a) =>
      validAgents.includes(a as TargetType)
    ) as TargetType[];
  }

  // If no valid selection from history, use defaults
  if (initialValues.length === 0) {
    initialValues = defaultValues;
  }

  const selected = await searchMultiselect({
    message,
    items: choices,
    initialSelected: initialValues,
    required: true,
  });

  if (!isCancelled(selected)) {
    // Save selection for next time
    try {
      await saveSelectedTargets(selected as string[]);
    } catch {
      // Silently ignore errors writing lock file
    }
  }

  return selected as TargetType[] | symbol;
}

/**
 * Interactive agent selection using fuzzy search.
 * Shows universal agents as locked (always selected), and other agents as selectable.
 */
async function selectAgentsInteractive(options: {
  global?: boolean;
}): Promise<TargetType[] | symbol> {
  // Filter out agents that don't support global installation when --global is used
  const supportsGlobalFilter = (a: TargetType) => !options.global || targets[a].globalAgentsDir;

  const universalAgents = getUniversalTargets().filter(supportsGlobalFilter);
  const otherAgents = getNonUniversalTargets().filter(supportsGlobalFilter);

  // Universal agents shown as locked section
  const universalSection = {
    title: 'Universal (.agents/agents)',
    items: universalAgents.map((a) => ({
      value: a,
      label: targets[a].displayName,
    })),
  };

  // Other agents are selectable with their agentsDir as hint
  const otherChoices = otherAgents.map((a) => ({
    value: a,
    label: targets[a].displayName,
    hint: options.global ? targets[a].globalAgentsDir! : targets[a].agentsDir,
  }));

  // Get last selected agents (filter to only non-universal ones for initial selection)
  let lastSelected: string[] | undefined;
  try {
    lastSelected = await getLastSelectedTargets();
  } catch {
    // Silently ignore errors
  }

  const initialSelected = lastSelected
    ? (lastSelected.filter(
        (a) => otherAgents.includes(a as TargetType) && !universalAgents.includes(a as TargetType)
      ) as TargetType[])
    : [];

  const selected = await searchMultiselect({
    message: 'Which agents do you want to install to?',
    items: otherChoices,
    initialSelected,
    lockedSection: universalSection,
  });

  if (!isCancelled(selected)) {
    // Save selection (all agents including universal)
    try {
      await saveSelectedTargets(selected as string[]);
    } catch {
      // Silently ignore errors
    }
  }

  return selected as TargetType[] | symbol;
}

const version = packageJson.version;
setVersion(version);

export interface AddOptions {
  global?: boolean;
  target?: string[];
  yes?: boolean;
  agent?: string[];
  list?: boolean;
  all?: boolean;
  fullDepth?: boolean;
  copy?: boolean;
}

/**
 * Handle agents from a well-known endpoint (RFC 8615).
 * Discovers agents from /.well-known/agents/index.json
 */
async function handleWellKnownSkills(
  source: string,
  url: string,
  options: AddOptions,
  spinner: ReturnType<typeof p.spinner>
): Promise<void> {
  spinner.start('Discovering agents from well-known endpoint...');

  // Fetch all agents from the well-known endpoint
  const agents = await wellKnownProvider.fetchAllAgents(url);

  if (agents.length === 0) {
    spinner.stop(pc.red('No agents found'));
    p.outro(
      pc.red(
        'No agents found at this URL. Make sure the server has a /.well-known/agents/index.json file.'
      )
    );
    process.exit(1);
  }

  spinner.stop(`Found ${pc.green(agents.length)} agent${agents.length > 1 ? 's' : ''}`);

  // Log discovered agents
  for (const agent of agents) {
    p.log.info(`Agent: ${pc.cyan(agent.installName)}`);
    p.log.message(pc.dim(agent.description));
    if (agent.files.size > 1) {
      p.log.message(pc.dim(`  Files: ${Array.from(agent.files.keys()).join(', ')}`));
    }
  }

  if (options.list) {
    console.log();
    p.log.step(pc.bold('Available Agents'));
    for (const agent of agents) {
      p.log.message(`  ${pc.cyan(agent.installName)}`);
      p.log.message(`    ${pc.dim(agent.description)}`);
      if (agent.files.size > 1) {
        p.log.message(`    ${pc.dim(`Files: ${agent.files.size}`)}`);
      }
    }
    console.log();
    p.outro('Run without --list to install');
    process.exit(0);
  }

  // Filter agents if --agent option is provided
  let selectedAgents: WellKnownAgent[];

  if (options.agent?.includes('*')) {
    // --agent '*' selects all agents
    selectedAgents = agents;
    p.log.info(`Installing all ${agents.length} agents`);
  } else if (options.agent && options.agent.length > 0) {
    selectedAgents = agents.filter((s) =>
      options.agent!.some(
        (name) =>
          s.installName.toLowerCase() === name.toLowerCase() ||
          s.name.toLowerCase() === name.toLowerCase()
      )
    );

    if (selectedAgents.length === 0) {
      p.log.error(`No matching agents found for: ${options.agent.join(', ')}`);
      p.log.info('Available agents:');
      for (const s of agents) {
        p.log.message(`  - ${s.installName}`);
      }
      process.exit(1);
    }
  } else if (agents.length === 1) {
    selectedAgents = agents;
    const firstAgent = agents[0]!;
    p.log.info(`Agent: ${pc.cyan(firstAgent.installName)}`);
  } else if (options.yes) {
    selectedAgents = agents;
    p.log.info(`Installing all ${agents.length} agents`);
  } else {
    // Prompt user to select agents
    const agentChoices = agents.map((s) => ({
      value: s,
      label: s.installName,
      hint: s.description.length > 60 ? s.description.slice(0, 57) + '...' : s.description,
    }));

    const selected = await multiselect({
      message: 'Select agents to install',
      options: agentChoices,
      required: true,
    });

    if (p.isCancel(selected)) {
      p.cancel('Installation cancelled');
      process.exit(0);
    }

    selectedAgents = selected as WellKnownAgent[];
  }

  // Detect agents
  let targetAgents: TargetType[];
  const validAgents = Object.keys(targets);

  if (options.target?.includes('*')) {
    // --target '*' selects all targets
    targetAgents = validAgents as TargetType[];
    p.log.info(`Installing to all ${targetAgents.length} targets`);
  } else if (options.target && options.target.length > 0) {
    const invalidTargets = options.target.filter((a) => !validAgents.includes(a));

    if (invalidTargets.length > 0) {
      p.log.error(`Invalid targets: ${invalidTargets.join(', ')}`);
      p.log.info(`Valid targets: ${validAgents.join(', ')}`);
      process.exit(1);
    }

    targetAgents = options.target as TargetType[];
  } else {
    spinner.start('Loading agents...');
    const installedTargets = await detectInstalledTargets();
    const totalAgents = Object.keys(targets).length;
    spinner.stop(`${totalAgents} agents`);

    if (installedTargets.length === 0) {
      if (options.yes) {
        targetAgents = validAgents as TargetType[];
        p.log.info('Installing to all agents');
      } else {
        p.log.info('Select agents to install agents to');

        const allAgentChoices = Object.entries(targets).map(([key, config]) => ({
          value: key as TargetType,
          label: config.displayName,
        }));

        // Use helper to prompt with search
        const selected = await promptForAgents(
          'Which agents do you want to install to?',
          allAgentChoices
        );

        if (p.isCancel(selected)) {
          p.cancel('Installation cancelled');
          process.exit(0);
        }

        targetAgents = selected as TargetType[];
      }
    } else if (installedTargets.length === 1 || options.yes) {
      // Auto-select detected agents + ensure universal agents are included
      targetAgents = ensureUniversalAgents(installedTargets);
      if (installedTargets.length === 1) {
        const firstAgent = installedTargets[0]!;
        p.log.info(`Installing to: ${pc.cyan(targets[firstAgent].displayName)}`);
      } else {
        p.log.info(
          `Installing to: ${installedTargets.map((a) => pc.cyan(targets[a].displayName)).join(', ')}`
        );
      }
    } else {
      const selected = await selectAgentsInteractive({ global: options.global });

      if (p.isCancel(selected)) {
        p.cancel('Installation cancelled');
        process.exit(0);
      }

      targetAgents = selected as TargetType[];
    }
  }

  let installGlobally = options.global ?? false;

  // Check if any selected agents support global installation
  const supportsGlobal = targetAgents.some((a) => targets[a].globalAgentsDir !== undefined);

  if (options.global === undefined && !options.yes && supportsGlobal) {
    const scope = await p.select({
      message: 'Installation scope',
      options: [
        {
          value: false,
          label: 'Project',
          hint: 'Install in current directory (committed with your project)',
        },
        {
          value: true,
          label: 'Global',
          hint: 'Install in home directory (available across all projects)',
        },
      ],
    });

    if (p.isCancel(scope)) {
      p.cancel('Installation cancelled');
      process.exit(0);
    }

    installGlobally = scope as boolean;
  }

  // Determine install mode (symlink vs copy)
  let installMode: InstallMode = options.copy ? 'copy' : 'symlink';

  // Only prompt for install mode when there are multiple unique target directories.
  // When all selected agents share the same agentsDir, symlink vs copy is meaningless.
  const uniqueDirs = new Set(targetAgents.map((a) => targets[a].agentsDir));

  if (!options.copy && !options.yes && uniqueDirs.size > 1) {
    const modeChoice = await p.select({
      message: 'Installation method',
      options: [
        {
          value: 'symlink',
          label: 'Symlink (Recommended)',
          hint: 'Single source of truth, easy updates',
        },
        { value: 'copy', label: 'Copy to all agents', hint: 'Independent copies for each agent' },
      ],
    });

    if (p.isCancel(modeChoice)) {
      p.cancel('Installation cancelled');
      process.exit(0);
    }

    installMode = modeChoice as InstallMode;
  } else if (uniqueDirs.size <= 1) {
    // Single target directory — default to copy (no symlink needed)
    installMode = 'copy';
  }

  const cwd = process.cwd();

  // Build installation summary
  const summaryLines: string[] = [];
  const agentNames = targetAgents.map((a) => targets[a].displayName);

  // Check if any agent will be overwritten (parallel)
  const overwriteChecks = await Promise.all(
    selectedAgents.flatMap((ag) =>
      targetAgents.map(async (tgt) => ({
        agentName: ag.installName,
        target: tgt,
        installed: await isAgentInstalled(ag.installName, tgt, { global: installGlobally }),
      }))
    )
  );
  const overwriteStatus = new Map<string, Map<string, boolean>>();
  for (const { agentName, target, installed } of overwriteChecks) {
    if (!overwriteStatus.has(agentName)) {
      overwriteStatus.set(agentName, new Map());
    }
    overwriteStatus.get(agentName)!.set(target, installed);
  }

  for (const agent of selectedAgents) {
    if (summaryLines.length > 0) summaryLines.push('');

    const canonicalPath = getCanonicalPath(agent.installName, { global: installGlobally });
    const shortCanonical = shortenPath(canonicalPath, cwd);
    summaryLines.push(`${pc.cyan(shortCanonical)}`);
    summaryLines.push(...buildAgentSummaryLines(targetAgents, installMode));
    if (agent.files.size > 1) {
      summaryLines.push(`  ${pc.dim('files:')} ${agent.files.size}`);
    }

    const agentOverwrites = overwriteStatus.get(agent.installName);
    const overwriteAgents = targetAgents
      .filter((a) => agentOverwrites?.get(a))
      .map((a) => targets[a].displayName);

    if (overwriteAgents.length > 0) {
      summaryLines.push(`  ${pc.yellow('overwrites:')} ${formatList(overwriteAgents)}`);
    }
  }

  console.log();
  p.note(summaryLines.join('\n'), 'Installation Summary');

  if (!options.yes) {
    const confirmed = await p.confirm({ message: 'Proceed with installation?' });

    if (p.isCancel(confirmed) || !confirmed) {
      p.cancel('Installation cancelled');
      process.exit(0);
    }
  }

  spinner.start('Installing agents...');

  const results: {
    agent: string;
    target: string;
    success: boolean;
    path: string;
    canonicalPath?: string;
    mode: InstallMode;
    symlinkFailed?: boolean;
    error?: string;
  }[] = [];

  for (const ag of selectedAgents) {
    for (const tgt of targetAgents) {
      const result = await installWellKnownAgentForTarget(ag, tgt, {
        global: installGlobally,
        mode: installMode,
      });
      results.push({
        agent: ag.installName,
        target: targets[tgt].displayName,
        ...result,
      });
    }
  }

  spinner.stop('Installation complete');

  console.log();
  const successful = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);

  // Track installation
  const sourceIdentifier = wellKnownProvider.getSourceIdentifier(url);

  // Build agentFiles map: { agentName: sourceUrl }
  const agentFiles: Record<string, string> = {};
  for (const agent of selectedAgents) {
    agentFiles[agent.installName] = agent.sourceUrl;
  }

  // Skip telemetry for private GitHub repos
  const isPrivate = await isSourcePrivate(sourceIdentifier);
  if (isPrivate !== true) {
    // Only send telemetry if repo is public (isPrivate === false) or we can't determine (null for non-GitHub sources)
    track({
      event: 'install',
      source: sourceIdentifier,
      agents: selectedAgents.map((s) => s.installName).join(','),
      targets: targetAgents.join(','),
      ...(installGlobally && { global: '1' }),
      agentFiles: JSON.stringify(agentFiles),
      sourceType: 'well-known',
    });
  }

  // Add to agent lock file for update tracking (only for global installs)
  if (successful.length > 0 && installGlobally) {
    const successfulAgentNames = new Set(successful.map((r) => r.agent));
    for (const agent of selectedAgents) {
      if (successfulAgentNames.has(agent.installName)) {
        try {
          await addAgentToLock(agent.installName, {
            source: sourceIdentifier,
            sourceType: 'well-known',
            sourceUrl: agent.sourceUrl,
            agentFolderHash: '', // Well-known agents don't have a folder hash
          });
        } catch {
          // Don't fail installation if lock file update fails
        }
      }
    }
  }

  // Add to local lock file for project-scoped installs
  if (successful.length > 0 && !installGlobally) {
    const successfulAgentNames = new Set(successful.map((r) => r.agent));
    for (const agent of selectedAgents) {
      if (successfulAgentNames.has(agent.installName)) {
        try {
          const matchingResult = successful.find((r) => r.agent === agent.installName);
          const installDir = matchingResult?.canonicalPath || matchingResult?.path;
          if (installDir) {
            const computedHash = await computeAgentFolderHash(installDir);
            await addAgentToLocalLock(
              agent.installName,
              {
                source: sourceIdentifier,
                sourceType: 'well-known',
                computedHash,
              },
              cwd
            );
          }
        } catch {
          // Don't fail installation if lock file update fails
        }
      }
    }
  }

  if (successful.length > 0) {
    const bySkill = new Map<string, typeof results>();
    for (const r of successful) {
      const agentResults = bySkill.get(r.agent) || [];
      agentResults.push(r);
      bySkill.set(r.agent, agentResults);
    }

    const agentCount = bySkill.size;
    const symlinkFailures = successful.filter((r) => r.mode === 'symlink' && r.symlinkFailed);
    const copiedAgents = symlinkFailures.map((r) => r.agent);
    const resultLines: string[] = [];

    for (const [agentName, agentResults] of bySkill) {
      const firstResult = agentResults[0]!;

      if (firstResult.mode === 'copy') {
        // Copy mode: show agent name and list all agent paths
        resultLines.push(`${pc.green('✓')} ${agentName} ${pc.dim('(copied)')}`);
        for (const r of agentResults) {
          const shortPath = shortenPath(r.path, cwd);
          resultLines.push(`  ${pc.dim('→')} ${shortPath}`);
        }
      } else {
        // Symlink mode: show canonical path and universal/symlinked agents
        if (firstResult.canonicalPath) {
          const shortPath = shortenPath(firstResult.canonicalPath, cwd);
          resultLines.push(`${pc.green('✓')} ${shortPath}`);
        } else {
          resultLines.push(`${pc.green('✓')} ${agentName}`);
        }
        resultLines.push(...buildResultLines(agentResults, targetAgents));
      }
    }

    const title = pc.green(`Installed ${agentCount} agent${agentCount !== 1 ? 's' : ''}`);
    p.note(resultLines.join('\n'), title);

    // Show symlink failure warning (only for symlink mode)
    if (symlinkFailures.length > 0) {
      p.log.warn(pc.yellow(`Symlinks failed for: ${formatList(copiedAgents)}`));
      p.log.message(
        pc.dim(
          '  Files were copied instead. On Windows, enable Developer Mode for symlink support.'
        )
      );
    }
  }

  if (failed.length > 0) {
    console.log();
    p.log.error(pc.red(`Failed to install ${failed.length}`));
    for (const r of failed) {
      p.log.message(`  ${pc.red('✗')} ${r.agent} → ${r.agent}: ${pc.dim(r.error)}`);
    }
  }

  console.log();
  p.outro(
    pc.green('Done!') + pc.dim('  Review agents before use; they run with full agent permissions.')
  );

  // Prompt for find-agents after successful install
  await promptForFindSkills(options, targetAgents);
}

export async function runAdd(args: string[], options: AddOptions = {}): Promise<void> {
  const source = args[0];
  let installTipShown = false;

  const showInstallTip = (): void => {
    if (installTipShown) return;
    p.log.message(
      pc.dim('Tip: use the --yes (-y) and --global (-g) flags to install without prompts.')
    );
    installTipShown = true;
  };

  if (!source) {
    console.log();
    console.log(
      pc.bgRed(pc.white(pc.bold(' ERROR '))) + ' ' + pc.red('Missing required argument: source')
    );
    console.log();
    console.log(pc.dim('  Usage:'));
    console.log(`    ${pc.cyan('npx agents add')} ${pc.yellow('<source>')} ${pc.dim('[options]')}`);
    console.log();
    console.log(pc.dim('  Example:'));
    console.log(`    ${pc.cyan('npx agents add')} ${pc.yellow('vercel-labs/agent-agents')}`);
    console.log();
    process.exit(1);
  }

  // --all implies --agent '*' and --target '*' and -y
  if (options.all) {
    options.agent = ['*'];
    options.target = ['*'];
    options.yes = true;
  }

  console.log();
  p.intro(pc.bgCyan(pc.black(' agents ')));

  if (!process.stdin.isTTY) {
    showInstallTip();
  }

  let tempDir: string | null = null;

  try {
    const spinner = p.spinner();

    spinner.start('Parsing source...');
    const parsed = parseSource(source);
    spinner.stop(
      `Source: ${parsed.type === 'local' ? parsed.localPath! : parsed.url}${parsed.ref ? ` @ ${pc.yellow(parsed.ref)}` : ''}${parsed.subpath ? ` (${parsed.subpath})` : ''}${parsed.agentFilter ? ` ${pc.dim('@')}${pc.cyan(parsed.agentFilter)}` : ''}`
    );

    // Handle well-known agents from arbitrary URLs
    if (parsed.type === 'well-known') {
      await handleWellKnownSkills(source, parsed.url, options, spinner);
      return;
    }

    let agentsDir: string;

    if (parsed.type === 'local') {
      // Use local path directly, no cloning needed
      spinner.start('Validating local path...');
      if (!existsSync(parsed.localPath!)) {
        spinner.stop(pc.red('Path not found'));
        p.outro(pc.red(`Local path does not exist: ${parsed.localPath}`));
        process.exit(1);
      }
      agentsDir = parsed.localPath!;
      spinner.stop('Local path validated');
    } else {
      // Clone repository for remote sources
      spinner.start('Cloning repository...');
      tempDir = await cloneRepo(parsed.url, parsed.ref);
      agentsDir = tempDir;
      spinner.stop('Repository cloned');
    }

    // If agentFilter is present from @agent syntax (e.g., owner/repo@agent-name),
    // merge it into options.agent
    if (parsed.agentFilter) {
      options.agent = options.agent || [];
      if (!options.agent.includes(parsed.agentFilter)) {
        options.agent.push(parsed.agentFilter);
      }
    }

    // Include internal agents when a specific agent is explicitly requested
    // (via --agent or @agent syntax)
    const includeInternal = !!(options.agent && options.agent.length > 0);

    spinner.start('Discovering agents...');
    const agents = await discoverAgents(agentsDir, parsed.subpath, {
      includeInternal,
      fullDepth: options.fullDepth,
    });

    if (agents.length === 0) {
      spinner.stop(pc.red('No agents found'));
      p.outro(
        pc.red('No valid agents found. Agents require a AGENT.md with name and description.')
      );
      await cleanup(tempDir);
      process.exit(1);
    }

    spinner.stop(`Found ${pc.green(agents.length)} agent${agents.length > 1 ? 's' : ''}`);

    if (options.list) {
      console.log();
      p.log.step(pc.bold('Available Agents'));

      // Group available agents by plugin for list output
      const groupedSkills: Record<string, Agent[]> = {};
      const ungroupedSkills: Agent[] = [];

      for (const agent of agents) {
        if (agent.pluginName) {
          const group = agent.pluginName;
          if (!groupedSkills[group]) groupedSkills[group] = [];
          groupedSkills[group].push(agent);
        } else {
          ungroupedSkills.push(agent);
        }
      }

      // Print groups
      const sortedGroups = Object.keys(groupedSkills).sort();
      for (const group of sortedGroups) {
        // Convert kebab-case to Title Case for display header
        const title = group
          .split('-')
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
          .join(' ');

        console.log(pc.bold(title));
        for (const agent of groupedSkills[group]!) {
          p.log.message(`  ${pc.cyan(getAgentDisplayName(agent))}`);
          p.log.message(`    ${pc.dim(agent.description)}`);
        }
        console.log();
      }

      // Print ungrouped
      if (ungroupedSkills.length > 0) {
        if (sortedGroups.length > 0) console.log(pc.bold('General'));
        for (const agent of ungroupedSkills) {
          p.log.message(`  ${pc.cyan(getAgentDisplayName(agent))}`);
          p.log.message(`    ${pc.dim(agent.description)}`);
        }
      }

      console.log();
      p.outro('Use --agent <name> to install specific agents');
      await cleanup(tempDir);
      process.exit(0);
    }

    let selectedAgents: Agent[];

    if (options.agent?.includes('*')) {
      // --agent '*' selects all agents
      selectedAgents = agents;
      p.log.info(`Installing all ${agents.length} agents`);
    } else if (options.agent && options.agent.length > 0) {
      selectedAgents = filterAgents(agents, options.agent);

      if (selectedAgents.length === 0) {
        p.log.error(`No matching agents found for: ${options.agent.join(', ')}`);
        p.log.info('Available agents:');
        for (const s of agents) {
          p.log.message(`  - ${getAgentDisplayName(s)}`);
        }
        await cleanup(tempDir);
        process.exit(1);
      }

      p.log.info(
        `Selected ${selectedAgents.length} agent${selectedAgents.length !== 1 ? 's' : ''}: ${selectedAgents.map((s) => pc.cyan(getAgentDisplayName(s))).join(', ')}`
      );
    } else if (agents.length === 1) {
      selectedAgents = agents;
      const firstAgent = agents[0]!;
      p.log.info(`Agent: ${pc.cyan(getAgentDisplayName(firstAgent))}`);
      p.log.message(pc.dim(firstAgent.description));
    } else if (options.yes) {
      selectedAgents = agents;
      p.log.info(`Installing all ${agents.length} agents`);
    } else {
      // Sort agents by plugin name first, then by agent name
      const sortedAgents = [...agents].sort((a, b) => {
        if (a.pluginName && !b.pluginName) return -1;
        if (!a.pluginName && b.pluginName) return 1;
        if (a.pluginName && b.pluginName && a.pluginName !== b.pluginName) {
          return a.pluginName.localeCompare(b.pluginName);
        }
        return getAgentDisplayName(a).localeCompare(getAgentDisplayName(b));
      });

      // Check if any agents have plugin grouping
      const hasGroups = sortedAgents.some((s) => s.pluginName);

      let selected: Agent[] | symbol;

      if (hasGroups) {
        // Build grouped options for groupMultiselect
        const kebabToTitle = (s: string) =>
          s
            .split('-')
            .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
            .join(' ');

        const grouped: Record<string, p.Option<Agent>[]> = {};
        for (const s of sortedAgents) {
          const groupName = s.pluginName ? kebabToTitle(s.pluginName) : 'Other';
          if (!grouped[groupName]) grouped[groupName] = [];
          grouped[groupName]!.push({
            value: s,
            label: getAgentDisplayName(s),
            hint: s.description.length > 60 ? s.description.slice(0, 57) + '...' : s.description,
          });
        }

        selected = await p.groupMultiselect({
          message: `Select agents to install ${pc.dim('(space to toggle)')}`,
          options: grouped,
          required: true,
        });
      } else {
        const agentChoices = sortedAgents.map((s) => ({
          value: s,
          label: getAgentDisplayName(s),
          hint: s.description.length > 60 ? s.description.slice(0, 57) + '...' : s.description,
        }));

        selected = await multiselect({
          message: 'Select agents to install',
          options: agentChoices,
          required: true,
        });
      }

      if (p.isCancel(selected)) {
        p.cancel('Installation cancelled');
        await cleanup(tempDir);
        process.exit(0);
      }

      selectedAgents = selected as Agent[];
    }

    // Kick off security audit fetch early (non-blocking) so it runs
    // in parallel with agent selection, scope, and mode prompts.
    const ownerRepoForAudit = getOwnerRepo(parsed);
    const auditPromise = ownerRepoForAudit
      ? fetchAuditData(
          ownerRepoForAudit,
          selectedAgents.map((s) => getAgentDisplayName(s))
        )
      : Promise.resolve(null);

    let targetAgents: TargetType[];
    const validAgents = Object.keys(targets);

    if (options.target?.includes('*')) {
      // --target '*' selects all targets
      targetAgents = validAgents as TargetType[];
      p.log.info(`Installing to all ${targetAgents.length} targets`);
    } else if (options.target && options.target.length > 0) {
      const invalidTargets = options.target.filter((a) => !validAgents.includes(a));

      if (invalidTargets.length > 0) {
        p.log.error(`Invalid targets: ${invalidTargets.join(', ')}`);
        p.log.info(`Valid targets: ${validAgents.join(', ')}`);
        await cleanup(tempDir);
        process.exit(1);
      }

      targetAgents = options.target as TargetType[];
    } else {
      spinner.start('Loading agents...');
      const installedTargets = await detectInstalledTargets();
      const totalAgents = Object.keys(targets).length;
      spinner.stop(`${totalAgents} agents`);

      if (installedTargets.length === 0) {
        if (options.yes) {
          targetAgents = validAgents as TargetType[];
          p.log.info('Installing to all agents');
        } else {
          p.log.info('Select agents to install agents to');

          const allAgentChoices = Object.entries(targets).map(([key, config]) => ({
            value: key as TargetType,
            label: config.displayName,
          }));

          // Use helper to prompt with search
          const selected = await promptForAgents(
            'Which agents do you want to install to?',
            allAgentChoices
          );

          if (p.isCancel(selected)) {
            p.cancel('Installation cancelled');
            await cleanup(tempDir);
            process.exit(0);
          }

          targetAgents = selected as TargetType[];
        }
      } else if (installedTargets.length === 1 || options.yes) {
        // Auto-select detected agents + ensure universal agents are included
        targetAgents = ensureUniversalAgents(installedTargets);
        if (installedTargets.length === 1) {
          const firstAgent = installedTargets[0]!;
          p.log.info(`Installing to: ${pc.cyan(targets[firstAgent].displayName)}`);
        } else {
          p.log.info(
            `Installing to: ${installedTargets.map((a) => pc.cyan(targets[a].displayName)).join(', ')}`
          );
        }
      } else {
        const selected = await selectAgentsInteractive({ global: options.global });

        if (p.isCancel(selected)) {
          p.cancel('Installation cancelled');
          await cleanup(tempDir);
          process.exit(0);
        }

        targetAgents = selected as TargetType[];
      }
    }

    let installGlobally = options.global ?? false;

    // Check if any selected agents support global installation
    const supportsGlobal = targetAgents.some((a) => targets[a].globalAgentsDir !== undefined);

    if (options.global === undefined && !options.yes && supportsGlobal) {
      const scope = await p.select({
        message: 'Installation scope',
        options: [
          {
            value: false,
            label: 'Project',
            hint: 'Install in current directory (committed with your project)',
          },
          {
            value: true,
            label: 'Global',
            hint: 'Install in home directory (available across all projects)',
          },
        ],
      });

      if (p.isCancel(scope)) {
        p.cancel('Installation cancelled');
        await cleanup(tempDir);
        process.exit(0);
      }

      installGlobally = scope as boolean;
    }

    // Determine install mode (symlink vs copy)
    let installMode: InstallMode = options.copy ? 'copy' : 'symlink';

    // Only prompt for install mode when there are multiple unique target directories.
    // When all selected agents share the same agentsDir, symlink vs copy is meaningless.
    const uniqueDirs = new Set(targetAgents.map((a) => targets[a].agentsDir));

    if (!options.copy && !options.yes && uniqueDirs.size > 1) {
      const modeChoice = await p.select({
        message: 'Installation method',
        options: [
          {
            value: 'symlink',
            label: 'Symlink (Recommended)',
            hint: 'Single source of truth, easy updates',
          },
          { value: 'copy', label: 'Copy to all agents', hint: 'Independent copies for each agent' },
        ],
      });

      if (p.isCancel(modeChoice)) {
        p.cancel('Installation cancelled');
        await cleanup(tempDir);
        process.exit(0);
      }

      installMode = modeChoice as InstallMode;
    } else if (uniqueDirs.size <= 1) {
      // Single target directory — default to copy (no symlink needed)
      installMode = 'copy';
    }

    const cwd = process.cwd();

    // Build installation summary
    const summaryLines: string[] = [];
    const agentNames = targetAgents.map((a) => targets[a].displayName);

    // Check if any agent will be overwritten (parallel)
    const overwriteChecks = await Promise.all(
      selectedAgents.flatMap((ag) =>
        targetAgents.map(async (tgt) => ({
          agentName: ag.name,
          target: tgt,
          installed: await isAgentInstalled(ag.name, tgt, { global: installGlobally }),
        }))
      )
    );
    const overwriteStatus = new Map<string, Map<string, boolean>>();
    for (const { agentName, target, installed } of overwriteChecks) {
      if (!overwriteStatus.has(agentName)) {
        overwriteStatus.set(agentName, new Map());
      }
      overwriteStatus.get(agentName)!.set(target, installed);
    }

    // Group selected agents for summary
    const groupedSummary: Record<string, Agent[]> = {};
    const ungroupedSummary: Agent[] = [];

    for (const agent of selectedAgents) {
      if (agent.pluginName) {
        const group = agent.pluginName;
        if (!groupedSummary[group]) groupedSummary[group] = [];
        groupedSummary[group].push(agent);
      } else {
        ungroupedSummary.push(agent);
      }
    }

    // Helper to print summary lines for a list of agents
    const printSkillSummary = (agents: Agent[]) => {
      for (const agent of agents) {
        if (summaryLines.length > 0) summaryLines.push('');

        const canonicalPath = getCanonicalPath(agent.name, { global: installGlobally });
        const shortCanonical = shortenPath(canonicalPath, cwd);
        summaryLines.push(`${pc.cyan(shortCanonical)}`);
        summaryLines.push(...buildAgentSummaryLines(targetAgents, installMode));

        const agentOverwrites = overwriteStatus.get(agent.name);
        const overwriteAgents = targetAgents
          .filter((a) => agentOverwrites?.get(a))
          .map((a) => targets[a].displayName);

        if (overwriteAgents.length > 0) {
          summaryLines.push(`  ${pc.yellow('overwrites:')} ${formatList(overwriteAgents)}`);
        }
      }
    };

    // Build grouped summary
    const sortedGroups = Object.keys(groupedSummary).sort();

    for (const group of sortedGroups) {
      const title = group
        .split('-')
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');

      summaryLines.push('');
      summaryLines.push(pc.bold(title));
      printSkillSummary(groupedSummary[group]!);
    }

    if (ungroupedSummary.length > 0) {
      if (sortedGroups.length > 0) {
        summaryLines.push('');
        summaryLines.push(pc.bold('General'));
      }
      printSkillSummary(ungroupedSummary);
    }

    console.log();
    p.note(summaryLines.join('\n'), 'Installation Summary');

    // Await and display security audit results (started earlier in parallel)
    // Wrapped in try/catch so a failed audit fetch never blocks installation.
    try {
      const auditData = await auditPromise;
      if (auditData && ownerRepoForAudit) {
        const securityLines = buildSecurityLines(
          auditData,
          selectedAgents.map((s) => ({
            slug: getAgentDisplayName(s),
            displayName: getAgentDisplayName(s),
          })),
          ownerRepoForAudit
        );
        if (securityLines.length > 0) {
          p.note(securityLines.join('\n'), 'Security Risk Assessments');
        }
      }
    } catch {
      // Silently skip — security info is advisory only
    }

    if (!options.yes) {
      const confirmed = await p.confirm({ message: 'Proceed with installation?' });

      if (p.isCancel(confirmed) || !confirmed) {
        p.cancel('Installation cancelled');
        await cleanup(tempDir);
        process.exit(0);
      }
    }

    spinner.start('Installing agents...');

    const results: {
      agent: string;
      target: string;
      success: boolean;
      path: string;
      canonicalPath?: string;
      mode: InstallMode;
      symlinkFailed?: boolean;
      error?: string;
      pluginName?: string;
    }[] = [];

    for (const ag of selectedAgents) {
      for (const tgt of targetAgents) {
        const result = await installAgentForTarget(ag, tgt, {
          global: installGlobally,
          mode: installMode,
        });
        results.push({
          agent: getAgentDisplayName(ag),
          target: targets[tgt].displayName,
          pluginName: ag.pluginName,
          ...result,
        });
      }
    }

    spinner.stop('Installation complete');

    console.log();
    const successful = results.filter((r) => r.success);
    const failed = results.filter((r) => !r.success);

    // Track installation result
    // Build agentFiles map: { agentName: relative path to AGENT.md from repo root }
    const agentFiles: Record<string, string> = {};
    for (const agent of selectedAgents) {
      // agent.path is absolute, compute relative from tempDir (repo root)
      let relativePath: string;
      if (tempDir && agent.path === tempDir) {
        // Agent is at root level of repo
        relativePath = 'AGENT.md';
      } else if (tempDir && agent.path.startsWith(tempDir + sep)) {
        // Compute path relative to repo root (tempDir), not search path
        // Use forward slashes for telemetry (URL-style paths)
        relativePath =
          agent.path
            .slice(tempDir.length + 1)
            .split(sep)
            .join('/') + '/AGENT.md';
      } else {
        // Local path - skip telemetry for local installs
        continue;
      }
      agentFiles[agent.name] = relativePath;
    }

    // Normalize source to owner/repo format for telemetry
    const normalizedSource = getOwnerRepo(parsed);

    // Preserve SSH URLs in lock files instead of normalizing to owner/repo shorthand.
    // When normalizedSource is used, parseSource() later resolves it to HTTPS,
    // breaking restore for private repos that require SSH authentication.
    const isSSH = parsed.url.startsWith('git@');
    const lockSource = isSSH ? parsed.url : normalizedSource;

    // Only track if we have a valid remote source and it's not a private repo
    if (normalizedSource) {
      const ownerRepo = parseOwnerRepo(normalizedSource);
      if (ownerRepo) {
        // Check if repo is private - skip telemetry for private repos
        const isPrivate = await isRepoPrivate(ownerRepo.owner, ownerRepo.repo);
        // Only send telemetry if repo is public (isPrivate === false)
        // If we can't determine (null), err on the side of caution and skip telemetry
        if (isPrivate === false) {
          track({
            event: 'install',
            source: normalizedSource,
            agents: selectedAgents.map((s) => s.name).join(','),
            targets: targetAgents.join(','),
            ...(installGlobally && { global: '1' }),
            agentFiles: JSON.stringify(agentFiles),
          });
        }
      } else {
        // If we can't parse owner/repo, still send telemetry (for non-GitHub sources)
        track({
          event: 'install',
          source: normalizedSource,
          agents: selectedAgents.map((s) => s.name).join(','),
          targets: targetAgents.join(','),
          ...(installGlobally && { global: '1' }),
          agentFiles: JSON.stringify(agentFiles),
        });
      }
    }

    // Add to agent lock file for update tracking (only for global installs)
    if (successful.length > 0 && installGlobally && normalizedSource) {
      const successfulAgentNames = new Set(successful.map((r) => r.agent));
      for (const agent of selectedAgents) {
        const agentDisplayName = getAgentDisplayName(agent);
        if (successfulAgentNames.has(agentDisplayName)) {
          try {
            // Fetch the folder hash from GitHub Trees API
            let agentFolderHash = '';
            const agentPathValue = agentFiles[agent.name];
            if (parsed.type === 'github' && agentPathValue) {
              const token = getGitHubToken();
              const hash = await fetchAgentFolderHash(normalizedSource, agentPathValue, token);
              if (hash) agentFolderHash = hash;
            }

            await addAgentToLock(agent.name, {
              source: lockSource || normalizedSource,
              sourceType: parsed.type,
              sourceUrl: parsed.url,
              agentPath: agentPathValue,
              agentFolderHash,
              pluginName: agent.pluginName,
            });
          } catch {
            // Don't fail installation if lock file update fails
          }
        }
      }
    }

    // Add to local lock file for project-scoped installs
    if (successful.length > 0 && !installGlobally) {
      const successfulAgentNames = new Set(successful.map((r) => r.agent));
      for (const agent of selectedAgents) {
        const agentDisplayName = getAgentDisplayName(agent);
        if (successfulAgentNames.has(agentDisplayName)) {
          try {
            const computedHash = await computeAgentFolderHash(agent.path);
            await addAgentToLocalLock(
              agent.name,
              {
                source: lockSource || parsed.url,
                sourceType: parsed.type,
                computedHash,
              },
              cwd
            );
          } catch {
            // Don't fail installation if lock file update fails
          }
        }
      }
    }

    if (successful.length > 0) {
      const bySkill = new Map<string, typeof results>();

      // Group results by plugin name
      const groupedResults: Record<string, typeof results> = {};
      const ungroupedResults: typeof results = [];

      for (const r of successful) {
        const agentResults = bySkill.get(r.agent) || [];
        agentResults.push(r);
        bySkill.set(r.agent, agentResults);

        // We only need to group once per agent (take the first result for that agent)
        if (agentResults.length === 1) {
          if (r.pluginName) {
            const group = r.pluginName;
            if (!groupedResults[group]) groupedResults[group] = [];
            // We'll store just one entry per agent here to drive the loop
            groupedResults[group].push(r);
          } else {
            ungroupedResults.push(r);
          }
        }
      }

      const agentCount = bySkill.size;
      const symlinkFailures = successful.filter((r) => r.mode === 'symlink' && r.symlinkFailed);
      const copiedAgents = symlinkFailures.map((r) => r.agent);
      const resultLines: string[] = [];

      const printSkillResults = (entries: typeof results) => {
        for (const entry of entries) {
          const agentResults = bySkill.get(entry.agent) || [];
          const firstResult = agentResults[0]!;

          if (firstResult.mode === 'copy') {
            // Copy mode: show agent name and list all agent paths
            resultLines.push(`${pc.green('✓')} ${entry.agent} ${pc.dim('(copied)')}`);
            for (const r of agentResults) {
              const shortPath = shortenPath(r.path, cwd);
              resultLines.push(`  ${pc.dim('→')} ${shortPath}`);
            }
          } else {
            // Symlink mode: show canonical path and universal/symlinked agents
            if (firstResult.canonicalPath) {
              const shortPath = shortenPath(firstResult.canonicalPath, cwd);
              resultLines.push(`${pc.green('✓')} ${shortPath}`);
            } else {
              resultLines.push(`${pc.green('✓')} ${entry.agent}`);
            }
            resultLines.push(...buildResultLines(agentResults, targetAgents));
          }
        }
      };

      // Print grouped results
      const sortedResultGroups = Object.keys(groupedResults).sort();

      for (const group of sortedResultGroups) {
        const title = group
          .split('-')
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
          .join(' ');

        resultLines.push('');
        resultLines.push(pc.bold(title));
        printSkillResults(groupedResults[group]!);
      }

      if (ungroupedResults.length > 0) {
        if (sortedResultGroups.length > 0) {
          resultLines.push('');
          resultLines.push(pc.bold('General'));
        }
        printSkillResults(ungroupedResults);
      }

      const title = pc.green(`Installed ${agentCount} agent${agentCount !== 1 ? 's' : ''}`);
      p.note(resultLines.join('\n'), title);

      // Show symlink failure warning (only for symlink mode)
      if (symlinkFailures.length > 0) {
        p.log.warn(pc.yellow(`Symlinks failed for: ${formatList(copiedAgents)}`));
        p.log.message(
          pc.dim(
            '  Files were copied instead. On Windows, enable Developer Mode for symlink support.'
          )
        );
      }
    }

    if (failed.length > 0) {
      console.log();
      p.log.error(pc.red(`Failed to install ${failed.length}`));
      for (const r of failed) {
        p.log.message(`  ${pc.red('✗')} ${r.agent} → ${r.agent}: ${pc.dim(r.error)}`);
      }
    }

    console.log();
    p.outro(
      pc.green('Done!') +
        pc.dim('  Review agents before use; they run with full agent permissions.')
    );

    // Prompt for find-agents after successful install
    await promptForFindSkills(options, targetAgents);
  } catch (error) {
    if (error instanceof GitCloneError) {
      p.log.error(pc.red('Failed to clone repository'));
      // Print each line of the error message separately for better formatting
      for (const line of error.message.split('\n')) {
        p.log.message(pc.dim(line));
      }
    } else {
      p.log.error(error instanceof Error ? error.message : 'Unknown error occurred');
    }
    showInstallTip();
    p.outro(pc.red('Installation failed'));
    process.exit(1);
  } finally {
    await cleanup(tempDir);
  }
}

// Cleanup helper
async function cleanup(tempDir: string | null) {
  if (tempDir) {
    try {
      await cleanupTempDir(tempDir);
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Prompt user to install the find-agents agent after their first installation.
 */
async function promptForFindSkills(
  options?: AddOptions,
  targetAgents?: TargetType[]
): Promise<void> {
  // Skip if already dismissed or not in interactive mode
  if (!process.stdin.isTTY) return;
  if (options?.yes) return;

  try {
    const dismissed = await isPromptDismissed('findAgentsPrompt');
    if (dismissed) return;

    // Check if find-agents is already installed
    const findSkillsInstalled = await isAgentInstalled('find-agents', 'claude-code', {
      global: true,
    });
    if (findSkillsInstalled) {
      // Mark as dismissed so we don't check again
      await dismissPrompt('findAgentsPrompt');
      return;
    }

    console.log();
    p.log.message(pc.dim("One-time prompt - you won't be asked again if you dismiss."));
    const install = await p.confirm({
      message: `Install the ${pc.cyan('find-agents')} agent? It helps your agent discover and suggest agents.`,
    });

    if (p.isCancel(install)) {
      await dismissPrompt('findAgentsPrompt');
      return;
    }

    if (install) {
      // Install find-agents to the same agents the user selected, excluding replit
      await dismissPrompt('findAgentsPrompt');

      // Filter out replit from target agents
      const findSkillsAgents = targetAgents?.filter((a) => a !== 'replit');

      // Skip if no valid agents remain after filtering
      if (!findSkillsAgents || findSkillsAgents.length === 0) {
        return;
      }

      console.log();
      p.log.step('Installing find-agents agent...');

      try {
        // Call runAdd directly
        await runAdd(['vercel-labs/agents'], {
          agent: ['find-agents'],
          global: true,
          yes: true,
          target: findSkillsAgents,
        });
      } catch {
        p.log.warn('Failed to install find-agents. You can try again with:');
        p.log.message(pc.dim('  npx agents add vercel-labs/agents@find-agents -g -y --all'));
      }
    } else {
      // User declined - dismiss the prompt
      await dismissPrompt('findAgentsPrompt');
      p.log.message(
        pc.dim('You can install it later with: npx agents add vercel-labs/agents@find-agents')
      );
    }
  } catch {
    // Don't fail the main installation if prompt fails
  }
}

// Parse command line options from args array
export function parseAddOptions(args: string[]): { source: string[]; options: AddOptions } {
  const options: AddOptions = {};
  const source: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '-g' || arg === '--global') {
      options.global = true;
    } else if (arg === '-y' || arg === '--yes') {
      options.yes = true;
    } else if (arg === '-l' || arg === '--list') {
      options.list = true;
    } else if (arg === '--all') {
      options.all = true;
    } else if (arg === '-t' || arg === '--target') {
      options.target = options.target || [];
      i++;
      let nextArg = args[i];
      while (i < args.length && nextArg && !nextArg.startsWith('-')) {
        options.target.push(nextArg);
        i++;
        nextArg = args[i];
      }
      i--; // Back up one since the loop will increment
    } else if (arg === '-a' || arg === '--agent') {
      options.agent = options.agent || [];
      i++;
      let nextArg = args[i];
      while (i < args.length && nextArg && !nextArg.startsWith('-')) {
        options.agent.push(nextArg);
        i++;
        nextArg = args[i];
      }
      i--; // Back up one since the loop will increment
    } else if (arg === '--full-depth') {
      options.fullDepth = true;
    } else if (arg === '--copy') {
      options.copy = true;
    } else if (arg && !arg.startsWith('-')) {
      source.push(arg);
    }
  }

  return { source, options };
}
