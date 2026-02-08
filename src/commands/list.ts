import { homedir } from 'os';
import pc from 'picocolors';
import { logger } from '../utils/logger.ts';
import type { AgentType, CognitiveType } from '../core/types.ts';
import { agents } from '../services/registry/index.ts';
import { listInstalledSkills, type InstalledSkill } from '../services/installer/index.ts';

interface ListOptions {
  global?: boolean;
  agent?: string[];
  type?: CognitiveType;
}

/**
 * Shortens a path for display: replaces homedir with ~ and cwd with .
 */
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

export function parseListOptions(args: string[]): ListOptions {
  const options: ListOptions = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '-g' || arg === '--global') {
      options.global = true;
    } else if (arg === '-a' || arg === '--agent') {
      options.agent = options.agent || [];
      // Collect all following arguments until next flag
      while (i + 1 < args.length && !args[i + 1]!.startsWith('-')) {
        options.agent.push(args[++i]!);
      }
    } else if (arg === '-t' || arg === '--type') {
      i++;
      const typeVal = args[i];
      if (typeVal === 'skill' || typeVal === 'agent' || typeVal === 'prompt') {
        options.type = typeVal as CognitiveType;
      }
    }
  }

  return options;
}

export async function runList(args: string[]): Promise<void> {
  const options = parseListOptions(args);

  // Default to project only (local), use -g for global
  const scope = options.global === true ? true : false;

  // Validate agent filter if provided
  let agentFilter: AgentType[] | undefined;
  if (options.agent && options.agent.length > 0) {
    const validAgents = Object.keys(agents);
    const invalidAgents = options.agent.filter((a) => !validAgents.includes(a));

    if (invalidAgents.length > 0) {
      logger.warning(`Invalid agents: ${invalidAgents.join(', ')}`);
      logger.dim(`Valid agents: ${validAgents.join(', ')}`);
      process.exit(1);
    }

    agentFilter = options.agent as AgentType[];
  }

  const installedSkills = await listInstalledSkills({
    global: scope,
    agentFilter,
  });

  // Filter by cognitive type if --type is specified
  const filteredSkills = options.type
    ? installedSkills.filter((s) => (s.cognitiveType || 'skill') === options.type)
    : installedSkills;

  const cwd = process.cwd();
  const scopeLabel = scope ? 'Global' : 'Project';
  const typeLabel = options.type ? ` ${options.type}s` : '';

  if (filteredSkills.length === 0) {
    logger.dim(`No ${scopeLabel.toLowerCase()}${typeLabel} found.`);
    if (scope) {
      logger.dim('Try listing project cognitives without -g');
    } else {
      logger.dim('Try listing global cognitives with -g');
    }
    return;
  }

  function getTypeLabel(skill: InstalledSkill): string {
    const ct = skill.cognitiveType || 'skill';
    if (ct === 'agent') return ` ${pc.dim('[AGENT]')}`;
    if (ct === 'prompt') return ` ${pc.dim('[PROMPT]')}`;
    return '';
  }

  function printSkill(skill: InstalledSkill): void {
    const shortPath = shortenPath(skill.canonicalPath, cwd);
    const agentNames = skill.agents.map((a) => agents[a].displayName);
    const agentInfo = skill.agents.length > 0 ? formatList(agentNames) : pc.yellow('not linked');
    logger.log(`${pc.cyan(skill.name)}${getTypeLabel(skill)} ${pc.dim(shortPath)}`);
    logger.log(`  ${pc.dim('Agents:')} ${agentInfo}`);
  }

  logger.bold(
    `${scopeLabel}${typeLabel ? typeLabel.charAt(0).toUpperCase() + typeLabel.slice(1) : ' Cognitives'}`
  );
  logger.line();
  for (const skill of filteredSkills) {
    printSkill(skill);
  }
  logger.line();
}
