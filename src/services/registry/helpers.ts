import type { AgentConfig, AgentType, CognitiveType } from '../../core/types.ts';
import { COGNITIVE_SUBDIRS } from '../../core/types.ts';
import { agents } from './__generated__/agents.ts';

export function getAgentConfig(type: AgentType): AgentConfig {
  return agents[type];
}

/**
 * Returns agents that use the universal .agents/<type> directory.
 * These agents share a common cognitive location and don't need symlinks.
 * Agents with showInUniversalList: false are excluded.
 */
export function getUniversalAgents(cognitiveType: CognitiveType = 'skill'): AgentType[] {
  return (Object.entries(agents) as [AgentType, AgentConfig][])
    .filter(
      ([_, config]) =>
        config.dirs[cognitiveType].local === `.agents/${COGNITIVE_SUBDIRS[cognitiveType]}` &&
        config.showInUniversalList !== false
    )
    .map(([type]) => type);
}

/**
 * Returns agents that use agent-specific directories (not universal) for a cognitive type.
 * These agents need symlinks from the canonical .agents/<type> location.
 */
export function getNonUniversalAgents(cognitiveType: CognitiveType = 'skill'): AgentType[] {
  return (Object.entries(agents) as [AgentType, AgentConfig][])
    .filter(
      ([_, config]) =>
        config.dirs[cognitiveType].local !== `.agents/${COGNITIVE_SUBDIRS[cognitiveType]}`
    )
    .map(([type]) => type);
}

/**
 * Check if an agent uses the universal .agents/<type> directory.
 */
export function isUniversalAgent(type: AgentType, cognitiveType: CognitiveType = 'skill'): boolean {
  return agents[type].dirs[cognitiveType].local === `.agents/${COGNITIVE_SUBDIRS[cognitiveType]}`;
}

/**
 * Get the cognitive-specific directory for an agent.
 * Returns the appropriate dir based on cognitive type and scope.
 */
export function getCognitiveDir(
  agentType: AgentType,
  cognitiveType: CognitiveType,
  scope: 'local' | 'global'
): string | undefined {
  const agent = agents[agentType];
  const dirEntry = agent.dirs[cognitiveType]!;
  return scope === 'global' ? dirEntry.global : dirEntry.local;
}

/**
 * Check if an agent uses the universal directory for a given cognitive type.
 */
export function isUniversalForType(agentType: AgentType, cognitiveType: CognitiveType): boolean {
  const agent = agents[agentType];
  return agent.dirs[cognitiveType]!.local === `.agents/${COGNITIVE_SUBDIRS[cognitiveType]}`;
}
