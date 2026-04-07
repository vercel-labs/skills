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
import { discoverSkills, getSkillDisplayName, filterSkills } from './skills.ts';
import {
  installSkillForAgent,
  isSkillInstalled,
  getInstallPath,
  getCanonicalPath,
  installRemoteSkillForAgent,
  installWellKnownSkillForAgent,
  type InstallMode,
} from './installer.ts';
import {
  detectInstalledAgents,
  agents,
  getUniversalAgents,
  getNonUniversalAgents,
  isUniversalAgent,
} from './agents.ts';
import {
  track,
  setVersion,
  fetchAuditData,
  type AuditResponse,
  type SkillAuditData,
  type PartnerAudit,
} from './telemetry.ts';
import { findProvider, wellKnownProvider, type WellKnownSkill } from './providers/index.ts';
import { fetchMintlifySkill } from './mintlify.ts';
import {
  addSkillToLock,
  fetchSkillFolderHash,
  isPromptDismissed,
  dismissPrompt,
  getLastSelectedAgents,
  saveSelectedAgents,
} from './skill-lock.ts';
import { addSkillToLocalLock, computeSkillFolderHash } from './local-lock.ts';
import type { Skill, AgentType, RemoteSkill } from './types.ts';
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
  skills: Array<{ slug: string; displayName: string }>,
  source: string
): string[] {
  if (!auditData) return [];

  // Check if we have any audit data at all
  const hasAny = skills.some((s) => {
    const data = auditData[s.slug];
    return data && Object.keys(data).length > 0;
  });
  if (!hasAny) return [];

  // Compute column width for skill names
  const nameWidth = Math.min(Math.max(...skills.map((s) => s.displayName.length)), 36);

  // Header
  const lines: string[] = [];
  const header =
    padEnd('', nameWidth + 2) +
    padEnd(pc.dim('Gen'), 18) +
    padEnd(pc.dim('Socket'), 18) +
    pc.dim('Snyk');
  lines.push(header);

  // Rows
  for (const skill of skills) {
    const data = auditData[skill.slug];
    const name =
      skill.displayName.length > nameWidth
        ? skill.displayName.slice(0, nameWidth - 1) + '\u2026'
        : skill.displayName;

    const ath = data?.ath ? riskLabel(data.ath.risk) : pc.dim('--');
    const socket = data?.socket ? socketLabel(data.socket) : pc.dim('--');
    const snyk = data?.snyk ? riskLabel(data.snyk.risk) : pc.dim('--');

    lines.push(padEnd(pc.cyan(name), nameWidth + 2) + padEnd(ath, 18) + padEnd(socket, 18) + snyk);
  }

  // Footer link
  lines.push('');
  lines.push(`${pc.dim('Details:')} ${pc.dim(`https://skills.sh/${source}`)}`);

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
function splitAgentsByType(agentTypes: AgentType[]): {
  universal: string[];
  symlinked: string[];
} {
  const universal: string[] = [];
  const symlinked: string[] = [];

  for (const a of agentTypes) {
    if (isUniversalAgent(a)) {
      universal.push(agents[a].displayName);
    } else {
      symlinked.push(agents[a].displayName);
    }
  }

  return { universal, symlinked };
}

/**
 * Builds summary lines showing universal vs symlinked agents
 */
function buildAgentSummaryLines(targetAgents: AgentType[], installMode: InstallMode): string[] {
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
    const allNames = targetAgents.map((a) => agents[a].displayName);
    lines.push(`  ${pc.dim('copy →')} ${formatList(allNames)}`);
  }

  return lines;
}

/**
 * Ensures universal agents are always included in the target agents list.
 * Used when -y flag is passed or when auto-selecting agents.
 */
function ensureUniversalAgents(targetAgents: AgentType[]): AgentType[] {
  const universalAgents = getUniversalAgents();
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
  targetAgents: AgentType[]
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
  choices: Array<{ value: AgentType; label: string; hint?: string }>
): Promise<AgentType[] | symbol> {
  // Get last selected agents to pre-select
  let lastSelected: string[] | undefined;
  try {
    lastSelected = await getLastSelectedAgents();
  } catch {
    // Silently ignore errors reading lock file
  }

  const validAgents = choices.map((c) => c.value);

  // Default agents to pre-select when no valid history exists
  const defaultAgents: AgentType[] = ['claude-code', 'opencode', 'codex'];
  const defaultValues = defaultAgents.filter((a) => validAgents.includes(a));

  let initialValues: AgentType[] = [];

  if (lastSelected && lastSelected.length > 0) {
    // Filter stored agents against currently valid agents
    initialValues = lastSelected.filter((a) => validAgents.includes(a as AgentType)) as AgentType[];
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
      await saveSelectedAgents(selected as string[]);
    } catch {
      // Silently ignore errors writing lock file
    }
  }

  return selected as AgentType[] | symbol;
}

/**
 * Interactive agent selection using fuzzy search.
 * Shows universal agents as locked (always selected), and other agents as selectable.
 */
async function selectAgentsInteractive(options: {
  global?: boolean;
}): Promise<AgentType[] | symbol> {
  // Filter out agents that don't support global installation when --global is used
  const supportsGlobalFilter = (a: AgentType) => !options.global || agents[a].globalSkillsDir;

  const universalAgents = getUniversalAgents().filter(supportsGlobalFilter);
  const otherAgents = getNonUniversalAgents().filter(supportsGlobalFilter);

  // Universal agents shown as locked section
  const universalSection = {
    title: 'Universal (.agents/skills)',
    items: universalAgents.map((a) => ({
      value: a,
      label: agents[a].displayName,
    })),
  };

  // Other agents are selectable with their skillsDir as hint
  const otherChoices = otherAgents.map((a) => ({
    value: a,
    label: agents[a].displayName,
    hint: options.global ? agents[a].globalSkillsDir! : agents[a].skillsDir,
  }));

  // Get last selected agents (filter to only non-universal ones for initial selection)
  let lastSelected: string[] | undefined;
  try {
    lastSelected = await getLastSelectedAgents();
  } catch {
    // Silently ignore errors
  }

  const initialSelected = lastSelected
    ? (lastSelected.filter(
        (a) => otherAgents.includes(a as AgentType) && !universalAgents.includes(a as AgentType)
      ) as AgentType[])
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
      await saveSelectedAgents(selected as string[]);
    } catch {
      // Silently ignore errors
    }
  }

  return selected as AgentType[] | symbol;
}

const version = packageJson.version;
setVersion(version);

export interface AddOptions {
  global?: boolean;
  agent?: string[];
  yes?: boolean;
  skill?: string[];
  list?: boolean;
  all?: boolean;
  fullDepth?: boolean;
  copy?: boolean;
}

/**
 * Handle remote skill installation from any supported host provider.
 * This is the generic handler for direct URL skills (Mintlify, HuggingFace, etc.)
 */
async function handleRemoteSkill(
  source: string,
  url: string,
  options: AddOptions,
  spinner: ReturnType<typeof p.spinner>
): Promise<void> {
  // Find a provider that can handle this URL
  const provider = findProvider(url);

  if (!provider) {
    // Fall back to legacy Mintlify handling for backwards compatibility
    await handleDirectUrlSkillLegacy(source, url, options, spinner);
    return;
  }

  spinner.start(`Fetching skill.md from ${provider.displayName}...`);
  const providerSkill = await provider.fetchSkill(url);

  if (!providerSkill) {
    spinner.stop(pc.red('Invalid skill'));
    p.outro(
      pc.red('Could not fetch skill.md or missing required frontmatter (name, description).')
    );
    process.exit(1);
  }

  // Convert to RemoteSkill format with provider info
  const remoteSkill: RemoteSkill = {
    name: providerSkill.name,
    description: providerSkill.description,
    content: providerSkill.content,
    installName: providerSkill.installName,
    sourceUrl: providerSkill.sourceUrl,
    providerId: provider.id,
    sourceIdentifier: provider.getSourceIdentifier(url),
    metadata: providerSkill.metadata,
  };

  spinner.stop(`Found skill: ${pc.cyan(remoteSkill.installName)}`);

  p.log.info(`Skill: ${pc.cyan(remoteSkill.name)}`);
  p.log.message(pc.dim(remoteSkill.description));
  p.log.message(pc.dim(`Source: ${remoteSkill.sourceIdentifier}`));

  if (options.list) {
    console.log();
    p.log.step(pc.bold('Skill Details'));
    p.log.message(`  ${pc.cyan('Name:')} ${remoteSkill.name}`);
    p.log.message(`  ${pc.cyan('Install as:')} ${remoteSkill.installName}`);
    p.log.message(`  ${pc.cyan('Provider:')} ${provider.displayName}`);
    p.log.message(`  ${pc.cyan('Description:')} ${remoteSkill.description}`);
    console.log();
    p.outro('Run without --list to install');
    process.exit(0);
  }

  // Detect agents - universal agents are always included
  let targetAgents: AgentType[];
  const validAgents = Object.keys(agents);
  const universalAgents = getUniversalAgents();

  if (options.agent?.includes('*')) {
    // --agent '*' selects all agents
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
    spinner.start('Loading agents...');
    const installedAgents = await detectInstalledAgents();
    const totalAgents = Object.keys(agents).length;
    spinner.stop(`${totalAgents} agents`);

    if (installedAgents.length === 0) {
      if (options.yes) {
        // With -y and no detected agents, install to universal agents only
        targetAgents = universalAgents;
        p.log.info(`Installing to universal agents`);
      } else {
        // Interactive selection with universal agents locked
        const selected = await selectAgentsInteractive({ global: options.global });

        if (p.isCancel(selected)) {
          p.cancel('Installation cancelled');
          process.exit(0);
        }

        targetAgents = selected as AgentType[];
      }
    } else if (installedAgents.length === 1 || options.yes) {
      // Auto-select detected agents + ensure universal agents are included
      targetAgents = ensureUniversalAgents(installedAgents);
      const { universal, symlinked } = splitAgentsByType(targetAgents);
      if (symlinked.length > 0) {
        p.log.info(
          `Installing to: ${pc.green('universal')} + ${symlinked.map((a) => pc.cyan(a)).join(', ')}`
        );
      } else {
        p.log.info(`Installing to: ${pc.green('universal agents')}`);
      }
    } else {
      const selected = await selectAgentsInteractive({ global: options.global });

      if (p.isCancel(selected)) {
        p.cancel('Installation cancelled');
        process.exit(0);
      }

      targetAgents = selected as AgentType[];
    }
  }

  let installGlobally = options.global ?? false;

  // Check if any selected agents support global installation
  const supportsGlobal = targetAgents.some((a) => agents[a].globalSkillsDir !== undefined);

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

  if (!options.copy && !options.yes) {
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
  }

  const cwd = process.cwd();

  // Check for overwrites (parallel)
  const overwriteChecks = await Promise.all(
    targetAgents.map(async (agent) => ({
      agent,
      installed: await isSkillInstalled(remoteSkill.installName, agent, {
        global: installGlobally,
      }),
    }))
  );
  const overwriteStatus = new Map(
    overwriteChecks.map(({ agent, installed }) => [agent, installed])
  );

  // Build installation summary
  const summaryLines: string[] = [];

  const canonicalPath = getCanonicalPath(remoteSkill.installName, { global: installGlobally });
  const shortCanonical = shortenPath(canonicalPath, cwd);
  summaryLines.push(`${pc.cyan(shortCanonical)}`);
  summaryLines.push(...buildAgentSummaryLines(targetAgents, installMode));

  const overwriteAgents = targetAgents
    .filter((a) => overwriteStatus.get(a))
    .map((a) => agents[a].displayName);

  if (overwriteAgents.length > 0) {
    summaryLines.push(`  ${pc.yellow('overwrites:')} ${formatList(overwriteAgents)}`);
  }

  console.log();
  p.note(summaryLines.join('\n'), 'Installation Summary');

  if (!options.yes) {
    const confirmed = await p.confirm({
      message: 'Proceed with installation?',
    });

    if (p.isCancel(confirmed) || !confirmed) {
      p.cancel('Installation cancelled');
      process.exit(0);
    }
  }

  spinner.start('Installing skill...');

  const results: {
    skill: string;
    agent: string;
    success: boolean;
    path: string;
    canonicalPath?: string;
    mode: InstallMode;
    symlinkFailed?: boolean;
    error?: string;
  }[] = [];

  for (const agent of targetAgents) {
    const result = await installRemoteSkillForAgent(remoteSkill, agent, {
      global: installGlobally,
      mode: installMode,
    });
    results.push({
      skill: remoteSkill.installName,
      agent: agents[agent].displayName,
      ...result,
    });
  }

  spinner.stop('Installation complete');

  console.log();
  const successful = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);

  // Track installation with provider-specific source identifier
  // Skip telemetry for private GitHub repos
  const isPrivate = await isSourcePrivate(remoteSkill.sourceIdentifier);
  if (isPrivate !== true) {
    // Only send telemetry if repo is public (isPrivate === false) or we can't determine (null for non-GitHub sources)
    track({
      event: 'install',
      source: remoteSkill.sourceIdentifier,
      skills: remoteSkill.installName,
      agents: targetAgents.join(','),
      ...(installGlobally && { global: '1' }),
      skillFiles: JSON.stringify({ [remoteSkill.installName]: url }),
      sourceType: remoteSkill.providerId,
    });
  }

  // Add to skill lock file for update tracking (only for global installs)
  if (successful.length > 0 && installGlobally) {
    try {
      // Try to fetch the folder hash from GitHub Trees API
      let skillFolderHash = '';
      if (remoteSkill.providerId === 'github') {
        const hash = await fetchSkillFolderHash(remoteSkill.sourceIdentifier, url);
        if (hash) skillFolderHash = hash;
      }

      await addSkillToLock(remoteSkill.installName, {
        source: remoteSkill.sourceIdentifier,
        sourceType: remoteSkill.providerId,
        sourceUrl: url,
        skillFolderHash,
      });
    } catch {
      // Don't fail installation if lock file update fails
    }
  }

  // Add to local lock file for project-scoped installs
  if (successful.length > 0 && !installGlobally) {
    try {
      const firstResult = successful[0]!;
      const installDir = firstResult.canonicalPath || firstResult.path;
      const computedHash = await computeSkillFolderHash(installDir);
      await addSkillToLocalLock(
        remoteSkill.installName,
        {
          source: remoteSkill.sourceIdentifier,
          sourceType: remoteSkill.providerId,
          computedHash,
        },
        cwd
      );
    } catch {
      // Don't fail installation if lock file update fails
    }
  }

  if (successful.length > 0) {
    const resultLines: string[] = [];
    const firstResult = successful[0]!;

    if (firstResult.mode === 'copy') {
      resultLines.push(`${pc.green('✓')} ${remoteSkill.installName} ${pc.dim('(copied)')}`);
      for (const r of successful) {
        const shortPath = shortenPath(r.path, cwd);
        resultLines.push(`  ${pc.dim('→')} ${shortPath}`);
      }
    } else {
      // Symlink mode
      if (firstResult.canonicalPath) {
        const shortPath = shortenPath(firstResult.canonicalPath, cwd);
        resultLines.push(`${pc.green('✓')} ${shortPath}`);
      } else {
        resultLines.push(`${pc.green('✓')} ${remoteSkill.installName}`);
      }
      resultLines.push(...buildResultLines(successful, targetAgents));
    }

    const title = pc.green('Installed 1 skill');
    p.note(resultLines.join('\n'), title);

    // Show symlink failure warning
    const symlinkFailures = successful.filter((r) => r.mode === 'symlink' && r.symlinkFailed);
    if (symlinkFailures.length > 0) {
      const copiedAgentNames = symlinkFailures.map((r) => r.agent);
      p.log.warn(pc.yellow(`Symlinks failed for: ${formatList(copiedAgentNames)}`));
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
      p.log.message(`  ${pc.red('✗')} ${r.skill} → ${r.agent}: ${pc.dim(r.error)}`);
    }
  }

  console.log();
  p.outro(
    pc.green('Done!') + pc.dim('  Review skills before use; they run with full agent permissions.')
  );

  // Prompt for find-skills after successful install
  await promptForFindSkills(options, targetAgents);
}

/**
 * Handle skills from a well-known endpoint (RFC 8615).
 * Discovers skills from /.well-known/skills/index.json
 */
async function handleWellKnownSkills(
  source: string,
  url: string,
  options: AddOptions,
  spinner: ReturnType<typeof p.spinner>
): Promise<void> {
  spinner.start('Discovering skills from well-known endpoint...');

  // Fetch all skills from the well-known endpoint
  const skills = await wellKnownProvider.fetchAllSkills(url);

  if (skills.length === 0) {
    spinner.stop(pc.red('No skills found'));
    p.outro(
      pc.red(
        'No skills found at this URL. Make sure the server has a /.well-known/skills/index.json file.'
      )
    );
    process.exit(1);
  }

  spinner.stop(`Found ${pc.green(skills.length)} skill${skills.length > 1 ? 's' : ''}`);

  // Log discovered skills
  for (const skill of skills) {
    p.log.info(`Skill: ${pc.cyan(skill.installName)}`);
    p.log.message(pc.dim(skill.description));
    if (skill.files.size > 1) {
      p.log.message(pc.dim(`  Files: ${Array.from(skill.files.keys()).join(', ')}`));
    }
  }

  if (options.list) {
    console.log();
    p.log.step(pc.bold('Available Skills'));
    for (const skill of skills) {
      p.log.message(`  ${pc.cyan(skill.installName)}`);
      p.log.message(`    ${pc.dim(skill.description)}`);
      if (skill.files.size > 1) {
        p.log.message(`    ${pc.dim(`Files: ${skill.files.size}`)}`);
      }
    }
    console.log();
    p.outro('Run without --list to install');
    process.exit(0);
  }

  // Filter skills if --skill option is provided
  let selectedSkills: WellKnownSkill[];

  if (options.skill?.includes('*')) {
    // --skill '*' selects all skills
    selectedSkills = skills;
    p.log.info(`Installing all ${skills.length} skills`);
  } else if (options.skill && options.skill.length > 0) {
    selectedSkills = skills.filter((s) =>
      options.skill!.some(
        (name) =>
          s.installName.toLowerCase() === name.toLowerCase() ||
          s.name.toLowerCase() === name.toLowerCase()
      )
    );

    if (selectedSkills.length === 0) {
      p.log.error(`No matching skills found for: ${options.skill.join(', ')}`);
      p.log.info('Available skills:');
      for (const s of skills) {
        p.log.message(`  - ${s.installName}`);
      }
      process.exit(1);
    }
  } else if (skills.length === 1) {
    selectedSkills = skills;
    const firstSkill = skills[0]!;
    p.log.info(`Skill: ${pc.cyan(firstSkill.installName)}`);
  } else if (options.yes) {
    selectedSkills = skills;
    p.log.info(`Installing all ${skills.length} skills`);
  } else {
    // Prompt user to select skills
    const skillChoices = skills.map((s) => ({
      value: s,
      label: s.installName,
      hint: s.description.length > 60 ? s.description.slice(0, 57) + '...' : s.description,
    }));

    const selected = await multiselect({
      message: 'Select skills to install',
      options: skillChoices,
      required: true,
    });

    if (p.isCancel(selected)) {
      p.cancel('Installation cancelled');
      process.exit(0);
    }

    selectedSkills = selected as WellKnownSkill[];
  }

  // Detect agents
  let targetAgents: AgentType[];
  const validAgents = Object.keys(agents);

  if (options.agent?.includes('*')) {
    // --agent '*' selects all agents
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
    spinner.start('Loading agents...');
    const installedAgents = await detectInstalledAgents();
    const totalAgents = Object.keys(agents).length;
    spinner.stop(`${totalAgents} agents`);

    if (installedAgents.length === 0) {
      if (options.yes) {
        targetAgents = validAgents as AgentType[];
        p.log.info('Installing to all agents');
      } else {
        p.log.info('Select agents to install skills to');

        const allAgentChoices = Object.entries(agents).map(([key, config]) => ({
          value: key as AgentType,
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

        targetAgents = selected as AgentType[];
      }
    } else if (installedAgents.length === 1 || options.yes) {
      // Auto-select detected agents + ensure universal agents are included
      targetAgents = ensureUniversalAgents(installedAgents);
      if (installedAgents.length === 1) {
        const firstAgent = installedAgents[0]!;
        p.log.info(`Installing to: ${pc.cyan(agents[firstAgent].displayName)}`);
      } else {
        p.log.info(
          `Installing to: ${installedAgents.map((a) => pc.cyan(agents[a].displayName)).join(', ')}`
        );
      }
    } else {
      const selected = await selectAgentsInteractive({ global: options.global });

      if (p.isCancel(selected)) {
        p.cancel('Installation cancelled');
        process.exit(0);
      }

      targetAgents = selected as AgentType[];
    }
  }

  let installGlobally = options.global ?? false;

  // Check if any selected agents support global installation
  const supportsGlobal = targetAgents.some((a) => agents[a].globalSkillsDir !== undefined);

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

  if (!options.copy && !options.yes) {
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
  }

  const cwd = process.cwd();

  // Build installation summary
  const summaryLines: string[] = [];
  const agentNames = targetAgents.map((a) => agents[a].displayName);

  // Check if any skill will be overwritten (parallel)
  const overwriteChecks = await Promise.all(
    selectedSkills.flatMap((skill) =>
      targetAgents.map(async (agent) => ({
        skillName: skill.installName,
        agent,
        installed: await isSkillInstalled(skill.installName, agent, { global: installGlobally }),
      }))
    )
  );
  const overwriteStatus = new Map<string, Map<string, boolean>>();
  for (const { skillName, agent, installed } of overwriteChecks) {
    if (!overwriteStatus.has(skillName)) {
      overwriteStatus.set(skillName, new Map());
    }
    overwriteStatus.get(skillName)!.set(agent, installed);
  }

  for (const skill of selectedSkills) {
    if (summaryLines.length > 0) summaryLines.push('');

    const canonicalPath = getCanonicalPath(skill.installName, { global: installGlobally });
    const shortCanonical = shortenPath(canonicalPath, cwd);
    summaryLines.push(`${pc.cyan(shortCanonical)}`);
    summaryLines.push(...buildAgentSummaryLines(targetAgents, installMode));
    if (skill.files.size > 1) {
      summaryLines.push(`  ${pc.dim('files:')} ${skill.files.size}`);
    }

    const skillOverwrites = overwriteStatus.get(skill.installName);
    const overwriteAgents = targetAgents
      .filter((a) => skillOverwrites?.get(a))
      .map((a) => agents[a].displayName);

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

  spinner.start('Installing skills...');

  const results: {
    skill: string;
    agent: string;
    success: boolean;
    path: string;
    canonicalPath?: string;
    mode: InstallMode;
    symlinkFailed?: boolean;
    error?: string;
  }[] = [];

  for (const skill of selectedSkills) {
    for (const agent of targetAgents) {
      const result = await installWellKnownSkillForAgent(skill, agent, {
        global: installGlobally,
        mode: installMode,
      });
      results.push({
        skill: skill.installName,
        agent: agents[agent].displayName,
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

  // Build skillFiles map: { skillName: sourceUrl }
  const skillFiles: Record<string, string> = {};
  for (const skill of selectedSkills) {
    skillFiles[skill.installName] = skill.sourceUrl;
  }

  // Skip telemetry for private GitHub repos
  const isPrivate = await isSourcePrivate(sourceIdentifier);
  if (isPrivate !== true) {
    // Only send telemetry if repo is public (isPrivate === false) or we can't determine (null for non-GitHub sources)
    track({
      event: 'install',
      source: sourceIdentifier,
      skills: selectedSkills.map((s) => s.installName).join(','),
      agents: targetAgents.join(','),
      ...(installGlobally && { global: '1' }),
      skillFiles: JSON.stringify(skillFiles),
      sourceType: 'well-known',
    });
  }

  // Add to skill lock file for update tracking (only for global installs)
  if (successful.length > 0 && installGlobally) {
    const successfulSkillNames = new Set(successful.map((r) => r.skill));
    for (const skill of selectedSkills) {
      if (successfulSkillNames.has(skill.installName)) {
        try {
          await addSkillToLock(skill.installName, {
            source: sourceIdentifier,
            sourceType: 'well-known',
            sourceUrl: skill.sourceUrl,
            skillFolderHash: '', // Well-known skills don't have a folder hash
          });
        } catch {
          // Don't fail installation if lock file update fails
        }
      }
    }
  }

  // Add to local lock file for project-scoped installs
  if (successful.length > 0 && !installGlobally) {
    const successfulSkillNames = new Set(successful.map((r) => r.skill));
    for (const skill of selectedSkills) {
      if (successfulSkillNames.has(skill.installName)) {
        try {
          const matchingResult = successful.find((r) => r.skill === skill.installName);
          const installDir = matchingResult?.canonicalPath || matchingResult?.path;
          if (installDir) {
            const computedHash = await computeSkillFolderHash(installDir);
            await addSkillToLocalLock(
              skill.installName,
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
      const skillResults = bySkill.get(r.skill) || [];
      skillResults.push(r);
      bySkill.set(r.skill, skillResults);
    }

    const skillCount = bySkill.size;
    const symlinkFailures = successful.filter((r) => r.mode === 'symlink' && r.symlinkFailed);
    const copiedAgents = symlinkFailures.map((r) => r.agent);
    const resultLines: string[] = [];

    for (const [skillName, skillResults] of bySkill) {
      const firstResult = skillResults[0]!;

      if (firstResult.mode === 'copy') {
        // Copy mode: show skill name and list all agent paths
        resultLines.push(`${pc.green('✓')} ${skillName} ${pc.dim('(copied)')}`);
        for (const r of skillResults) {
          const shortPath = shortenPath(r.path, cwd);
          resultLines.push(`  ${pc.dim('→')} ${shortPath}`);
        }
      } else {
        // Symlink mode: show canonical path and universal/symlinked agents
        if (firstResult.canonicalPath) {
          const shortPath = shortenPath(firstResult.canonicalPath, cwd);
          resultLines.push(`${pc.green('✓')} ${shortPath}`);
        } else {
          resultLines.push(`${pc.green('✓')} ${skillName}`);
        }
        resultLines.push(...buildResultLines(skillResults, targetAgents));
      }
    }

    const title = pc.green(`Installed ${skillCount} skill${skillCount !== 1 ? 's' : ''}`);
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
      p.log.message(`  ${pc.red('✗')} ${r.skill} → ${r.agent}: ${pc.dim(r.error)}`);
    }
  }

  console.log();
  p.outro(
    pc.green('Done!') + pc.dim('  Review skills before use; they run with full agent permissions.')
  );

  // Prompt for find-skills after successful install
  await promptForFindSkills(options, targetAgents);
}

/**
 * Legacy handler for direct URL skill installation (Mintlify-hosted skills)
 * @deprecated Use handleRemoteSkill with provider system instead
 */
async function handleDirectUrlSkillLegacy(
  source: string,
  url: string,
  options: AddOptions,
  spinner: ReturnType<typeof p.spinner>
): Promise<void> {
  spinner.start('Fetching skill.md...');
  const mintlifySkill = await fetchMintlifySkill(url);

  if (!mintlifySkill) {
    spinner.stop(pc.red('Invalid skill'));
    p.outro(
      pc.red(
        'Could not fetch skill.md or missing required frontmatter (name, description, mintlify-proj).'
      )
    );
    process.exit(1);
  }

  // Convert to RemoteSkill and use the new handler
  const remoteSkill: RemoteSkill = {
    name: mintlifySkill.name,
    description: mintlifySkill.description,
    content: mintlifySkill.content,
    installName: mintlifySkill.mintlifySite,
    sourceUrl: mintlifySkill.sourceUrl,
    providerId: 'mintlify',
    sourceIdentifier: 'mintlify/com',
  };

  spinner.stop(`Found skill: ${pc.cyan(remoteSkill.installName)}`);

  p.log.info(`Skill: ${pc.cyan(remoteSkill.name)}`);
  p.log.message(pc.dim(remoteSkill.description));

  if (options.list) {
    console.log();
    p.log.step(pc.bold('Skill Details'));
    p.log.message(`  ${pc.cyan('Name:')} ${remoteSkill.name}`);
    p.log.message(`  ${pc.cyan('Site:')} ${remoteSkill.installName}`);
    p.log.message(`  ${pc.cyan('Description:')} ${remoteSkill.description}`);
    console.log();
    p.outro('Run without --list to install');
    process.exit(0);
  }

  // Detect agents
  let targetAgents: AgentType[];
  const validAgents = Object.keys(agents);

  if (options.agent?.includes('*')) {
    // --agent '*' selects all agents
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
    spinner.start('Loading agents...');
    const installedAgents = await detectInstalledAgents();
    const totalAgents = Object.keys(agents).length;
    spinner.stop(`${totalAgents} agents`);

    if (installedAgents.length === 0) {
      if (options.yes) {
        targetAgents = validAgents as AgentType[];
        p.log.info('Installing to all agents');
      } else {
        p.log.info('Select agents to install skills to');

        const allAgentChoices = Object.entries(agents).map(([key, config]) => ({
          value: key as AgentType,
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

        targetAgents = selected as AgentType[];
      }
    } else if (installedAgents.length === 1 || options.yes) {
      // Auto-select detected agents + ensure universal agents are included
      targetAgents = ensureUniversalAgents(installedAgents);
      if (installedAgents.length === 1) {
        const firstAgent = installedAgents[0]!;
        p.log.info(`Installing to: ${pc.cyan(agents[firstAgent].displayName)}`);
      } else {
        p.log.info(
          `Installing to: ${installedAgents.map((a) => pc.cyan(agents[a].displayName)).join(', ')}`
        );
      }
    } else {
      const selected = await selectAgentsInteractive({ global: options.global });

      if (p.isCancel(selected)) {
        p.cancel('Installation cancelled');
        process.exit(0);
      }

      targetAgents = selected as AgentType[];
    }
  }

  let installGlobally = options.global ?? false;

  // Check if any selected agents support global installation
  const supportsGlobal = targetAgents.some((a) => agents[a].globalSkillsDir !== undefined);

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

  // Use symlink mode by default for direct URL skills
  const installMode: InstallMode = 'symlink';
  const cwd = process.cwd();

  // Check for overwrites (parallel)
  const overwriteChecks = await Promise.all(
    targetAgents.map(async (agent) => ({
      agent,
      installed: await isSkillInstalled(remoteSkill.installName, agent, {
        global: installGlobally,
      }),
    }))
  );
  const overwriteStatus = new Map(
    overwriteChecks.map(({ agent, installed }) => [agent, installed])
  );

  // Build installation summary
  const summaryLines: string[] = [];
  const agentNames = targetAgents.map((a) => agents[a].displayName);
  const canonicalPath = getCanonicalPath(remoteSkill.installName, { global: installGlobally });
  const shortCanonical = shortenPath(canonicalPath, cwd);
  summaryLines.push(`${pc.cyan(shortCanonical)}`);
  summaryLines.push(...buildAgentSummaryLines(targetAgents, installMode));

  const overwriteAgents = targetAgents
    .filter((a) => overwriteStatus.get(a))
    .map((a) => agents[a].displayName);

  if (overwriteAgents.length > 0) {
    summaryLines.push(`  ${pc.yellow('overwrites:')} ${formatList(overwriteAgents)}`);
  }

  console.log();
  p.note(summaryLines.join('\n'), 'Installation Summary');

  if (!options.yes) {
    const confirmed = await p.confirm({
      message: 'Proceed with installation?',
    });

    if (p.isCancel(confirmed) || !confirmed) {
      p.cancel('Installation cancelled');
      process.exit(0);
    }
  }

  spinner.start('Installing skill...');

  const results: {
    skill: string;
    agent: string;
    success: boolean;
    path: string;
    canonicalPath?: string;
    mode: InstallMode;
    symlinkFailed?: boolean;
    error?: string;
  }[] = [];

  for (const agent of targetAgents) {
    const result = await installRemoteSkillForAgent(remoteSkill, agent, {
      global: installGlobally,
      mode: installMode,
    });
    results.push({
      skill: remoteSkill.installName,
      agent: agents[agent].displayName,
      ...result,
    });
  }

  spinner.stop('Installation complete');

  console.log();
  const successful = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);

  // Track installation
  // Skip telemetry for private GitHub repos (mintlify/com is not a GitHub repo, so always send)
  track({
    event: 'install',
    source: 'mintlify/com',
    skills: remoteSkill.installName,
    agents: targetAgents.join(','),
    ...(installGlobally && { global: '1' }),
    skillFiles: JSON.stringify({ [remoteSkill.installName]: url }),
    sourceType: 'mintlify',
  });

  // Add to skill lock file for update tracking (only for global installs)
  if (successful.length > 0 && installGlobally) {
    try {
      // skillFolderHash will be populated by telemetry server
      // Mintlify skills are single-file, so folder hash = content hash on server
      await addSkillToLock(remoteSkill.installName, {
        source: `mintlify/${remoteSkill.installName}`,
        sourceType: 'mintlify',
        sourceUrl: url,
        skillFolderHash: '', // Populated by server
      });
    } catch {
      // Don't fail installation if lock file update fails
    }
  }

  if (successful.length > 0) {
    const resultLines: string[] = [];
    const firstResult = successful[0]!;

    if (firstResult.canonicalPath) {
      const shortPath = shortenPath(firstResult.canonicalPath, cwd);
      resultLines.push(`${pc.green('✓')} ${shortPath}`);
    } else {
      resultLines.push(`${pc.green('✓')} ${remoteSkill.installName}`);
    }
    resultLines.push(...buildResultLines(successful, targetAgents));

    const title = pc.green('Installed 1 skill');
    p.note(resultLines.join('\n'), title);

    // Show symlink failure warning
    const symlinkFailures = successful.filter((r) => r.mode === 'symlink' && r.symlinkFailed);
    if (symlinkFailures.length > 0) {
      const copiedAgentNames = symlinkFailures.map((r) => r.agent);
      p.log.warn(pc.yellow(`Symlinks failed for: ${formatList(copiedAgentNames)}`));
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
      p.log.message(`  ${pc.red('✗')} ${r.skill} → ${r.agent}: ${pc.dim(r.error)}`);
    }
  }

  console.log();
  p.outro(
    pc.green('Done!') + pc.dim('  Review skills before use; they run with full agent permissions.')
  );

  // Prompt for find-skills after successful install
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
    console.log(`    ${pc.cyan('npx skills add')} ${pc.yellow('<source>')} ${pc.dim('[options]')}`);
    console.log();
    console.log(pc.dim('  Example:'));
    console.log(`    ${pc.cyan('npx skills add')} ${pc.yellow('vercel-labs/agent-skills')}`);
    console.log();
    process.exit(1);
  }

  // --all implies --skill '*' and --agent '*' and -y
  if (options.all) {
    options.skill = ['*'];
    options.agent = ['*'];
    options.yes = true;
  }

  console.log();
  p.intro(pc.bgCyan(pc.black(' skills ')));

  if (!process.stdin.isTTY) {
    showInstallTip();
  }

  let tempDir: string | null = null;

  try {
    const spinner = p.spinner();

    spinner.start('Parsing source...');
    const parsed = parseSource(source);
    spinner.stop(
      `Source: ${parsed.type === 'local' ? parsed.localPath! : parsed.url}${parsed.ref ? ` @ ${pc.yellow(parsed.ref)}` : ''}${parsed.subpath ? ` (${parsed.subpath})` : ''}${parsed.skillFilter ? ` ${pc.dim('@')}${pc.cyan(parsed.skillFilter)}` : ''}`
    );

    // Handle direct URL skills (Mintlify, HuggingFace, etc.) via provider system
    if (parsed.type === 'direct-url') {
      await handleRemoteSkill(source, parsed.url, options, spinner);
      return;
    }

    // Handle well-known skills from arbitrary URLs
    if (parsed.type === 'well-known') {
      await handleWellKnownSkills(source, parsed.url, options, spinner);
      return;
    }

    let skillsDir: string;

    if (parsed.type === 'local') {
      // Use local path directly, no cloning needed
      spinner.start('Validating local path...');
      if (!existsSync(parsed.localPath!)) {
        spinner.stop(pc.red('Path not found'));
        p.outro(pc.red(`Local path does not exist: ${parsed.localPath}`));
        process.exit(1);
      }
      skillsDir = parsed.localPath!;
      spinner.stop('Local path validated');
    } else {
      // Clone repository for remote sources
      spinner.start('Cloning repository...');
      tempDir = await cloneRepo(parsed.url, parsed.ref);
      skillsDir = tempDir;
      spinner.stop('Repository cloned');
    }

    // If skillFilter is present from @skill syntax (e.g., owner/repo@skill-name),
    // merge it into options.skill
    if (parsed.skillFilter) {
      options.skill = options.skill || [];
      if (!options.skill.includes(parsed.skillFilter)) {
        options.skill.push(parsed.skillFilter);
      }
    }

    // Include internal skills when a specific skill is explicitly requested
    // (via --skill or @skill syntax)
    const includeInternal = !!(options.skill && options.skill.length > 0);

    spinner.start('Discovering skills...');
    const skills = await discoverSkills(skillsDir, parsed.subpath, {
      includeInternal,
      fullDepth: options.fullDepth,
    });

    if (skills.length === 0) {
      spinner.stop(pc.red('No skills found'));
      p.outro(
        pc.red('No valid skills found. Skills require a SKILL.md with name and description.')
      );
      await cleanup(tempDir);
      process.exit(1);
    }

    spinner.stop(`Found ${pc.green(skills.length)} skill${skills.length > 1 ? 's' : ''}`);

    if (options.list) {
      console.log();
      p.log.step(pc.bold('Available Skills'));

      // Group available skills by plugin for list output
      const groupedSkills: Record<string, Skill[]> = {};
      const ungroupedSkills: Skill[] = [];

      for (const skill of skills) {
        if (skill.pluginName) {
          const group = skill.pluginName;
          if (!groupedSkills[group]) groupedSkills[group] = [];
          groupedSkills[group].push(skill);
        } else {
          ungroupedSkills.push(skill);
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
        for (const skill of groupedSkills[group]!) {
          p.log.message(`  ${pc.cyan(getSkillDisplayName(skill))}`);
          p.log.message(`    ${pc.dim(skill.description)}`);
        }
        console.log();
      }

      // Print ungrouped
      if (ungroupedSkills.length > 0) {
        if (sortedGroups.length > 0) console.log(pc.bold('General'));
        for (const skill of ungroupedSkills) {
          p.log.message(`  ${pc.cyan(getSkillDisplayName(skill))}`);
          p.log.message(`    ${pc.dim(skill.description)}`);
        }
      }

      console.log();
      p.outro('Use --skill <name> to install specific skills');
      await cleanup(tempDir);
      process.exit(0);
    }

    let selectedSkills: Skill[];

    if (options.skill?.includes('*')) {
      // --skill '*' selects all skills
      selectedSkills = skills;
      p.log.info(`Installing all ${skills.length} skills`);
    } else if (options.skill && options.skill.length > 0) {
      selectedSkills = filterSkills(skills, options.skill);

      if (selectedSkills.length === 0) {
        p.log.error(`No matching skills found for: ${options.skill.join(', ')}`);
        p.log.info('Available skills:');
        for (const s of skills) {
          p.log.message(`  - ${getSkillDisplayName(s)}`);
        }
        await cleanup(tempDir);
        process.exit(1);
      }

      p.log.info(
        `Selected ${selectedSkills.length} skill${selectedSkills.length !== 1 ? 's' : ''}: ${selectedSkills.map((s) => pc.cyan(getSkillDisplayName(s))).join(', ')}`
      );
    } else if (skills.length === 1) {
      selectedSkills = skills;
      const firstSkill = skills[0]!;
      p.log.info(`Skill: ${pc.cyan(getSkillDisplayName(firstSkill))}`);
      p.log.message(pc.dim(firstSkill.description));
    } else if (options.yes) {
      selectedSkills = skills;
      p.log.info(`Installing all ${skills.length} skills`);
    } else {
      // Sort skills by plugin name first, then by skill name
      const sortedSkills = [...skills].sort((a, b) => {
        if (a.pluginName && !b.pluginName) return -1;
        if (!a.pluginName && b.pluginName) return 1;
        if (a.pluginName && b.pluginName && a.pluginName !== b.pluginName) {
          return a.pluginName.localeCompare(b.pluginName);
        }
        return getSkillDisplayName(a).localeCompare(getSkillDisplayName(b));
      });

      // Check if any skills have plugin grouping
      const hasGroups = sortedSkills.some((s) => s.pluginName);

      let selected: Skill[] | symbol;

      if (hasGroups) {
        // Build grouped options for groupMultiselect
        const kebabToTitle = (s: string) =>
          s
            .split('-')
            .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
            .join(' ');

        const grouped: Record<string, p.Option<Skill>[]> = {};
        for (const s of sortedSkills) {
          const groupName = s.pluginName ? kebabToTitle(s.pluginName) : 'Other';
          if (!grouped[groupName]) grouped[groupName] = [];
          grouped[groupName]!.push({
            value: s,
            label: getSkillDisplayName(s),
            hint: s.description.length > 60 ? s.description.slice(0, 57) + '...' : s.description,
          });
        }

        selected = await p.groupMultiselect({
          message: `Select skills to install ${pc.dim('(space to toggle)')}`,
          options: grouped,
          required: true,
        });
      } else {
        const skillChoices = sortedSkills.map((s) => ({
          value: s,
          label: getSkillDisplayName(s),
          hint: s.description.length > 60 ? s.description.slice(0, 57) + '...' : s.description,
        }));

        selected = await multiselect({
          message: 'Select skills to install',
          options: skillChoices,
          required: true,
        });
      }

      if (p.isCancel(selected)) {
        p.cancel('Installation cancelled');
        await cleanup(tempDir);
        process.exit(0);
      }

      selectedSkills = selected as Skill[];
    }

    // Kick off security audit fetch early (non-blocking) so it runs
    // in parallel with agent selection, scope, and mode prompts.
    const ownerRepoForAudit = getOwnerRepo(parsed);
    const auditPromise = ownerRepoForAudit
      ? fetchAuditData(
          ownerRepoForAudit,
          selectedSkills.map((s) => getSkillDisplayName(s))
        )
      : Promise.resolve(null);

    let targetAgents: AgentType[];
    const validAgents = Object.keys(agents);

    if (options.agent?.includes('*')) {
      // --agent '*' selects all agents
      targetAgents = validAgents as AgentType[];
      p.log.info(`Installing to all ${targetAgents.length} agents`);
    } else if (options.agent && options.agent.length > 0) {
      const invalidAgents = options.agent.filter((a) => !validAgents.includes(a));

      if (invalidAgents.length > 0) {
        p.log.error(`Invalid agents: ${invalidAgents.join(', ')}`);
        p.log.info(`Valid agents: ${validAgents.join(', ')}`);
        await cleanup(tempDir);
        process.exit(1);
      }

      targetAgents = options.agent as AgentType[];
    } else {
      spinner.start('Loading agents...');
      const installedAgents = await detectInstalledAgents();
      const totalAgents = Object.keys(agents).length;
      spinner.stop(`${totalAgents} agents`);

      if (installedAgents.length === 0) {
        if (options.yes) {
          targetAgents = validAgents as AgentType[];
          p.log.info('Installing to all agents');
        } else {
          p.log.info('Select agents to install skills to');

          const allAgentChoices = Object.entries(agents).map(([key, config]) => ({
            value: key as AgentType,
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

          targetAgents = selected as AgentType[];
        }
      } else if (installedAgents.length === 1 || options.yes) {
        // Auto-select detected agents + ensure universal agents are included
        targetAgents = ensureUniversalAgents(installedAgents);
        if (installedAgents.length === 1) {
          const firstAgent = installedAgents[0]!;
          p.log.info(`Installing to: ${pc.cyan(agents[firstAgent].displayName)}`);
        } else {
          p.log.info(
            `Installing to: ${installedAgents.map((a) => pc.cyan(agents[a].displayName)).join(', ')}`
          );
        }
      } else {
        const selected = await selectAgentsInteractive({ global: options.global });

        if (p.isCancel(selected)) {
          p.cancel('Installation cancelled');
          await cleanup(tempDir);
          process.exit(0);
        }

        targetAgents = selected as AgentType[];
      }
    }

    let installGlobally = options.global ?? false;

    // Check if any selected agents support global installation
    const supportsGlobal = targetAgents.some((a) => agents[a].globalSkillsDir !== undefined);

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

    if (!options.copy && !options.yes) {
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
    }

    const cwd = process.cwd();

    // Build installation summary
    const summaryLines: string[] = [];
    const agentNames = targetAgents.map((a) => agents[a].displayName);

    // Check if any skill will be overwritten (parallel)
    const overwriteChecks = await Promise.all(
      selectedSkills.flatMap((skill) =>
        targetAgents.map(async (agent) => ({
          skillName: skill.name,
          agent,
          installed: await isSkillInstalled(skill.name, agent, { global: installGlobally }),
        }))
      )
    );
    const overwriteStatus = new Map<string, Map<string, boolean>>();
    for (const { skillName, agent, installed } of overwriteChecks) {
      if (!overwriteStatus.has(skillName)) {
        overwriteStatus.set(skillName, new Map());
      }
      overwriteStatus.get(skillName)!.set(agent, installed);
    }

    // Group selected skills for summary
    const groupedSummary: Record<string, Skill[]> = {};
    const ungroupedSummary: Skill[] = [];

    for (const skill of selectedSkills) {
      if (skill.pluginName) {
        const group = skill.pluginName;
        if (!groupedSummary[group]) groupedSummary[group] = [];
        groupedSummary[group].push(skill);
      } else {
        ungroupedSummary.push(skill);
      }
    }

    // Helper to print summary lines for a list of skills
    const printSkillSummary = (skills: Skill[]) => {
      for (const skill of skills) {
        if (summaryLines.length > 0) summaryLines.push('');

        const canonicalPath = getCanonicalPath(skill.name, { global: installGlobally });
        const shortCanonical = shortenPath(canonicalPath, cwd);
        summaryLines.push(`${pc.cyan(shortCanonical)}`);
        summaryLines.push(...buildAgentSummaryLines(targetAgents, installMode));

        const skillOverwrites = overwriteStatus.get(skill.name);
        const overwriteAgents = targetAgents
          .filter((a) => skillOverwrites?.get(a))
          .map((a) => agents[a].displayName);

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
          selectedSkills.map((s) => ({
            slug: getSkillDisplayName(s),
            displayName: getSkillDisplayName(s),
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

    spinner.start('Installing skills...');

    const results: {
      skill: string;
      agent: string;
      success: boolean;
      path: string;
      canonicalPath?: string;
      mode: InstallMode;
      symlinkFailed?: boolean;
      error?: string;
      pluginName?: string;
    }[] = [];

    for (const skill of selectedSkills) {
      for (const agent of targetAgents) {
        const result = await installSkillForAgent(skill, agent, {
          global: installGlobally,
          mode: installMode,
        });
        results.push({
          skill: getSkillDisplayName(skill),
          agent: agents[agent].displayName,
          pluginName: skill.pluginName,
          ...result,
        });
      }
    }

    spinner.stop('Installation complete');

    console.log();
    const successful = results.filter((r) => r.success);
    const failed = results.filter((r) => !r.success);

    // Track installation result
    // Build skillFiles map: { skillName: relative path to SKILL.md from repo root }
    const skillFiles: Record<string, string> = {};
    for (const skill of selectedSkills) {
      // skill.path is absolute, compute relative from tempDir (repo root)
      let relativePath: string;
      if (tempDir && skill.path === tempDir) {
        // Skill is at root level of repo
        relativePath = 'SKILL.md';
      } else if (tempDir && skill.path.startsWith(tempDir + sep)) {
        // Compute path relative to repo root (tempDir), not search path
        // Use forward slashes for telemetry (URL-style paths)
        relativePath =
          skill.path
            .slice(tempDir.length + 1)
            .split(sep)
            .join('/') + '/SKILL.md';
      } else {
        // Local path - skip telemetry for local installs
        continue;
      }
      skillFiles[skill.name] = relativePath;
    }

    // Normalize source to owner/repo format for telemetry
    const normalizedSource = getOwnerRepo(parsed);

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
            skills: selectedSkills.map((s) => s.name).join(','),
            agents: targetAgents.join(','),
            ...(installGlobally && { global: '1' }),
            skillFiles: JSON.stringify(skillFiles),
          });
        }
      } else {
        // If we can't parse owner/repo, still send telemetry (for non-GitHub sources)
        track({
          event: 'install',
          source: normalizedSource,
          skills: selectedSkills.map((s) => s.name).join(','),
          agents: targetAgents.join(','),
          ...(installGlobally && { global: '1' }),
          skillFiles: JSON.stringify(skillFiles),
        });
      }
    }

    // Add to skill lock file for update tracking (only for global installs)
    if (successful.length > 0 && installGlobally && normalizedSource) {
      const successfulSkillNames = new Set(successful.map((r) => r.skill));
      for (const skill of selectedSkills) {
        const skillDisplayName = getSkillDisplayName(skill);
        if (successfulSkillNames.has(skillDisplayName)) {
          try {
            // Fetch the folder hash from GitHub Trees API
            let skillFolderHash = '';
            const skillPathValue = skillFiles[skill.name];
            if (parsed.type === 'github' && skillPathValue) {
              const hash = await fetchSkillFolderHash(normalizedSource, skillPathValue);
              if (hash) skillFolderHash = hash;
            }

            await addSkillToLock(skill.name, {
              source: normalizedSource,
              sourceType: parsed.type,
              sourceUrl: parsed.url,
              skillPath: skillPathValue,
              skillFolderHash,
              pluginName: skill.pluginName,
            });
          } catch {
            // Don't fail installation if lock file update fails
          }
        }
      }
    }

    // Add to local lock file for project-scoped installs
    if (successful.length > 0 && !installGlobally) {
      const successfulSkillNames = new Set(successful.map((r) => r.skill));
      for (const skill of selectedSkills) {
        const skillDisplayName = getSkillDisplayName(skill);
        if (successfulSkillNames.has(skillDisplayName)) {
          try {
            const computedHash = await computeSkillFolderHash(skill.path);
            await addSkillToLocalLock(
              skill.name,
              {
                source: normalizedSource || parsed.url,
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
        const skillResults = bySkill.get(r.skill) || [];
        skillResults.push(r);
        bySkill.set(r.skill, skillResults);

        // We only need to group once per skill (take the first result for that skill)
        if (skillResults.length === 1) {
          if (r.pluginName) {
            const group = r.pluginName;
            if (!groupedResults[group]) groupedResults[group] = [];
            // We'll store just one entry per skill here to drive the loop
            groupedResults[group].push(r);
          } else {
            ungroupedResults.push(r);
          }
        }
      }

      const skillCount = bySkill.size;
      const symlinkFailures = successful.filter((r) => r.mode === 'symlink' && r.symlinkFailed);
      const copiedAgents = symlinkFailures.map((r) => r.agent);
      const resultLines: string[] = [];

      const printSkillResults = (entries: typeof results) => {
        for (const entry of entries) {
          const skillResults = bySkill.get(entry.skill) || [];
          const firstResult = skillResults[0]!;

          if (firstResult.mode === 'copy') {
            // Copy mode: show skill name and list all agent paths
            resultLines.push(`${pc.green('✓')} ${entry.skill} ${pc.dim('(copied)')}`);
            for (const r of skillResults) {
              const shortPath = shortenPath(r.path, cwd);
              resultLines.push(`  ${pc.dim('→')} ${shortPath}`);
            }
          } else {
            // Symlink mode: show canonical path and universal/symlinked agents
            if (firstResult.canonicalPath) {
              const shortPath = shortenPath(firstResult.canonicalPath, cwd);
              resultLines.push(`${pc.green('✓')} ${shortPath}`);
            } else {
              resultLines.push(`${pc.green('✓')} ${entry.skill}`);
            }
            resultLines.push(...buildResultLines(skillResults, targetAgents));
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

      const title = pc.green(`Installed ${skillCount} skill${skillCount !== 1 ? 's' : ''}`);
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
        p.log.message(`  ${pc.red('✗')} ${r.skill} → ${r.agent}: ${pc.dim(r.error)}`);
      }
    }

    console.log();
    p.outro(
      pc.green('Done!') +
        pc.dim('  Review skills before use; they run with full agent permissions.')
    );

    // Prompt for find-skills after successful install
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
 * Prompt user to install the find-skills skill after their first installation.
 */
async function promptForFindSkills(
  options?: AddOptions,
  targetAgents?: AgentType[]
): Promise<void> {
  // Skip if already dismissed or not in interactive mode
  if (!process.stdin.isTTY) return;
  if (options?.yes) return;

  try {
    const dismissed = await isPromptDismissed('findSkillsPrompt');
    if (dismissed) return;

    // Check if find-skills is already installed
    const findSkillsInstalled = await isSkillInstalled('find-skills', 'claude-code', {
      global: true,
    });
    if (findSkillsInstalled) {
      // Mark as dismissed so we don't check again
      await dismissPrompt('findSkillsPrompt');
      return;
    }

    console.log();
    p.log.message(pc.dim("One-time prompt - you won't be asked again if you dismiss."));
    const install = await p.confirm({
      message: `Install the ${pc.cyan('find-skills')} skill? It helps your agent discover and suggest skills.`,
    });

    if (p.isCancel(install)) {
      await dismissPrompt('findSkillsPrompt');
      return;
    }

    if (install) {
      // Install find-skills to the same agents the user selected, excluding replit
      await dismissPrompt('findSkillsPrompt');

      // Filter out replit from target agents
      const findSkillsAgents = targetAgents?.filter((a) => a !== 'replit');

      // Skip if no valid agents remain after filtering
      if (!findSkillsAgents || findSkillsAgents.length === 0) {
        return;
      }

      console.log();
      p.log.step('Installing find-skills skill...');

      try {
        // Call runAdd directly
        await runAdd(['vercel-labs/skills'], {
          skill: ['find-skills'],
          global: true,
          yes: true,
          agent: findSkillsAgents,
        });
      } catch {
        p.log.warn('Failed to install find-skills. You can try again with:');
        p.log.message(pc.dim('  npx skills add vercel-labs/skills@find-skills -g -y --all'));
      }
    } else {
      // User declined - dismiss the prompt
      await dismissPrompt('findSkillsPrompt');
      p.log.message(
        pc.dim('You can install it later with: npx skills add vercel-labs/skills@find-skills')
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
    } else if (arg === '-s' || arg === '--skill') {
      options.skill = options.skill || [];
      i++;
      let nextArg = args[i];
      while (i < args.length && nextArg && !nextArg.startsWith('-')) {
        options.skill.push(nextArg);
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
