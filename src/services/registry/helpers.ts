import type { AgentConfig, AgentType, CognitiveType } from '../../core/types.ts';
import { COGNITIVE_SUBDIRS } from '../../core/constants.ts';
import { agents } from './__generated__/agents.ts';

export function getAgentConfig(type: AgentType): AgentConfig {
  return agents[type];
}

/**
 * Returns agents that use the universal .agents/skills directory.
 * These agents share a common skill location and don't need symlinks.
 * Agents with showInUniversalList: false are excluded.
 */
export function getUniversalAgents(): AgentType[] {
  return (Object.entries(agents) as [AgentType, AgentConfig][])
    .filter(
      ([_, config]) => config.skillsDir === '.agents/skills' && config.showInUniversalList !== false
    )
    .map(([type]) => type);
}

/**
 * Returns agents that use agent-specific skill directories (not universal).
 * These agents need symlinks from the canonical .agents/skills location.
 */
export function getNonUniversalAgents(): AgentType[] {
  return (Object.entries(agents) as [AgentType, AgentConfig][])
    .filter(([_, config]) => config.skillsDir !== '.agents/skills')
    .map(([type]) => type);
}

/**
 * Check if an agent uses the universal .agents/skills directory.
 */
export function isUniversalAgent(type: AgentType): boolean {
  return agents[type].skillsDir === '.agents/skills';
}

/**
 * Get the cognitive-specific directory for an agent.
 * Returns the appropriate dir (skillsDir/agentsDir/promptsDir) based on cognitive type.
 */
export function getCognitiveDir(
  agentType: AgentType,
  cognitiveType: CognitiveType,
  scope: 'local' | 'global'
): string | undefined {
  const agent = agents[agentType];
  if (scope === 'global') {
    switch (cognitiveType) {
      case 'skill':
        return agent.globalSkillsDir;
      case 'agent':
        return agent.globalAgentsDir;
      case 'prompt':
        return agent.globalPromptsDir;
    }
  } else {
    switch (cognitiveType) {
      case 'skill':
        return agent.skillsDir;
      case 'agent':
        return agent.agentsDir;
      case 'prompt':
        return agent.promptsDir;
    }
  }
}

/**
 * Check if an agent uses the universal directory for a given cognitive type.
 */
export function isUniversalForType(agentType: AgentType, cognitiveType: CognitiveType): boolean {
  const agent = agents[agentType];
  const universalDir = `.agents/${COGNITIVE_SUBDIRS[cognitiveType]}`;
  switch (cognitiveType) {
    case 'skill':
      return agent.skillsDir === universalDir;
    case 'agent':
      return agent.agentsDir === universalDir;
    case 'prompt':
      return agent.promptsDir === universalDir;
  }
}
