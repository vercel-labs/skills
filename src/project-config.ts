import { readFile, writeFile, access } from 'fs/promises';
import { join } from 'path';
import { constants } from 'fs';
import type { AgentType } from './types.ts';
import { PROJECT_CONFIG_FILE } from './constants.ts';

export interface ProjectSkillEntry {
  source: string;
  sourceUrl: string;
}

export interface ProjectConfigFile {
  agents?: AgentType[];
  skills: Record<string, ProjectSkillEntry>;
}

export function getProjectConfigPath(cwd: string = process.cwd()): string {
  return join(cwd, PROJECT_CONFIG_FILE);
}

export async function projectConfigExists(cwd: string = process.cwd()): Promise<boolean> {
  const configPath = getProjectConfigPath(cwd);
  try {
    await access(configPath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function parseYaml(content: string): ProjectConfigFile {
  const lines = content.split('\n');
  const result: ProjectConfigFile = { skills: {} };
  let currentSection: 'agents' | 'skills' | null = null;
  let currentSkillName: string | null = null;
  let currentSkill: Partial<ProjectSkillEntry> | null = null;

  for (const line of lines) {
    const trimmed = line.trimEnd();
    const currentIndent = line.search(/\S/);

    if (trimmed.startsWith('#') || trimmed === '') {
      continue;
    }

    if (trimmed.endsWith(':') && !trimmed.includes(': ')) {
      const key = trimmed.slice(0, -1).trim();

      if (key === 'agents') {
        currentSection = 'agents';
        result.agents = [];
        currentSkillName = null;
        currentSkill = null;
      } else if (key === 'skills') {
        currentSection = 'skills';
        result.skills = {};
        currentSkillName = null;
        currentSkill = null;
      } else if (currentSection === 'skills' && currentIndent === 2) {
        if (currentSkill && currentSkillName && currentSkill.source && currentSkill.sourceUrl) {
          result.skills[currentSkillName] = currentSkill as ProjectSkillEntry;
        }
        currentSkillName = key;
        currentSkill = {};
      }
    } else if (trimmed.includes(': ')) {
      const colonIndex = trimmed.indexOf(': ');
      const key = trimmed.slice(0, colonIndex).trim();
      const value = trimmed.slice(colonIndex + 2).trim();

      if (currentSection === 'skills' && currentSkillName) {
        if (!currentSkill) currentSkill = {};
        if (key === 'source') {
          currentSkill.source = value;
        } else if (key === 'sourceUrl') {
          currentSkill.sourceUrl = value;
        }
      }
    } else if (currentSection === 'agents' && currentIndent === 2) {
      const trimmedContent = trimmed.trim();
      if (trimmedContent.startsWith('- ')) {
        const agentName = trimmedContent.slice(2).trim();
        if (result.agents && !result.agents.includes(agentName as AgentType)) {
          result.agents.push(agentName as AgentType);
        }
      }
    }
  }

  if (currentSkill && currentSkillName && currentSkill.source && currentSkill.sourceUrl) {
    result.skills[currentSkillName] = currentSkill as ProjectSkillEntry;
  }

  return result;
}

function stringifyYaml(config: ProjectConfigFile): string {
  const lines: string[] = [];

  if (config.agents && config.agents.length > 0) {
    lines.push('agents:');
    for (const agent of config.agents) {
      lines.push(`  - ${agent}`);
    }
    lines.push('');
  }

  if (Object.keys(config.skills).length > 0) {
    lines.push('skills:');
    for (const [name, entry] of Object.entries(config.skills)) {
      lines.push(`  ${name}:`);
      lines.push(`    source: ${entry.source}`);
      lines.push(`    sourceUrl: ${entry.sourceUrl}`);
    }
  }

  return lines.join('\n');
}

export async function readProjectConfig(cwd: string = process.cwd()): Promise<ProjectConfigFile> {
  const configPath = getProjectConfigPath(cwd);

  try {
    const content = await readFile(configPath, 'utf-8');
    return parseYaml(content);
  } catch {
    return { skills: {} };
  }
}

export async function writeProjectConfig(
  config: ProjectConfigFile,
  cwd: string = process.cwd()
): Promise<void> {
  const configPath = getProjectConfigPath(cwd);
  const content = stringifyYaml(config);
  await writeFile(configPath, content, 'utf-8');
}

export async function addSkillToProjectConfig(
  skillName: string,
  entry: ProjectSkillEntry,
  cwd: string = process.cwd()
): Promise<void> {
  const config = await readProjectConfig(cwd);
  config.skills[skillName] = entry;
  await writeProjectConfig(config, cwd);
}

export async function removeSkillFromProjectConfig(
  skillName: string,
  cwd: string = process.cwd()
): Promise<boolean> {
  const config = await readProjectConfig(cwd);

  if (!(skillName in config.skills)) {
    return false;
  }

  delete config.skills[skillName];
  await writeProjectConfig(config, cwd);
  return true;
}

export async function getSkillFromProjectConfig(
  skillName: string,
  cwd: string = process.cwd()
): Promise<ProjectSkillEntry | null> {
  const config = await readProjectConfig(cwd);
  return config.skills[skillName] ?? null;
}

export async function getAllProjectSkills(
  cwd: string = process.cwd()
): Promise<Record<string, ProjectSkillEntry>> {
  const config = await readProjectConfig(cwd);
  return config.skills;
}

export async function getProjectAgents(
  cwd: string = process.cwd()
): Promise<AgentType[] | undefined> {
  const config = await readProjectConfig(cwd);
  return config.agents;
}

export async function setProjectAgents(
  agents: AgentType[],
  cwd: string = process.cwd()
): Promise<void> {
  const config = await readProjectConfig(cwd);
  config.agents = agents;
  await writeProjectConfig(config, cwd);
}
