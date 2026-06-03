import type { ParsedClassifiers } from './parser.ts';
import { agents } from '../agents.ts';
import type { AgentType } from '../types.ts';

export interface CompatibilityWarning {
  skillName: string;
  declaredAgents: string[];
  targetAgent: string;
  message: string;
}

/**
 * Check if a skill's classifiers indicate agent compatibility issues.
 *
 * Rules:
 * - No Agent classifiers → no warnings (backward compatible)
 * - "Agent :: Universal" → compatible with all agents
 * - Specific agents listed → warn if target agent is not in the list
 */
export function checkAgentCompatibility(
  skillName: string,
  classifiers: ParsedClassifiers | null,
  targetAgents: AgentType[]
): CompatibilityWarning[] {
  if (!classifiers || classifiers.agents.length === 0) return [];

  // Universal means compatible with all
  if (classifiers.agents.includes('Universal')) return [];

  const warnings: CompatibilityWarning[] = [];

  for (const agentKey of targetAgents) {
    const agent = agents[agentKey];
    if (!agent) continue;

    const isCompatible = classifiers.agents.some(
      (declared) => declared === agent.displayName || declared.toLowerCase() === agentKey
    );

    if (!isCompatible) {
      warnings.push({
        skillName,
        declaredAgents: classifiers.agents,
        targetAgent: agent.displayName,
        message: `"${skillName}" is classified for ${classifiers.agents.join(', ')} only. You're installing to ${agent.displayName}.`,
      });
    }
  }

  return warnings;
}
