import * as p from '@clack/prompts';
import pc from 'picocolors';
import { agents, detectInstalledAgents } from './agents.ts';
import {
  installSkillForAgent,
  listInstalledSkills,
  type InstalledSkill,
  type InstallMode,
} from './installer.ts';
import { searchMultiselect } from './prompts/search-multiselect.ts';
import { track } from './telemetry.ts';
import type { AgentType, Skill } from './types.ts';

export interface LinkOptions {
  agent?: string[];
  yes?: boolean;
  skill?: string[];
  all?: boolean;
  global?: boolean;
}

const isCancelled = (value: unknown): value is symbol => typeof value === 'symbol';

export function parseLinkOptions(args: string[]): { skills: string[]; options: LinkOptions } {
  const options: LinkOptions = {};
  const skills: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) {
      continue;
    }

    if (arg === '-y' || arg === '--yes') {
      options.yes = true;
    } else if (arg === '--all') {
      options.all = true;
    } else if (arg === '-g' || arg === '--global') {
      options.global = true;
    } else if (arg === '-a' || arg === '--agent') {
      options.agent = options.agent || [];
      while (i + 1 < args.length && !args[i + 1]!.startsWith('-')) {
        options.agent.push(args[++i]!);
      }
    } else if (arg === '-s' || arg === '--skill') {
      options.skill = options.skill || [];
      while (i + 1 < args.length && !args[i + 1]!.startsWith('-')) {
        const skill = args[++i]!;
        options.skill.push(skill);
        skills.push(skill);
      }
    } else if (!arg.startsWith('-')) {
      skills.push(arg);
    }
  }

  return { skills, options };
}

async function promptForSkills(
  installedSkills: InstalledSkill[]
): Promise<InstalledSkill[] | symbol> {
  const selectedNames = await searchMultiselect({
    message: 'Which global skills do you want to link?',
    items: installedSkills.map((skill) => ({
      value: skill.name,
      label: skill.name,
      hint:
        skill.agents.length > 0 ? `linked to ${skill.agents.length} agent(s)` : 'not linked yet',
    })),
    required: true,
  });

  if (isCancelled(selectedNames)) {
    return selectedNames;
  }

  const selectedSet = new Set(selectedNames);
  return installedSkills.filter((skill) => selectedSet.has(skill.name));
}

async function promptForAgents(): Promise<AgentType[] | symbol> {
  const installedAgents = await detectInstalledAgents();
  const selectableAgents = (Object.keys(agents) as AgentType[])
    .filter((agentType) => agents[agentType].globalSkillsDir !== undefined)
    .sort((a, b) => agents[a].displayName.localeCompare(agents[b].displayName));

  const initialSelected = installedAgents.filter(
    (agentType) => agents[agentType].globalSkillsDir !== undefined
  );

  const selected = await searchMultiselect({
    message: 'Which agents do you want to link skills to?',
    items: selectableAgents.map((agentType) => ({
      value: agentType,
      label: agents[agentType].displayName,
      hint: agents[agentType].globalSkillsDir,
    })),
    initialSelected,
    required: true,
  });

  if (isCancelled(selected)) {
    return selected;
  }

  return selected as AgentType[];
}

function toSourceSkill(installedSkill: InstalledSkill): Skill {
  return {
    name: installedSkill.name,
    description: installedSkill.description,
    path: installedSkill.path,
  };
}

export async function runLink(inputSkills: string[], options: LinkOptions = {}): Promise<void> {
  const cwd = process.cwd();
  const spinner = p.spinner();

  spinner.start('Scanning installed global skills...');
  const installedSkills = await listInstalledSkills({ global: true, cwd });
  spinner.stop(`Found ${installedSkills.length} global skill(s)`);

  if (installedSkills.length === 0) {
    p.outro(pc.yellow('No global skills found to link.'));
    return;
  }

  if (options.agent && options.agent.length > 0) {
    const validAgents = (Object.keys(agents) as AgentType[]).filter(
      (agentType) => agents[agentType].globalSkillsDir !== undefined
    );
    const invalidAgents = options.agent.filter(
      (agent) => !validAgents.includes(agent as AgentType)
    );

    if (invalidAgents.length > 0) {
      p.log.error(`Invalid agents: ${invalidAgents.join(', ')}`);
      p.log.info(`Valid agents: ${validAgents.join(', ')}`);
      process.exit(1);
    }
  }

  let selectedSkills: InstalledSkill[];
  let missingSkillNames: string[] = [];
  if (options.all) {
    selectedSkills = installedSkills;
  } else if (inputSkills.length > 0) {
    const requested = new Set(inputSkills.map((skill) => skill.toLowerCase()));
    selectedSkills = installedSkills.filter((skill) => requested.has(skill.name.toLowerCase()));
    const matchedNames = new Set(selectedSkills.map((skill) => skill.name.toLowerCase()));
    missingSkillNames = inputSkills.filter((skill) => !matchedNames.has(skill.toLowerCase()));

    if (selectedSkills.length === 0) {
      p.log.error(`No matching global skills found for: ${inputSkills.join(', ')}`);
      return;
    }

    if (missingSkillNames.length > 0) {
      p.log.warn(`Global skills not found: ${missingSkillNames.join(', ')}`);
    }
  } else if (options.yes) {
    selectedSkills = installedSkills;
  } else {
    const selected = await promptForSkills(installedSkills);
    if (isCancelled(selected)) {
      p.cancel('Link cancelled');
      process.exit(0);
    }
    selectedSkills = selected;
  }

  let targetAgents: AgentType[];
  if (options.agent && options.agent.length > 0) {
    targetAgents = options.agent as AgentType[];
  } else if (options.yes) {
    const detectedAgents = await detectInstalledAgents();
    const globalCapableDetected = detectedAgents.filter(
      (agentType) => agents[agentType].globalSkillsDir !== undefined
    );
    targetAgents =
      globalCapableDetected.length > 0
        ? globalCapableDetected
        : (Object.keys(agents) as AgentType[]).filter(
            (agentType) => agents[agentType].globalSkillsDir !== undefined
          );
  } else {
    const selected = await promptForAgents();
    if (isCancelled(selected)) {
      p.cancel('Link cancelled');
      process.exit(0);
    }
    targetAgents = selected;
  }

  if (!options.yes) {
    console.log();
    p.log.info('Global skills to link:');
    for (const skill of selectedSkills) {
      p.log.message(`  ${pc.cyan('•')} ${skill.name}`);
    }
    console.log();
    p.log.info(
      `Target agents: ${targetAgents.map((agent) => agents[agent].displayName).join(', ')}`
    );

    const confirmed = await p.confirm({
      message: `Proceed with linking ${selectedSkills.length} skill(s)?`,
    });

    if (p.isCancel(confirmed) || !confirmed) {
      p.cancel('Link cancelled');
      process.exit(0);
    }
  }

  spinner.start('Linking global skills...');

  const results: Array<{
    skill: string;
    agent: string;
    success: boolean;
    path: string;
    mode: InstallMode;
    error?: string;
  }> = [];

  for (const installedSkill of selectedSkills) {
    const sourceSkill = toSourceSkill(installedSkill);
    for (const agentType of targetAgents) {
      const result = await installSkillForAgent(sourceSkill, agentType, {
        global: true,
        cwd,
        mode: 'symlink',
      });
      results.push({
        skill: installedSkill.name,
        agent: agents[agentType].displayName,
        success: result.success,
        path: result.path,
        mode: result.mode,
        error: result.error,
      });
    }
  }

  spinner.stop('Linking complete');

  const failed = results.filter((result) => !result.success);
  const successfulLinkCount = results.filter((result) => result.success).length;
  const succeededSkillNames = new Set(
    results.filter((result) => result.success).map((result) => result.skill)
  );

  console.log();
  const successfulLinks = results.filter((result) => result.success);
  for (const success of successfulLinks) {
    p.log.message(`  ${pc.green('✓')} ${success.skill} → ${success.agent}`);
  }

  if (failed.length > 0) {
    for (const failure of failed) {
      p.log.error(`${failure.skill} → ${failure.agent}: ${failure.error ?? 'Unknown error'}`);
    }
  }

  if (succeededSkillNames.size > 0) {
    p.outro(
      pc.green(
        `Successfully linked ${successfulLinkCount} link(s) for ${succeededSkillNames.size} skill(s).`
      )
    );
  } else {
    p.outro(pc.red('Failed to link any skills.'));
  }

  track({
    event: 'link',
    scope: 'global',
    skillCount: String(selectedSkills.length),
    agents: targetAgents.join(','),
    successCount: String(succeededSkillNames.size),
    failCount: String(failed.length),
  });
}
