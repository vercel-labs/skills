import * as p from '@clack/prompts';
import pc from 'picocolors';
import { existsSync } from 'fs';
import { homedir } from 'os';
import { sep, join, dirname } from 'path';
import { parseSource, getOwnerRepo, parseOwnerRepo, isRepoPrivate } from './source-parser.ts';
import { stripTerminalEscapes } from './sanitize.ts';
import { searchMultiselect } from './prompts/search-multiselect.ts';
import type { Diagnostic } from 'nostics';
import { diagnostics, formatError, isDiagnostic } from './diagnostics.ts';
import { cloneRepo, cleanupTempDir } from './git.ts';
import { discoverSkills, getSkillDisplayName, filterSkills } from './skills.ts';
import {
  installSkillForAgent,
  installBlobSkillForAgent,
  isSkillInstalled,
  getCanonicalPath,
  installWellKnownSkillForAgent,
  type InstallMode,
} from './installer.ts';
import {
  detectInstalledAgents,
  agents,
  getUniversalAgents,
  getVisibleUniversalAgents,
  getNonUniversalAgents,
  isUniversalAgent,
  getEveSubagents,
} from './agents.ts';
import {
  track,
  setVersion,
  fetchAuditData,
  type AuditResponse,
  type PartnerAudit,
} from './telemetry.ts';
import { detectAgent, getAgentType } from './detect-agent.ts';
import {
  wellKnownProvider,
  computeWellKnownSkillDigest,
  type WellKnownSkill,
} from './providers/index.ts';
import { downloadSource } from './download-source.ts';
import { mapConcurrent } from './concurrency.ts';
import {
  addSkillToLock,
  getGitHubToken,
  isPromptDismissed,
  dismissPrompt,
  getLastSelectedAgents,
  saveSelectedAgents,
} from './skill-lock.ts';
import {
  addSkillToLocalLock,
  readLocalLock,
  computeSkillFolderHash,
  frozenLockfileError,
  lockChangeReason,
  type LocalSkillLockEntry,
  type LocalSkillLockFile,
} from './local-lock.ts';
import type { Skill, AgentType, ParsedSource } from './types.ts';
import {
  tryBlobInstall,
  BLOB_ALLOWED_REPOS,
  getSkillFolderHashFromTree,
  fetchRepoTree,
  type BlobSkill,
  type BlobInstallResult,
} from './blob.ts';
import packageJson from '../package.json' with { type: 'json' };
import {
  isNotionSource,
  parseNotionSkillUrl,
  prepareNotionPackSource,
  prepareNotionSkillSource,
} from './notion-test.ts';

// Helper to check if a value is a cancel symbol (works with both clack and our custom prompts)
const isCancelled = (value: unknown): value is symbol => typeof value === 'symbol';
const EVE_AGENT_LABEL = 'eve agent';

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

export function getLockSource(parsedUrl: string, normalizedSource: string | null): string | null {
  // Preserve SSH URLs in lock files instead of normalizing to owner/repo shorthand.
  // When normalizedSource is used, parseSource() later resolves it to HTTPS,
  // breaking restore for private repos that require SSH authentication.
  const isSSH = parsedUrl.startsWith('git@') || parsedUrl.startsWith('ssh://');
  if (isSSH) {
    return parsedUrl;
  }
  if (parsedUrl.startsWith('http://') || parsedUrl.startsWith('https://')) {
    try {
      if (new URL(parsedUrl).hostname !== 'github.com') {
        return parsedUrl;
      }
    } catch {
      return normalizedSource;
    }
  }
  return normalizedSource;
}

export function getProjectLockSourceUrl(sourceType: string, sourceUrl: string): string | undefined {
  return sourceType === 'git' || sourceType === 'gitlab' ? sourceUrl : undefined;
}
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
  const visible = stripTerminalEscapes(str);
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

function formatSkillPromptSubject(skills: Skill[]): string {
  const names = skills.map((skill) => pc.cyan(getSkillDisplayName(skill)));
  const namedSubject = formatList(names, 3);
  return stripTerminalEscapes(namedSubject).length <= 80
    ? namedSubject
    : `${skills.length} selected skills`;
}

export function formatEveInstallPromptMessage(skills: Skill[]): string {
  return `Detected an eve project. Install ${formatSkillPromptSubject(skills)} for your ${EVE_AGENT_LABEL} to use?`;
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
 * A concrete install destination. For Eve, `subagent` optionally targets a
 * subagent's skills directory (`agent/subagents/<name>/skills`); when omitted
 * the skill installs to the root agent (`agent/skills`). Other agents never set
 * `subagent`.
 */
export interface InstallTarget {
  agent: AgentType;
  subagent?: string;
}

/** Human-readable label for an install target, e.g. "Eve (research)". */
function targetDisplayName(target: InstallTarget): string {
  const base = agents[target.agent].displayName;
  return target.subagent ? `${base} (${target.subagent})` : base;
}

/** Stable key used to deduplicate / index per-target state. */
function targetKey(target: InstallTarget): string {
  return target.subagent ? `${target.agent}:${target.subagent}` : target.agent;
}

/**
 * Expand the selected agents into concrete install targets, fanning Eve out
 * across the chosen subagents (root and/or named subagents).
 */
export function buildInstallTargets(
  targetAgents: AgentType[],
  eveSubagentTargets: Array<string | undefined>
): InstallTarget[] {
  const targets: InstallTarget[] = [];
  for (const agent of targetAgents) {
    if (agent === 'eve') {
      for (const subagent of eveSubagentTargets) {
        targets.push({ agent, subagent });
      }
    } else {
      targets.push({ agent });
    }
  }
  return targets;
}

/**
 * Builds summary lines showing universal vs symlinked agents and Eve subagents.
 */
function buildTargetSummaryLines(targets: InstallTarget[], installMode: InstallMode): string[] {
  const lines: string[] = [];
  const rootAgents = targets.filter((t) => !t.subagent).map((t) => t.agent);
  const subagentNames = targets.filter((t) => t.subagent).map(targetDisplayName);
  const { universal, symlinked } = splitAgentsByType(rootAgents);

  if (installMode === 'symlink') {
    if (universal.length > 0) {
      lines.push(`  ${pc.green('universal:')} ${formatList(universal)}`);
    }
    if (symlinked.length > 0) {
      lines.push(`  ${pc.dim('symlink →')} ${formatList(symlinked)}`);
    }
    if (subagentNames.length > 0) {
      lines.push(`  ${pc.dim('copy →')} ${formatList(subagentNames)}`);
    }
  } else {
    const allNames = targets.map(targetDisplayName);
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
 * The agents `add -y` installs to when none are named: the agent we run
 * inside (plus universal), else Eve alone when present, else every agent when
 * none is detected, else the detected ones plus universal.
 */
export async function nonInteractiveTargetAgents(): Promise<AgentType[]> {
  const detected = await detectAgent();
  const hostAgent = detected.isAgent ? getAgentType(detected.agent.name) : null;
  if (hostAgent) return ensureUniversalAgents([hostAgent]);
  const installed = await detectInstalledAgents();
  if (installed.includes('eve')) return ['eve'];
  if (installed.length === 0) return Object.keys(agents) as AgentType[];
  return ensureUniversalAgents(installed);
}

/**
 * Symlink from a canonical copy only when targets span several skills
 * directories; a single directory, or Eve (which owns each (sub)agent dir),
 * gets a plain copy.
 */
export function defaultInstallMode(targets: InstallTarget[]): InstallMode {
  const allEve = targets.every((t) => t.agent === 'eve');
  const uniqueDirs = new Set(
    targets.map((t) => (t.subagent ? `eve:subagent:${t.subagent}` : agents[t.agent].skillsDir))
  );
  return uniqueDirs.size <= 1 || allEve ? 'copy' : 'symlink';
}

/**
 * Builds result lines from installation results, splitting by universal vs symlinked
 */
function buildResultLines(
  results: Array<{
    agent: string;
    symlinkFailed?: boolean;
    skipped?: boolean;
    skipReason?: string;
  }>,
  targetAgents: AgentType[]
): string[] {
  const lines: string[] = [];

  // Split target agents by type
  const { universal, symlinked: symlinkAgents } = splitAgentsByType(targetAgents);

  // For symlink results, also track which ones actually succeeded vs failed
  // Exclude skipped agents (those whose config dir doesn't exist in the project)
  const successfulSymlinks = results
    .filter((r) => !r.symlinkFailed && !r.skipped && !universal.includes(r.agent))
    .map((r) => r.agent);
  const failedSymlinks = results.filter((r) => r.symlinkFailed && !r.skipped).map((r) => r.agent);
  const skippedSymlinks = results
    .filter(
      (r) =>
        r.skipped &&
        r.skipReason === 'missing-agent-project-directory' &&
        symlinkAgents.includes(r.agent)
    )
    .map((r) => r.agent);

  if (universal.length > 0) {
    lines.push(`  ${pc.green('universal:')} ${formatList(universal)}`);
  }
  if (successfulSymlinks.length > 0) {
    lines.push(`  ${pc.dim('symlinked:')} ${formatList(successfulSymlinks)}`);
  }
  if (failedSymlinks.length > 0) {
    lines.push(`  ${pc.yellow('copied:')} ${formatList(failedSymlinks)}`);
  }
  if (skippedSymlinks.length > 0) {
    lines.push(
      `  ${pc.yellow('skipped:')} ${formatList(skippedSymlinks)} ${pc.dim('(project directory not found)')}`
    );
  }

  return lines;
}

/**
 * Exit after an installation prompt was cancelled before anything was installed.
 *
 * Without a TTY the prompt cannot collect input at all: stdin EOF cancels it
 * immediately. Exiting 0 there reports success to scripts and CI even though
 * nothing was installed, so exit non-zero and point at the non-interactive
 * flags instead. A deliberate interactive cancel still exits 0.
 */
function exitInstallationCancelled(): never {
  p.cancel('Installation cancelled');
  if (!process.stdin.isTTY) {
    console.error(formatError(diagnostics.SKILLS_C007()));
    process.exit(1);
  }
  process.exit(0);
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
  const defaultAgents: AgentType[] = ['claude-code', 'opencode', 'codex', 'grok'];
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
  const visibleUniversalAgents = getVisibleUniversalAgents().filter(supportsGlobalFilter);
  const otherAgents = getNonUniversalAgents().filter(
    (agent) => agent !== 'eve' && supportsGlobalFilter(agent)
  );

  // Universal agents shown as locked section
  const universalSection = {
    title: 'Universal (.agents/skills)',
    items: visibleUniversalAgents.map((a) => ({
      value: a,
      label: agents[a].displayName,
    })),
    hiddenCount: universalAgents.length - visibleUniversalAgents.length,
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
  /** Valid JSON to attach to the install telemetry event. */
  metadata?: string;
  list?: boolean;
  all?: boolean;
  fullDepth?: boolean;
  copy?: boolean;
  /**
   * Eve subagent targets. Each value is a subagent name; `root` (or `.`)
   * selects the root agent. Implies installing for Eve.
   */
  subagent?: string[];
  /** Output results as a JSON array (machine-readable, no ANSI codes). */
  json?: boolean;
}

/** One entry per skill in `add --json` output. */
interface AddJsonResult {
  name?: string;
  status: 'installed' | 'skipped' | 'failed';
  source?: string;
  ref?: string | null;
  hash?: string | null;
  path?: string;
  scope?: 'project' | 'global';
  agents?: string[];
  mode?: InstallMode;
  security?: {
    gen?: string;
    socket?: string;
    snyk?: string;
    details?: string;
  } | null;
  reason?: string;
  error?: string;
}

/** Build the `security` field for a JSON entry from partner audit data. */
function buildJsonSecurity(
  auditData: AuditResponse | null,
  skillName: string,
  source: string | null
): AddJsonResult['security'] {
  const data = auditData?.[skillName];
  if (!data || Object.keys(data).length === 0) return null;
  const socketAlerts = data.socket?.alerts ?? 0;
  return {
    ...(data.ath && { gen: data.ath.risk }),
    ...(data.socket && { socket: `${socketAlerts} alert${socketAlerts !== 1 ? 's' : ''}` }),
    ...(data.snyk && { snyk: data.snyk.risk }),
    ...(source && { details: `https://skills.sh/${source}` }),
  };
}

/**
 * Handle skills from a well-known endpoint (RFC 8615).
 * Discovers skills from /.well-known/agent-skills/index.json (preferred)
 * or /.well-known/skills/index.json (legacy fallback).
 */
function isSkillsShPackUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.replace(/^www\./, '');
    return hostname === 'skills.sh' && /^\/p\/[^/]+/.test(parsed.pathname);
  } catch {
    return false;
  }
}

function logAutoSelectedSkills(entries: Array<{ label: string; description?: string }>): void {
  const only = entries.length === 1 ? entries[0]! : null;
  if (!only) {
    p.log.info(`Installing all ${entries.length} skills`);
    return;
  }
  p.log.info(`Skill: ${pc.cyan(only.label)}`);
  if (only.description) p.log.message(pc.dim(only.description));
}

async function handleWellKnownSkills(
  source: string,
  url: string,
  options: AddOptions,
  spinner: ReturnType<typeof p.spinner>
): Promise<boolean> {
  spinner.start('Discovering skills from well-known endpoint...');

  // Fetch all skills from the well-known endpoint
  let skills: WellKnownSkill[] = [];
  try {
    skills = await wellKnownProvider.fetchAllSkills(url, {
      includeInternal: Boolean(
        options.skill && options.skill.length > 0 && !options.skill.includes('*')
      ),
    });
  } catch (error) {
    if (isDiagnostic(error, 'SKILLS_S009')) {
      spinner.stop(pc.red('No matching skills'));
      p.log.error(formatError(error));
      process.exit(1);
    }
  }

  if (skills.length === 0) {
    spinner.stop(pc.dim('No well-known skills found; trying direct download...'));
    return false;
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
  const logWellKnown = (chosen: WellKnownSkill[]): void =>
    logAutoSelectedSkills(
      chosen.map((s) => ({ label: s.installName, description: s.description }))
    );

  if (options.skill?.includes('*')) {
    // --skill '*' selects all skills
    selectedSkills = skills;
    logWellKnown(selectedSkills);
  } else if (options.skill && options.skill.length > 0) {
    selectedSkills = skills.filter((s) =>
      options.skill!.some(
        (name) =>
          s.installName.toLowerCase() === name.toLowerCase() ||
          s.name.toLowerCase() === name.toLowerCase()
      )
    );

    if (selectedSkills.length === 0) {
      p.log.error(
        formatError(
          diagnostics.SKILLS_S003({
            requested: options.skill,
            available: skills.map((s) => s.installName),
          })
        )
      );
      process.exit(1);
    }
  } else if (skills.length === 1 || options.yes) {
    selectedSkills = skills;
    logWellKnown(selectedSkills);
  } else {
    // Prompt user to select skills
    const skillChoices = skills.map((s) => ({
      value: s,
      label: s.installName,
      hint: s.description.length > 60 ? s.description.slice(0, 57) + '…' : s.description,
    }));

    const selected = await searchMultiselect({
      message: 'Select skills to install',
      items: skillChoices,
      initialSelected: isSkillsShPackUrl(url) ? skills : undefined,
      required: true,
      maxVisible: 20,
      selectAll: true,
    });

    if (isCancelled(selected)) {
      exitInstallationCancelled();
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
      p.log.error(
        formatError(diagnostics.SKILLS_C001({ invalid: invalidAgents, valid: validAgents }))
      );
      process.exit(1);
    }

    targetAgents = options.agent as AgentType[];
  } else {
    spinner.start('Loading agents…');
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

        if (isCancelled(selected)) {
          exitInstallationCancelled();
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

      if (isCancelled(selected)) {
        exitInstallationCancelled();
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
      exitInstallationCancelled();
    }

    installGlobally = scope as boolean;
  }

  // Surface an unusable lock before touching disk rather than after installing.
  if (!installGlobally) await readLocalLock();

  // Determine install mode (symlink vs copy)
  let installMode: InstallMode = options.copy ? 'copy' : 'symlink';

  // Only prompt for install mode when there are multiple unique target directories.
  // When all selected agents share the same skillsDir, symlink vs copy is meaningless.
  const uniqueDirs = new Set(targetAgents.map((a) => agents[a].skillsDir));

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
      exitInstallationCancelled();
    }

    installMode = modeChoice as InstallMode;
  } else if (uniqueDirs.size <= 1) {
    // Single target directory — default to copy (no symlink needed)
    installMode = 'copy';
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
      exitInstallationCancelled();
    }
  }

  // Kick off privacy check early so it runs in parallel with installation
  const sourceIdentifier = wellKnownProvider.getSourceIdentifier(url);
  const wellKnownPrivacyPromise = isSourcePrivate(sourceIdentifier).catch(() => null);

  spinner.start('Installing skills…');

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
  const successfulSkillNames = new Set(successful.map((r) => r.skill));

  // Build skillFiles map: { skillName: sourceUrl }
  const skillFiles: Record<string, string> = {};
  for (const skill of selectedSkills) {
    skillFiles[skill.installName] = skill.sourceUrl;
  }

  // Privacy promise was started before installation — should be resolved by now
  const isPrivate = await wellKnownPrivacyPromise;
  if (isPrivate !== true) {
    track({
      event: 'install',
      source: sourceIdentifier,
      skills: selectedSkills.map((s) => s.installName).join(','),
      agents: targetAgents.join(','),
      ...(installGlobally && { global: '1' }),
      skillFiles: JSON.stringify(skillFiles),
      installUrl: url,
      metadata: options.metadata,
      sourceType: 'well-known',
    });
  }

  // Add to skill lock file for update tracking (only for global installs)
  if (successful.length > 0 && installGlobally) {
    for (const skill of selectedSkills) {
      if (successfulSkillNames.has(skill.installName)) {
        try {
          await addSkillToLock(skill.installName, globalWellKnownLockEntry(url, skill));
        } catch {
          // Don't fail installation if lock file update fails
        }
      }
    }
  }

  // Add to local lock file for project-scoped installs
  if (successful.length > 0 && !installGlobally) {
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
                sourceUrl: url,
                sourceType: 'well-known',
                computedHash,
                wellKnownDigest: computeWellKnownSkillDigest(skill),
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
        const shortPathsSet = new Set<string>();
        for (const r of skillResults) {
          const shortPath = shortenPath(r.path, cwd);
          if (!shortPathsSet.has(shortPath)) {
            shortPathsSet.add(shortPath);
            resultLines.push(`  ${pc.dim('→')} ${shortPath}`);
          }
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
  return true;
}

type Spinner = ReturnType<typeof p.spinner>;

// Clack spinners poll the terminal and write frames/cursor sequences; use this
// when stdout is reserved (--json) or another spinner already owns the line.
const silentSpinner = {
  start: () => {},
  stop: () => {},
  message: () => {},
} as unknown as Spinner;

export interface ResolvedSkills {
  skills: Skill[];
  /** Clone or download root; the caller removes it with cleanup(). */
  tempDir: string | null;
  blobResult: BlobInstallResult | null;
}

/**
 * Fetch `parsed` (blob snapshot, clone, or download) and discover its skills.
 * Throws instead of exiting; removes its own temp dir when it throws.
 */
async function resolveSkills(
  parsed: ParsedSource,
  options: { includeInternal: boolean; fullDepth?: boolean },
  spinner: Spinner
): Promise<ResolvedSkills> {
  const { includeInternal } = options;
  let skills: Skill[];
  let blobResult: BlobInstallResult | null = null;
  let tempDir: string | null = null;

  try {
    if (parsed.type === 'local') {
      spinner.start('Discovering skills…');
      skills = await discoverSkills(parsed.localPath!, parsed.subpath, {
        includeInternal,
        fullDepth: options.fullDepth,
      });
    } else if (parsed.type === 'well-known' || parsed.type === 'download') {
      spinner.start('Downloading source...');
      const downloaded = await downloadSource(parsed.url);
      tempDir = downloaded.tempDir;
      spinner.stop(`Downloaded ${downloaded.kind === 'skill-md' ? 'SKILL.md file' : 'archive'}`);

      spinner.start('Discovering skills...');
      skills = await discoverSkills(downloaded.rootDir, parsed.subpath, {
        includeInternal,
        fullDepth: options.fullDepth,
      });
    } else if (parsed.type === 'github' && !options.fullDepth) {
      // Try the blob-based fast install for GitHub sources; skip for --full-depth.
      // Eligible per repo (a BLOB_ALLOWED_REPOS entry = self-hosted download URL) or
      // per owner (BLOB_ALLOWED_OWNERS = all their repos, skills.sh-hosted).
      let attemptedBlobInstall = false;
      const BLOB_ALLOWED_OWNERS = ['vercel', 'vercel-labs', 'heygen-com', 'remotion-dev'];
      const ownerRepo = getOwnerRepo(parsed);
      const owner = ownerRepo?.split('/')[0]?.toLowerCase();
      const isSelfHostedRepo =
        !!ownerRepo && Object.hasOwn(BLOB_ALLOWED_REPOS, ownerRepo.toLowerCase());
      if (ownerRepo && owner && (isSelfHostedRepo || BLOB_ALLOWED_OWNERS.includes(owner))) {
        attemptedBlobInstall = true;
        spinner.start('Fetching skills…');
        blobResult = await tryBlobInstall(ownerRepo, {
          subpath: parsed.subpath,
          skillFilter: parsed.skillFilter,
          ref: parsed.ref,
          getToken: getGitHubToken,
          includeInternal,
        });
      }

      if (blobResult) {
        skills = blobResult.skills;
        spinner.stop(`Found ${pc.green(skills.length)} skill${skills.length > 1 ? 's' : ''}`);
      } else {
        // Blob failed — fall back to git clone
        if (attemptedBlobInstall) {
          spinner.message('Cloning repository…');
        } else {
          spinner.start('Cloning repository…');
        }
        tempDir = await cloneRepo(parsed.url, parsed.ref);
        spinner.stop('Repository cloned');

        spinner.start('Discovering skills…');
        skills = await discoverSkills(tempDir, parsed.subpath, {
          includeInternal,
          fullDepth: options.fullDepth,
        });
      }
    } else {
      // GitLab, git URL, or --full-depth: always clone
      spinner.start('Cloning repository…');
      tempDir = await cloneRepo(parsed.url, parsed.ref);
      spinner.stop('Repository cloned');

      spinner.start('Discovering skills…');
      skills = await discoverSkills(tempDir, parsed.subpath, {
        includeInternal,
        fullDepth: options.fullDepth,
      });
    }
  } catch (error) {
    await cleanup(tempDir);
    throw error;
  }

  return { skills, tempDir, blobResult };
}

/** A well-known skill shaped as a Skill so it flows through installToTargets and the lock. */
interface WellKnownSourceSkill extends Skill {
  wellKnown: WellKnownSkill;
}

function isWellKnownSourceSkill(skill: Skill): skill is WellKnownSourceSkill {
  return 'wellKnown' in skill;
}

/** Skills published at `url`'s well-known endpoint; null when it publishes none. */
async function resolveWellKnownSkills(
  url: string,
  includeInternal: boolean
): Promise<ResolvedSkills | null> {
  const skills = await wellKnownProvider.fetchAllSkills(url, { includeInternal });
  if (skills.length === 0) return null;
  return {
    skills: skills.map((wellKnown): WellKnownSourceSkill => ({
      name: wellKnown.installName,
      description: wellKnown.description,
      path: '',
      rawContent: wellKnown.content,
      wellKnown,
    })),
    tempDir: null,
    blobResult: null,
  };
}

export type TargetInstallResult = Awaited<ReturnType<typeof installSkillForAgent>> & {
  skill: string;
  agent: string;
  pluginName?: string;
};

/** Where and how skills land on disk. */
export interface InstallPlacement {
  global: boolean;
  targets: InstallTarget[];
  mode: InstallMode;
  createMissingAgentRoot?: (agent: AgentType) => boolean;
}

/** Install every skill into every target. Failures are returned per skill × target. */
export async function installToTargets(
  resolved: ResolvedSkills,
  skills: Skill[],
  placement: InstallPlacement
): Promise<TargetInstallResult[]> {
  const results: TargetInstallResult[] = [];
  for (const skill of skills) {
    for (const target of placement.targets) {
      const { agent, subagent } = target;
      const installOptions = {
        global: placement.global,
        mode: placement.mode,
        eveSubagent: subagent,
        createMissingAgentRoot: placement.createMissingAgentRoot?.(agent) ?? false,
      };
      let result;
      if (isWellKnownSourceSkill(skill)) {
        result = await installWellKnownSkillForAgent(skill.wellKnown, agent, installOptions);
      } else if (resolved.blobResult && 'files' in skill) {
        // Blob-based install: write files from snapshot
        const blobSkill = skill as BlobSkill;
        result = await installBlobSkillForAgent(
          { installName: blobSkill.name, files: blobSkill.files },
          agent,
          installOptions
        );
      } else {
        // Disk-based install: copy from cloned/local directory.
        // Root-level skills (SKILL.md at repo root, so skill.path === tempDir)
        // also take this path and are copied recursively (see installer.ts
        // copyDirectory, which excludes .git), so their scripts/, references/,
        // assets/, etc. are installed too. See issue #1603.
        result = await installSkillForAgent(skill, agent, installOptions);
      }
      results.push({
        skill: getSkillDisplayName(skill),
        agent: targetDisplayName(target),
        pluginName: skill.pluginName,
        ...result,
      });
    }
  }
  return results;
}

/** Repo-relative SKILL.md path per skill name; local skills have none. */
function getSkillRepoPaths(resolved: ResolvedSkills, skills: Skill[]): Record<string, string> {
  const { tempDir, blobResult } = resolved;
  const skillFiles: Record<string, string> = {};
  for (const skill of skills) {
    if (blobResult && 'repoPath' in skill) {
      // Blob-based: repoPath is already the repo-relative path (e.g., "skills/react/SKILL.md")
      skillFiles[skill.name] = (skill as BlobSkill).repoPath;
    } else if (tempDir && skill.path === tempDir) {
      // Skill is at root level of repo
      skillFiles[skill.name] = 'SKILL.md';
    } else if (tempDir && skill.path.startsWith(tempDir + sep)) {
      // Compute path relative to repo root (tempDir), not search path
      // Use forward slashes for telemetry (URL-style paths)
      skillFiles[skill.name] =
        skill.path
          .slice(tempDir.length + 1)
          .split(sep)
          .join('/') + '/SKILL.md';
    }
  }
  return skillFiles;
}

/** The `source` a project lock entry records for `parsed`. */
export function getProjectLockSource(parsed: ParsedSource): string {
  return getLockSource(parsed.url, getOwnerRepo(parsed)) || parsed.url;
}

function projectLockEntry(
  parsed: ParsedSource,
  skillPath: string | undefined,
  computedHash: string
): LocalSkillLockEntry {
  const sourceUrl = getProjectLockSourceUrl(parsed.type, parsed.url);
  return {
    source: getProjectLockSource(parsed),
    ...(sourceUrl && { sourceUrl }),
    ref: parsed.ref,
    sourceType: parsed.type,
    ...(skillPath && { skillPath }),
    computedHash,
  };
}

/** Well-known skills have no source folder, so hash the installed copy like runAdd does. */
function globalWellKnownLockEntry(
  baseUrl: string,
  skill: WellKnownSkill
): Parameters<typeof addSkillToLock>[1] {
  return {
    source: wellKnownProvider.getSourceIdentifier(baseUrl),
    sourceType: 'well-known',
    sourceUrl: skill.sourceUrl,
    skillFolderHash: '',
    sourceBaseUrl: baseUrl,
    wellKnownDigest: computeWellKnownSkillDigest(skill),
  };
}

function wellKnownLockEntry(
  url: string,
  skill: WellKnownSkill,
  computedHash: string
): LocalSkillLockEntry {
  return {
    source: wellKnownProvider.getSourceIdentifier(url),
    sourceUrl: url,
    sourceType: 'well-known',
    computedHash,
    wellKnownDigest: computeWellKnownSkillDigest(skill),
  };
}

interface SourceRequest {
  parsed: ParsedSource;
  /** Skill names to keep; all when empty. */
  skills: string[];
  fullDepth?: boolean;
}

/** A source after its network phase; `resolved` owns a temp dir until it is installed. */
export interface FetchedSource {
  parsed: ParsedSource;
  resolved: ResolvedSkills | null;
  error?: string;
}

interface SourceInstallResult {
  installed: string[];
  failed: string[];
  error?: string;
}

async function fetchSource({ parsed, skills, fullDepth }: SourceRequest): Promise<FetchedSource> {
  const includeInternal = skills.length > 0;
  try {
    // Arbitrary URLs: prefer the well-known endpoint, else a direct download.
    const resolved =
      (parsed.type === 'well-known' &&
        (await resolveWellKnownSkills(parsed.url, includeInternal))) ||
      (await resolveSkills(parsed, { includeInternal, fullDepth }, silentSpinner));
    return { parsed, resolved };
  } catch (error) {
    return {
      parsed,
      resolved: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Download every request at once under a single spinner. Results keep input
 * order; a failed source is reported in its `error` and never throws.
 */
export async function fetchSources(requests: SourceRequest[]): Promise<FetchedSource[]> {
  if (requests.length === 0) return [];
  const label = `source${requests.length === 1 ? '' : 's'}`;
  const spinner = p.spinner();
  let done = 0;
  spinner.start(`Downloading ${requests.length} ${label}…`);
  const fetched = await mapConcurrent(requests, async (request) => {
    const result = await fetchSource(request);
    spinner.message(`Downloaded ${++done} of ${requests.length} ${label}…`);
    return result;
  });
  spinner.stop(`Downloaded ${requests.length} ${label}`);
  return fetched;
}

/** A skill at least one target accepted, hashed as the lock files record it. */
export interface InstalledSkill {
  skill: Skill;
  hash: string;
}

export interface FetchedInstallOutcome {
  installed: InstalledSkill[];
  /** One line per failed skill × target. */
  failed: string[];
  error?: string;
}

/** Remove a fetched source's clone or download, if it has one. */
export function releaseSource({ resolved }: FetchedSource): Promise<void> {
  return cleanup(resolved?.tempDir ?? null);
}

/**
 * Install a fetched source without prompting or exiting: keep `skills` (all
 * when empty), let `select` drop any, and write into `placement`. Writes no
 * lock file and keeps the temp dir, so one fetch can serve several installs;
 * call releaseSource when done.
 */
export async function installFetched(
  { resolved, error }: FetchedSource,
  options: {
    skills: string[];
    placement: InstallPlacement;
    select?: (skills: Skill[]) => Promise<Skill[]>;
  }
): Promise<FetchedInstallOutcome> {
  if (!resolved) return { installed: [], failed: [], error };
  try {
    let selected =
      options.skills.length > 0 ? filterSkills(resolved.skills, options.skills) : resolved.skills;
    if (selected.length === 0) {
      return { installed: [], failed: [], error: 'No matching skills found' };
    }
    if (options.select) selected = await options.select(selected);

    const results = await installToTargets(resolved, selected, options.placement);
    const installed: InstalledSkill[] = [];
    for (const skill of selected) {
      const target = results.find((r) => r.success && r.skill === getSkillDisplayName(skill));
      if (!target) continue;
      installed.push({ skill, hash: await installedSkillHash(skill, target) });
    }
    return {
      installed,
      failed: results.filter((r) => !r.success).map((r) => `${r.skill} → ${r.agent}: ${r.error}`),
    };
  } catch (error) {
    return {
      installed: [],
      failed: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Project placement for restores and syncs: symlinked into `agents`, creating their roots. */
export function projectPlacement(agents: AgentType[]): InstallPlacement {
  return {
    global: false,
    targets: agents.map((agent) => ({ agent })),
    mode: 'symlink',
    createMissingAgentRoot: () => true,
  };
}

/**
 * Install a fetched source at project scope into `agents` and record the
 * project lock (with `via` when given). With `frozenLock`, every skill must
 * match its lock entry instead and the lock is left untouched.
 */
export async function installFromSource(
  fetched: FetchedSource,
  options: {
    skills: string[];
    agents: AgentType[];
    via?: string;
    select?: (skills: Skill[]) => Promise<Skill[]>;
    frozenLock?: LocalSkillLockFile;
  }
): Promise<SourceInstallResult> {
  const { frozenLock } = options;
  const outcome = await installFetched(fetched, {
    skills: options.skills,
    placement: projectPlacement(options.agents),
    select: async (skills) => {
      const selected = options.select ? await options.select(skills) : skills;
      if (!frozenLock) return selected;
      // Refuse changed content before writing it; well-known skills can only be hashed once installed
      const changes: string[] = [];
      for (const skill of selected) {
        if (isWellKnownSourceSkill(skill)) continue;
        const hash = await sourceSkillHash(skill);
        const reason = lockChangeReason(frozenLock, skill.name, { computedHash: hash });
        if (reason) changes.push(reason);
      }
      if (changes.length > 0) throw new Error(frozenLockfileError(changes));
      return selected;
    },
  });
  const result: SourceInstallResult = {
    installed: outcome.installed.map(({ skill }) => getSkillDisplayName(skill)),
    failed: outcome.failed,
    ...(outcome.error && { error: outcome.error }),
  };
  try {
    if (frozenLock) {
      const changes = outcome.installed.flatMap(
        ({ skill, hash }) => lockChangeReason(frozenLock, skill.name, { computedHash: hash }) ?? []
      );
      if (changes.length > 0) result.error = frozenLockfileError(changes);
    } else {
      await recordProjectLock(fetched, outcome.installed, options.via);
    }
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
  } finally {
    await releaseSource(fetched);
  }
  return result;
}

/** Record `installed` in skills-lock.json as skills of `fetched` (with `via` when given). */
export async function recordProjectLock(
  { parsed, resolved }: FetchedSource,
  installed: InstalledSkill[],
  via?: string
): Promise<void> {
  if (!resolved) return;
  const repoPaths = getSkillRepoPaths(
    resolved,
    installed.map(({ skill }) => skill)
  );
  for (const { skill, hash } of installed) {
    const entry = isWellKnownSourceSkill(skill)
      ? wellKnownLockEntry(parsed.url, skill.wellKnown, hash)
      : projectLockEntry(parsed, repoPaths[skill.name], hash);
    await addSkillToLocalLock(skill.name, { ...entry, ...(via && { via }) });
  }
}

/** Record `installed` well-known skills of `baseUrl` in the global lock. */
export async function recordGlobalWellKnownLock(
  baseUrl: string,
  installed: InstalledSkill[]
): Promise<void> {
  for (const { skill } of installed) {
    if (!isWellKnownSourceSkill(skill)) continue;
    await addSkillToLock(skill.name, globalWellKnownLockEntry(baseUrl, skill.wellKnown));
  }
}

/** Content hash of a skill at its source: the blob snapshot, or the folder on disk. */
function sourceSkillHash(skill: Skill): Promise<string> {
  // snapshotHash is only present on BlobSkill
  return 'snapshotHash' in skill
    ? Promise.resolve((skill as BlobSkill).snapshotHash)
    : computeSkillFolderHash(skill.path);
}

/** Well-known skills have no source folder, so hash the installed copy like runAdd does. */
function installedSkillHash(skill: Skill, target: TargetInstallResult): Promise<string> {
  return isWellKnownSourceSkill(skill)
    ? computeSkillFolderHash(target.canonicalPath || target.path)
    : sourceSkillHash(skill);
}

export async function runAdd(args: string[], options: AddOptions = {}): Promise<void> {
  const source = args[0];
  let installTipShown = false;

  // ─── JSON output mode ───
  // Suppress all decorated stdout (clack banners, spinners, notes) and emit a
  // single JSON array on stdout instead. Human error text goes to stderr.
  const jsonMode = options.json === true;
  const jsonResults: AddJsonResult[] = [];
  const originalStdoutWrite = process.stdout.write;
  let stdoutSuppressed = false;
  if (jsonMode) {
    // Keep stdout reserved for the JSON value while preserving human-facing
    // progress and diagnostics on stderr, as promised by the command contract.
    process.stdout.write = process.stderr.write.bind(process.stderr) as typeof process.stdout.write;
    stdoutSuppressed = true;
  }

  const restoreStdout = (): void => {
    if (stdoutSuppressed) {
      process.stdout.write = originalStdoutWrite;
      stdoutSuppressed = false;
    }
  };

  let jsonEmitted = false;
  const emitJson = (): void => {
    if (!jsonMode || jsonEmitted) return;
    jsonEmitted = true;
    restoreStdout();
    console.log(JSON.stringify(jsonResults, null, 2));
  };

  /**
   * Every exit path must emit exactly one JSON array in json mode.
   * In non-json mode this is a plain process.exit(code).
   *
   * The explicit type annotation (not just a return annotation) is what lets
   * TypeScript narrow control flow after calls, like `process.exit` does.
   */
  const emitJsonAndExit: (code: number, errorMessage?: string) => never = (code, errorMessage) => {
    if (jsonMode) {
      if (errorMessage !== undefined) console.error(errorMessage);
      if (code !== 0 && jsonResults.length === 0) {
        jsonResults.push({ status: 'failed', error: errorMessage ?? 'Installation failed' });
      }
      emitJson();
    }
    process.exit(code);
  };

  const emitJsonOnExit = (): void => emitJson();
  if (jsonMode) {
    // Safety net for exit paths outside this function (e.g. nested helpers):
    // guarantee stdout carries one parseable array even then.
    process.once('exit', emitJsonOnExit);
  }

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
    emitJsonAndExit(1, 'Missing required argument: source');
  }

  // Capture command-line intent before agent-context detection populates
  // options.agent with automatic defaults.
  const explicitlySelectedAgents = new Set<AgentType>(
    options.agent?.includes('*') ? [] : ((options.agent as AgentType[] | undefined) ?? [])
  );

  // --all implies --skill '*' and --agent '*' and -y
  if (options.all) {
    options.skill = ['*'];
    options.agent = ['*'];
    options.yes = true;
  }

  // Auto-enable non-interactive mode when running inside an AI agent
  const agentResult = await detectAgent();
  if (agentResult.isAgent) {
    options.yes = true;
    // Auto-select the detected agent + universal agents (unless user explicitly specified agents)
    if (!options.agent || options.agent.length === 0) {
      const mappedAgent = getAgentType(agentResult.agent.name);
      if (mappedAgent) {
        options.agent = ensureUniversalAgents([mappedAgent]);
      }
    }
  }

  // --json is machine-oriented: never prompt. Require an explicit
  // non-interactive mode instead of hanging on (or cancelling) a prompt.
  if (jsonMode && !options.yes) {
    emitJsonAndExit(1, 'The --json flag requires --yes (or --all) to run non-interactively.');
  }

  if (jsonMode && options.list) {
    emitJsonAndExit(1, 'The --json flag cannot be combined with --list.');
  }

  console.log();
  if (!agentResult.isAgent) {
    p.intro(pc.bgCyan(pc.black(' skills ')));
  }

  if (agentResult.isAgent) {
    p.log.info(
      pc.bgCyan(pc.black(pc.bold(` ${agentResult.agent.name} `))) +
        ' ' +
        'Agent detected — installing non-interactively'
    );
  } else if (!process.stdin.isTTY) {
    showInstallTip();
  }

  let tempDir: string | null = null;

  try {
    let effectiveSource = source;
    let notionSourceLabel: string | null = null;
    const notionSkillPageId = parseNotionSkillUrl(source);
    if (isNotionSource(source) || notionSkillPageId) {
      const prepared = notionSkillPageId
        ? await prepareNotionSkillSource(notionSkillPageId)
        : await prepareNotionPackSource(options);
      if (!prepared) return;

      effectiveSource = prepared.rootDir;
      tempDir = prepared.tempDir;
      notionSourceLabel =
        'packCount' in prepared
          ? `${prepared.packCount} selected Notion pack${prepared.packCount === 1 ? '' : 's'}`
          : 'Notion page';
      // The pack selection or page URL already chose the skills to install.
      options.skill = ['*'];
    }

    const spinner = jsonMode ? silentSpinner : p.spinner();

    spinner.start('Parsing source…');
    const parsed = parseSource(effectiveSource);
    let directDownload = parsed.type === 'download' || notionSourceLabel !== null;
    spinner.stop(
      notionSourceLabel !== null
        ? `Source: ${notionSourceLabel}`
        : `Source: ${parsed.type === 'local' ? parsed.localPath! : parsed.url}${parsed.ref ? ` @ ${pc.yellow(parsed.ref)}` : ''}${parsed.subpath ? ` (${parsed.subpath})` : ''}${parsed.skillFilter ? ` ${pc.dim('@')}${pc.cyan(parsed.skillFilter)}` : ''}`
    );

    // Kick off the repo privacy check early so it runs in parallel with
    // cloning/discovering/installing. The result is only needed later for
    // telemetry gating — it should never block user-visible output.
    const ownerRepoRaw =
      parsed.type === 'well-known' || parsed.type === 'download' ? null : getOwnerRepo(parsed);
    const repoPrivacyPromise: Promise<boolean | null> = (() => {
      // The privacy endpoint below is GitHub.com-specific. In particular, do
      // not send GitHub Enterprise repository names to the public API.
      if (parsed.type !== 'github') return Promise.resolve(null);
      if (!ownerRepoRaw) return Promise.resolve(null);
      const ownerRepo = parseOwnerRepo(ownerRepoRaw);
      if (!ownerRepo) return Promise.resolve(null);
      return isRepoPrivate(ownerRepo.owner, ownerRepo.repo).catch(() => null);
    })();

    // Handle arbitrary URLs by trying well-known discovery first, then
    // falling back to a direct SKILL.md/archive download.
    if (parsed.type === 'well-known') {
      if (jsonMode) {
        // The well-known flow has its own prompts and exit paths that do not
        // feed the JSON accumulator yet.
        emitJsonAndExit(1, '--json is not yet supported for well-known skill sources.');
      }
      const handled = await handleWellKnownSkills(source, parsed.url, options, spinner);
      if (handled) return;
      directDownload = true;
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
    // (via --skill or @skill syntax). The '*' wildcard is a bulk request, not
    // an explicit one, so internal skills stay hidden from it unless
    // INSTALL_INTERNAL_SKILLS is set.
    const includeInternal = !!(
      options.skill &&
      options.skill.length > 0 &&
      !options.skill.includes('*')
    );

    if (parsed.type === 'local') {
      spinner.start('Validating local path…');
      if (!existsSync(parsed.localPath!)) {
        spinner.stop(pc.red('Path not found'));
        const error = diagnostics.SKILLS_S008({ path: parsed.localPath! });
        p.outro(pc.red(formatError(error)));
        emitJsonAndExit(1, error.message);
      }
      spinner.stop('Local path validated');
    }

    const resolved = await resolveSkills(
      parsed,
      { includeInternal, fullDepth: options.fullDepth },
      spinner
    );
    const { skills, blobResult } = resolved;
    // a Notion source already owns tempDir; a local resolve has none of its own
    tempDir = resolved.tempDir ?? tempDir;

    if (skills.length === 0) {
      spinner.stop(pc.red('No skills found'));
      const error = diagnostics.SKILLS_S004();
      p.outro(pc.red(formatError(error)));
      await cleanup(tempDir);
      emitJsonAndExit(1, error.message);
    }

    if (!blobResult) {
      spinner.stop(`Found ${pc.green(skills.length)} skill${skills.length > 1 ? 's' : ''}`);
    }

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
      emitJsonAndExit(0);
    }

    let selectedSkills: Skill[];
    const logChosen = (chosen: Skill[]): void =>
      logAutoSelectedSkills(
        chosen.map((s) => ({ label: getSkillDisplayName(s), description: s.description }))
      );

    if (options.skill?.includes('*')) {
      // --skill '*' selects all skills
      selectedSkills = skills;
      logChosen(selectedSkills);
    } else if (options.skill && options.skill.length > 0) {
      selectedSkills = filterSkills(skills, options.skill);

      // Requested names that matched nothing are reported as skipped entries.
      if (jsonMode) {
        for (const requested of options.skill) {
          if (filterSkills(skills, [requested]).length === 0) {
            jsonResults.push({
              name: requested,
              status: 'skipped',
              reason: 'No matching skill found in source',
            });
          }
        }
      }

      if (selectedSkills.length === 0) {
        const error = diagnostics.SKILLS_S003({
          requested: options.skill,
          available: skills.map(getSkillDisplayName),
        });
        p.log.error(formatError(error));
        await cleanup(tempDir);
        emitJsonAndExit(1, error.message);
      }

      p.log.info(
        `Selected ${selectedSkills.length} skill${selectedSkills.length !== 1 ? 's' : ''}: ${selectedSkills.map((s) => pc.cyan(getSkillDisplayName(s))).join(', ')}`
      );
    } else if (skills.length === 1 || options.yes) {
      selectedSkills = skills;
      logChosen(selectedSkills);
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

      const kebabToTitle = (s: string) =>
        s
          .split('-')
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
          .join(' ');

      const skillChoices = sortedSkills.map((s) => ({
        value: s,
        label: getSkillDisplayName(s),
        group: hasGroups ? (s.pluginName ? kebabToTitle(s.pluginName) : 'Other') : undefined,
        detail: s.description,
      }));

      const selected = await searchMultiselect({
        message: hasGroups
          ? `Select skills to install ${pc.dim('(space to toggle)')}`
          : 'Select skills to install',
        items: skillChoices,
        required: true,
        maxVisible: 20,
        searchable: !hasGroups,
        showDetail: true,
        showSelectedSummary: false,
        selectGroups: hasGroups,
        selectAll: true,
      });

      if (isCancelled(selected)) {
        await cleanup(tempDir);
        exitInstallationCancelled();
      }

      selectedSkills = selected as Skill[];
    }

    // Kick off the security audit only after GitHub has positively confirmed
    // that this is a public repository. Private and unknown repositories must
    // not send their names or skill names to the audit service.
    const ownerRepoForAudit = getOwnerRepo(parsed);
    const auditPromise = ownerRepoForAudit
      ? repoPrivacyPromise.then((isPrivate) =>
          isPrivate === false
            ? fetchAuditData(
                ownerRepoForAudit,
                selectedSkills.map((s) => getSkillDisplayName(s))
              )
            : null
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
        const error = diagnostics.SKILLS_C001({ invalid: invalidAgents, valid: validAgents });
        p.log.error(formatError(error));
        await cleanup(tempDir);
        emitJsonAndExit(1, error.message);
      }

      targetAgents = options.agent as AgentType[];
    } else {
      spinner.start('Loading agents…');
      const installedAgents = await detectInstalledAgents();
      const totalAgents = Object.keys(agents).length;
      spinner.stop(`${totalAgents} agents`);

      if (installedAgents.includes('eve') && (options.yes || !agentResult.isAgent)) {
        const useEve = options.yes
          ? true
          : await p.confirm({
              message: formatEveInstallPromptMessage(selectedSkills),
              initialValue: true,
            });

        if (p.isCancel(useEve)) {
          await cleanup(tempDir);
          exitInstallationCancelled();
        }

        if (useEve) {
          targetAgents = ['eve'];
          if (!options.yes) explicitlySelectedAgents.add('eve');
          p.log.info(`Installing to: ${pc.cyan(EVE_AGENT_LABEL)}`);
        } else {
          const selected = await selectAgentsInteractive({ global: options.global });

          if (isCancelled(selected)) {
            await cleanup(tempDir);
            exitInstallationCancelled();
          }

          targetAgents = selected as AgentType[];
          for (const agent of targetAgents) explicitlySelectedAgents.add(agent);
        }
      } else if (installedAgents.length === 0) {
        if (options.yes) {
          targetAgents = validAgents as AgentType[];
          p.log.info('Installing to all agents');
        } else {
          p.log.info('Select agents to install skills to');

          const allAgentChoices = Object.entries(agents)
            .filter(([key]) => key !== 'eve')
            .map(([key, config]) => ({
              value: key as AgentType,
              label: config.displayName,
            }));

          // Use helper to prompt with search
          const selected = await promptForAgents(
            'Which agents do you want to install to?',
            allAgentChoices
          );

          if (isCancelled(selected)) {
            await cleanup(tempDir);
            exitInstallationCancelled();
          }

          targetAgents = selected as AgentType[];
          for (const agent of targetAgents) explicitlySelectedAgents.add(agent);
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

        if (isCancelled(selected)) {
          await cleanup(tempDir);
          exitInstallationCancelled();
        }

        targetAgents = selected as AgentType[];
        for (const agent of targetAgents) explicitlySelectedAgents.add(agent);
      }
    }

    // An explicit --subagent flag implies the user wants to target Eve.
    if (options.subagent && options.subagent.length > 0) {
      explicitlySelectedAgents.add('eve');
      if (!targetAgents.includes('eve')) targetAgents = [...targetAgents, 'eve'];
    }

    // Eve supports subagents, each with their own skills directory at
    // agent/subagents/<name>/skills in addition to the root agent/skills.
    // When Eve is a target, choose which of those to install into.
    let eveSubagentTargets: Array<string | undefined> = [undefined];
    if (targetAgents.includes('eve')) {
      const availableSubagents = getEveSubagents(process.cwd());

      if (options.subagent && options.subagent.length > 0) {
        // Non-interactive: 'root' or '.' selects the root agent.
        eveSubagentTargets = options.subagent.map((s) =>
          s === 'root' || s === '.' ? undefined : s
        );
      } else if (availableSubagents.length > 0 && !options.yes) {
        const subagentChoices = [
          { value: '', label: 'Root agent', hint: 'agent/skills' },
          ...availableSubagents.map((name) => ({
            value: name,
            label: name,
            hint: `agent/subagents/${name}/skills`,
          })),
        ];

        const selectedSubagents = await p.multiselect({
          message: 'Where should Eve skills be installed?',
          options: subagentChoices,
          initialValues: [''],
          required: true,
        });

        if (p.isCancel(selectedSubagents)) {
          await cleanup(tempDir);
          exitInstallationCancelled();
        }

        eveSubagentTargets = (selectedSubagents as string[]).map((s) => (s === '' ? undefined : s));
      }
    }

    const installTargets = buildInstallTargets(targetAgents, eveSubagentTargets);

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
        await cleanup(tempDir);
        exitInstallationCancelled();
      }

      installGlobally = scope as boolean;
    }

    // Surface an unusable lock before touching disk rather than after installing.
    if (!installGlobally) await readLocalLock();

    // Only prompt for install mode when a symlink would actually mean something.
    let installMode: InstallMode = options.copy ? 'copy' : defaultInstallMode(installTargets);

    if (!options.copy && !options.yes && installMode === 'symlink') {
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
        await cleanup(tempDir);
        exitInstallationCancelled();
      }

      installMode = modeChoice as InstallMode;
    }

    const cwd = process.cwd();

    // Build installation summary
    const summaryLines: string[] = [];

    // Check if any skill will be overwritten (parallel)
    const overwriteChecks = await Promise.all(
      selectedSkills.flatMap((skill) =>
        installTargets.map(async (target) => ({
          skillName: skill.name,
          target,
          installed: await isSkillInstalled(skill.name, target.agent, {
            global: installGlobally,
            eveSubagent: target.subagent,
          }),
        }))
      )
    );
    // Keyed by skill name → target key → installed?
    const overwriteStatus = new Map<string, Map<string, boolean>>();
    for (const { skillName, target, installed } of overwriteChecks) {
      if (!overwriteStatus.has(skillName)) {
        overwriteStatus.set(skillName, new Map());
      }
      overwriteStatus.get(skillName)!.set(targetKey(target), installed);
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

        const canonicalPath =
          installTargets.length === 1
            ? getCanonicalPath(skill.name, {
                global: installGlobally,
                agent: installTargets[0]!.agent,
                eveSubagent: installTargets[0]!.subagent,
              })
            : getCanonicalPath(skill.name, { global: installGlobally });
        const shortCanonical = shortenPath(canonicalPath, cwd);
        summaryLines.push(`${pc.cyan(shortCanonical)}`);
        summaryLines.push(...buildTargetSummaryLines(installTargets, installMode));

        const skillOverwrites = overwriteStatus.get(skill.name);
        const overwriteAgents = installTargets
          .filter((t) => skillOverwrites?.get(targetKey(t)))
          .map(targetDisplayName);

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
    let auditDataForJson: AuditResponse | null = null;
    try {
      const auditData = await auditPromise;
      auditDataForJson = auditData;
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
        await cleanup(tempDir);
        exitInstallationCancelled();
      }
    }

    spinner.start('Installing skills…');

    const results = await installToTargets(resolved, selectedSkills, {
      global: installGlobally,
      targets: installTargets,
      mode: installMode,
      createMissingAgentRoot: (agent) => explicitlySelectedAgents.has(agent),
    });

    spinner.stop('Installation complete');

    console.log();
    const successful = results.filter((r) => r.success);
    const failed = results.filter((r) => !r.success);
    const successfulSkillNames = new Set(successful.map((r) => r.skill));
    // Track installation result
    // Build skillFiles map: { skillName: relative path to SKILL.md from repo root }
    const skillFiles = getSkillRepoPaths(resolved, selectedSkills);

    // Normalize source to owner/repo format for telemetry
    const normalizedSource = directDownload ? null : getOwnerRepo(parsed);

    const lockSource = directDownload ? null : getLockSource(parsed.url, normalizedSource);

    // Only track if we have a valid remote source and it's not a private repo.
    // repoPrivacyPromise was started early (right after parsing) so it has
    // already been running in parallel with the entire install — no stall here.
    if (normalizedSource) {
      const ownerRepo = parseOwnerRepo(normalizedSource);
      if (ownerRepo) {
        const isPrivate = await repoPrivacyPromise;
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
            metadata: options.metadata,
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
          metadata: options.metadata,
        });
      }
    }

    // Content hash per installed skill (blob snapshot or folder hash), for the
    // project lock below and --json. The global lock derives its own from the
    // repo tree, so skip the walk when neither consumer needs it.
    const installedSkillHashes = new Map<string, string>();
    if (successful.length > 0 && (jsonMode || !installGlobally)) {
      for (const skill of selectedSkills) {
        const skillDisplayName = getSkillDisplayName(skill);
        if (!successfulSkillNames.has(skillDisplayName)) continue;
        try {
          installedSkillHashes.set(skillDisplayName, await sourceSkillHash(skill));
        } catch {
          // Hash is informational; lock writing skips skills without one.
        }
      }
    }

    // Add to skill lock file for update tracking (only for global installs)
    // Notion installs are downloaded to a temp dir that parses as `local` and is deleted in the
    // finally block below, so only a real local path is recorded (same guard as the project lock).
    if (
      successful.length > 0 &&
      installGlobally &&
      (normalizedSource || (parsed.type === 'local' && !directDownload))
    ) {
      // For GitHub clone installs, fetch the repo tree once and reuse it
      // for all skills — avoids N sequential API calls that take ~400ms each.
      let cachedTree: Awaited<ReturnType<typeof fetchRepoTree>> | undefined;
      if (parsed.type === 'github' && !blobResult && normalizedSource) {
        cachedTree = await fetchRepoTree(normalizedSource, parsed.ref, getGitHubToken);
      }

      for (const skill of selectedSkills) {
        const skillDisplayName = getSkillDisplayName(skill);
        if (successfulSkillNames.has(skillDisplayName)) {
          try {
            let skillFolderHash = '';
            const skillPathValue = skillFiles[skill.name];

            if (blobResult && skillPathValue) {
              const hash = getSkillFolderHashFromTree(blobResult.tree, skillPathValue);
              if (hash) skillFolderHash = hash;
            } else if (parsed.type === 'github' && skillPathValue && cachedTree) {
              const hash = getSkillFolderHashFromTree(cachedTree, skillPathValue);
              if (hash) skillFolderHash = hash;
            } else if (skillPathValue && tempDir) {
              const skillDir = join(tempDir, dirname(skillPathValue));
              const hash = await computeSkillFolderHash(skillDir);
              if (hash) skillFolderHash = hash;
            } else if (parsed.type === 'local') {
              // Local sources aren't cloned into tempDir, so hash the skill's
              // own directory directly (same approach as the project-scope lock below).
              const hash = await computeSkillFolderHash(skill.path);
              if (hash) skillFolderHash = hash;
            }

            await addSkillToLock(skill.name, {
              source: lockSource || normalizedSource || parsed.url,
              sourceType: parsed.type,
              sourceUrl: parsed.url,
              ref: parsed.ref,
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
    if (successful.length > 0 && !installGlobally && !directDownload) {
      // Record Eve subagent placement (root = '') so `update` can restore it.
      // Only meaningful when Eve is among the targets and a non-root subagent
      // was selected; otherwise omit for a clean, minimal lock entry.
      const eveSubagents = targetAgents.includes('eve')
        ? eveSubagentTargets.map((s) => s ?? '')
        : undefined;
      const recordSubagents =
        eveSubagents && (eveSubagents.length > 1 || eveSubagents.some((s) => s !== ''));
      for (const skill of selectedSkills) {
        const skillDisplayName = getSkillDisplayName(skill);
        if (successfulSkillNames.has(skillDisplayName)) {
          try {
            // Reuse the hash computed above (blob snapshot or folder hash)
            const computedHash = installedSkillHashes.get(skillDisplayName);
            if (computedHash === undefined) continue;
            const skillPathValue = skillFiles[skill.name];
            await addSkillToLocalLock(
              skill.name,
              {
                ...projectLockEntry(parsed, skillPathValue, computedHash),
                ...(recordSubagents && { subagents: eveSubagents }),
              },
              cwd
            );
          } catch {
            // Don't fail installation if lock file update fails
          }
        }
      }
    }

    // JSON output: one entry per skill, collapsing per-skill×agent results.
    // A skill is failed if any target failed, otherwise installed.
    if (jsonMode) {
      const jsonSource =
        normalizedSource ?? (parsed.type === 'local' ? parsed.localPath! : parsed.url);
      for (const skill of selectedSkills) {
        const name = getSkillDisplayName(skill);
        const skillResults = results.filter((r) => r.skill === name);
        const failures = skillResults.filter((r) => !r.success);
        if (failures.length > 0) {
          jsonResults.push({
            name,
            status: 'failed',
            error: failures[0]!.error ?? 'Installation failed',
          });
          continue;
        }
        jsonResults.push({
          name,
          status: 'installed',
          source: jsonSource,
          ref: parsed.ref ?? null,
          hash: installedSkillHashes.get(name) ?? null,
          path: skillResults[0]?.canonicalPath ?? skillResults[0]?.path,
          scope: installGlobally ? 'global' : 'project',
          agents: skillResults.filter((r) => !r.skipped).map((r) => r.agent),
          mode: skillResults[0]?.mode ?? installMode,
          security: buildJsonSecurity(auditDataForJson, name, ownerRepoForAudit),
        });
      }
      emitJson();
      if (failed.length > 0 || jsonResults.some((result) => result.status === 'skipped')) {
        process.exitCode = 1;
      }
      return; // the finally block handles tempDir cleanup
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
            const shortPathsSet = new Set<string>();
            for (const r of skillResults) {
              const shortPath = shortenPath(r.path, cwd);
              if (!shortPathsSet.has(shortPath)) {
                shortPathsSet.add(shortPath);
                resultLines.push(`  ${pc.dim('→')} ${shortPath}`);
              }
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
    const isCloneError = isDiagnostic(
      error,
      'SKILLS_G001',
      'SKILLS_G002',
      'SKILLS_G003',
      'SKILLS_G004',
      'SKILLS_G005'
    );
    if (isCloneError) {
      p.log.error(pc.red('Failed to clone repository'));
      // Print each line of the error message separately for better formatting
      for (const line of formatError(error).split('\n')) {
        p.log.message(pc.dim(line));
      }
    } else {
      p.log.error(error instanceof Error ? formatError(error) : 'Unknown error occurred');
    }
    showInstallTip();
    p.outro(pc.red('Installation failed'));
    const errorMessage = isCloneError
      ? `Failed to clone repository\n${error.message}`
      : error instanceof Error
        ? error.message
        : 'Unknown error occurred';
    emitJsonAndExit(1, errorMessage);
  } finally {
    if (jsonMode) process.removeListener('exit', emitJsonOnExit);
    restoreStdout();
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
      p.log.step('Installing find-skills skill…');

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
export function parseAddOptions(args: string[]): {
  source: string[];
  options: AddOptions;
  errors: Diagnostic[];
} {
  const options: AddOptions = {};
  const source: string[] = [];
  const errors: Diagnostic[] = [];

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
    } else if (arg === '--metadata') {
      const metadata = args[++i];
      if (metadata === undefined) {
        errors.push(diagnostics.SKILLS_C002({ option: '--metadata', value: 'a JSON value' }));
      } else {
        try {
          JSON.parse(metadata);
          options.metadata = metadata;
        } catch {
          errors.push(diagnostics.SKILLS_C004({ option: '--metadata', expected: 'valid JSON' }));
        }
      }
    } else if (arg === '--full-depth') {
      options.fullDepth = true;
    } else if (arg === '--json') {
      options.json = true;
    } else if (arg === '--copy') {
      options.copy = true;
    } else if (arg === '--subagent') {
      options.subagent = options.subagent || [];
      i++;
      let nextArg = args[i];
      while (i < args.length && nextArg && !nextArg.startsWith('-')) {
        options.subagent.push(nextArg);
        i++;
        nextArg = args[i];
      }
      i--; // Back up one since the loop will increment
    } else if (arg && !arg.startsWith('-')) {
      source.push(arg);
    }
  }

  return { source, options, errors };
}
