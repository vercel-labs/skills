import { agents } from '../agents.ts';
import type { AgentType } from '../types.ts';
import type { CuiInstalledSkill, SkillLayer } from './types.ts';

const LAYERS: SkillLayer[] = ['project', 'global'];

export function formatAgentNames(agentIds: AgentType[]): string {
  if (agentIds.length === 0) return 'not linked';
  return agentIds.map((agent) => agents[agent]?.displayName ?? agent).join(', ');
}

function formatOptional(label: string, value: string | undefined): string {
  return `${label}: ${value && value.trim() ? value : 'not specified'}`;
}

function formatHash(skill: CuiInstalledSkill): string | undefined {
  if (!skill.hash) return undefined;
  return `${skill.hashKind ?? 'hash'} ${skill.hash}`;
}

export function formatSkillDetails(skill: CuiInstalledSkill): string[] {
  const source = skill.sourceUrl ?? skill.source;
  const versionParts = [skill.ref ? `ref ${skill.ref}` : undefined, formatHash(skill)].filter(
    Boolean
  );
  const metadataLines = [
    `Name: ${skill.name}`,
    formatOptional('Description', skill.description),
    formatOptional('Triggers', skill.triggers?.length ? skill.triggers.join(', ') : undefined),
    `Layer: ${skill.layer}`,
    `Agents: ${formatAgentNames(skill.agents)}`,
    formatOptional('Path', skill.path),
    formatOptional('Source', source),
    formatOptional('Source type', skill.sourceType),
    formatOptional('Skill path', skill.skillPath),
    formatOptional('Version/hash', versionParts.length ? versionParts.join(' • ') : undefined),
    formatOptional('Plugin', skill.pluginName),
  ];

  if (skill.installedAt || skill.updatedAt) {
    metadataLines.push(formatOptional('Installed', skill.installedAt));
    metadataLines.push(formatOptional('Updated', skill.updatedAt));
  }

  return metadataLines;
}

export function formatInstalledSkills(
  skills: CuiInstalledSkill[],
  layers: SkillLayer[] = LAYERS
): string[] {
  const lines: string[] = [];

  for (const layer of layers) {
    const layerSkills = skills.filter((skill) => skill.layer === layer);
    const label = layer === 'project' ? 'Project' : 'Global';
    lines.push(`${label} skills (${layerSkills.length})`);

    if (layerSkills.length === 0) {
      lines.push(`  No ${layer} skills found.`);
      continue;
    }

    for (const skill of layerSkills.sort((a, b) => a.name.localeCompare(b.name))) {
      const agentInfo = formatAgentNames(skill.agents);
      const pathInfo = skill.path ? ` — ${skill.path}` : '';
      lines.push(`  - ${skill.name} [${agentInfo}]${pathInfo}`);
    }
  }

  return lines;
}
