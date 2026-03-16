import * as p from '@clack/prompts';
import pc from 'picocolors';
import { readdir } from 'fs/promises';
import { platform } from 'os';
import { agents, detectInstalledAgents } from './agents.ts';
import { getCanonicalSkillsDir, materializeCanonicalSkillForAgent } from './installer.ts';
import type { AgentType } from './types.ts';

export interface LinkOptions {
  agent?: string[];
  copy?: boolean;
}

function dedupe<T>(items: T[]): T[] {
  return [...new Set(items)];
}

export function parseLinkOptions(args: string[]): { agents: string[]; options: LinkOptions } {
  const positionalAgents: string[] = [];
  const options: LinkOptions = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg) {
      continue;
    }

    if (arg === '-a' || arg === '--agent') {
      options.agent = options.agent || [];
      i++;
      let nextArg = args[i];
      while (i < args.length && nextArg && !nextArg.startsWith('-')) {
        options.agent.push(nextArg);
        i++;
        nextArg = args[i];
      }
      i--;
    } else if (arg === '--copy') {
      options.copy = true;
    } else if (!arg.startsWith('-')) {
      positionalAgents.push(arg);
    }
  }

  return { agents: positionalAgents, options };
}

export async function runLink(
  positionalAgents: string[],
  options: LinkOptions = {}
): Promise<void> {
  const cwd = process.cwd();
  const spinner = p.spinner();
  const canonicalDir = getCanonicalSkillsDir(false, cwd);
  const validAgents = Object.keys(agents);
  const requestedAgents = dedupe([...positionalAgents, ...(options.agent ?? [])]);

  spinner.start('Scanning canonical skills...');
  const entries = await readdir(canonicalDir, { withFileTypes: true }).catch(() => []);
  const skillNames = entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => entry.name)
    .sort();

  if (skillNames.length === 0) {
    spinner.stop(pc.yellow('No canonical skills found'));
    p.outro(
      pc.dim(`No skills found in ${pc.cyan('.agents/skills/')}. Install or restore skills first.`)
    );
    return;
  }

  let targetAgents: AgentType[];
  if (requestedAgents.includes('*')) {
    targetAgents = validAgents as AgentType[];
  } else if (requestedAgents.length > 0) {
    const invalidAgents = requestedAgents.filter((agent) => !validAgents.includes(agent));
    if (invalidAgents.length > 0) {
      spinner.stop(pc.red('Invalid agent selection'));
      p.log.error(`Invalid agents: ${invalidAgents.join(', ')}`);
      p.log.info(`Valid agents: ${validAgents.join(', ')}`);
      process.exit(1);
    }
    targetAgents = requestedAgents as AgentType[];
  } else {
    const detectedAgents = await detectInstalledAgents();
    if (detectedAgents.length === 0) {
      spinner.stop(pc.yellow('No agents detected'));
      p.log.error('No installed agents detected. Pass an agent name explicitly.');
      p.log.info(`Valid agents: ${validAgents.join(', ')}`);
      process.exit(1);
    }
    targetAgents = detectedAgents;
  }

  const installMode = options.copy || platform() === 'win32' ? 'copy' : 'symlink';

  spinner.stop(
    `Found ${pc.green(String(skillNames.length))} skill${skillNames.length !== 1 ? 's' : ''}`
  );

  p.note(
    [
      `${pc.dim('source:')} ${pc.cyan('.agents/skills/')}`,
      `${pc.dim('agents:')} ${targetAgents.map((agent) => agents[agent].displayName).join(', ')}`,
      `${pc.dim('mode:')} ${installMode === 'copy' ? 'copy' : 'symlink with copy fallback'}`,
    ].join('\n'),
    'Link Summary'
  );

  spinner.start('Linking skills...');

  const results: Array<{
    success: boolean;
    skill: string;
    agent: AgentType;
    symlinkFailed?: boolean;
    error?: string;
  }> = [];

  for (const skillName of skillNames) {
    for (const agent of targetAgents) {
      const result = await materializeCanonicalSkillForAgent(skillName, agent, {
        cwd,
        mode: installMode,
      });

      results.push({
        success: result.success,
        skill: skillName,
        agent,
        symlinkFailed: result.symlinkFailed,
        error: result.error,
      });
    }
  }

  const successful = results.filter((result) => result.success);
  const failed = results.filter((result) => !result.success);
  const copyFallbacks = successful.filter((result) => result.symlinkFailed);

  spinner.stop(
    `Processed ${pc.green(String(successful.length))}/${String(results.length)} link target${results.length !== 1 ? 's' : ''}`
  );

  if (copyFallbacks.length > 0) {
    p.log.warn(
      `${copyFallbacks.length} target${copyFallbacks.length !== 1 ? 's' : ''} fell back to copy mode`
    );
  }

  if (failed.length > 0) {
    for (const result of failed.slice(0, 10)) {
      p.log.error(
        `${result.skill} → ${agents[result.agent].displayName}: ${result.error ?? 'Unknown error'}`
      );
    }
    if (failed.length > 10) {
      p.log.info(`${failed.length - 10} additional link failures omitted`);
    }
    p.outro(pc.red('Link completed with errors.'));
    process.exit(1);
  }

  p.outro(
    `Linked ${pc.green(String(skillNames.length))} skill${skillNames.length !== 1 ? 's' : ''} for ${pc.green(String(targetAgents.length))} agent${targetAgents.length !== 1 ? 's' : ''}.`
  );
}
