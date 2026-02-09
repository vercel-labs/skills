import pc from 'picocolors';
import { logger } from '../utils/logger.ts';
import type { AgentType, CognitiveType } from '../core/types.ts';
import { COGNITIVE_FILE_NAMES } from '../core/types.ts';
import { agents } from '../services/registry/index.ts';
import { listInstalledCognitives, type InstalledCognitive } from '../services/installer/index.ts';
import { shortenPath, formatList } from '../ui/formatters.ts';
import { validateAgentNames } from './shared.ts';

interface ListOptions {
  global?: boolean;
  agent?: string[];
  type?: CognitiveType;
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
      if (typeVal && (Object.keys(COGNITIVE_FILE_NAMES) as string[]).includes(typeVal)) {
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
    agentFilter = validateAgentNames(options.agent);
  }

  const installedCognitives = await listInstalledCognitives({
    global: scope,
    agentFilter,
  });

  // Filter by cognitive type if --type is specified
  const filteredCognitives = options.type
    ? installedCognitives.filter((s) => (s.cognitiveType || 'skill') === options.type)
    : installedCognitives;

  const cwd = process.cwd();
  const scopeLabel = scope ? 'Global' : 'Project';
  const typeLabel = options.type ? ` ${options.type}s` : '';

  if (filteredCognitives.length === 0) {
    logger.dim(`No ${scopeLabel.toLowerCase()}${typeLabel} found.`);
    if (scope) {
      logger.dim('Try listing project cognitives without -g');
    } else {
      logger.dim('Try listing global cognitives with -g');
    }
    return;
  }

  function getTypeLabel(skill: InstalledCognitive): string {
    const ct = skill.cognitiveType || 'skill';
    if (ct === 'agent') return ` ${pc.dim('[AGENT]')}`;
    if (ct === 'prompt') return ` ${pc.dim('[PROMPT]')}`;
    return '';
  }

  function printSkill(skill: InstalledCognitive): void {
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
  for (const skill of filteredCognitives) {
    printSkill(skill);
  }
  logger.line();
}
