import { homedir } from 'os';
import { sep } from 'path';
import pc from 'picocolors';
import type { AgentType } from '../core/types.ts';
import { agents, isUniversalAgent, getUniversalAgents } from '../services/registry/index.ts';
import type { InstallMode } from '../services/installer/index.ts';

/**
 * Shortens a path for display: replaces homedir with ~ and cwd with .
 * Handles both Unix and Windows path separators.
 */
export function shortenPath(fullPath: string, cwd: string): string {
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
export function formatList(items: string[], maxShow: number = 5): string {
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
export function splitAgentsByType(agentTypes: AgentType[]): {
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
export function buildAgentSummaryLines(
  targetAgents: AgentType[],
  installMode: InstallMode
): string[] {
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
export function ensureUniversalAgents(targetAgents: AgentType[]): AgentType[] {
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
export function buildResultLines(
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
