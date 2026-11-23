import { agents as agentConfigs, detectInstalledAgents, isUniversalAgent } from '../agents.ts';
import type { AgentType } from '../types.ts';
import { isAgentAllowed, resolveConfig } from './config.ts';
import type { AgentInfo, BaseOptions, DetectAgentsResult } from './types.ts';

let agentInfos: readonly AgentInfo[] | undefined;

function toAgentInfo(id: AgentType): AgentInfo {
  const config = agentConfigs[id];
  return Object.freeze({
    id,
    name: config.displayName,
    projectSkillsDir: config.skillsDir,
    globalSkillsDir: config.globalSkillsDir ?? null,
    universal: isUniversalAgent(id),
  });
}

/**
 * Every supported agent, including `universal`: the neutral `.agents/skills`
 * target that universal agents read. It is never detected, only targeted.
 */
export function getSupportedAgents(): readonly AgentInfo[] {
  agentInfos ??= Object.freeze((Object.keys(agentConfigs) as AgentType[]).map(toAgentInfo));
  return agentInfos;
}

/** Agents installed on this machine or in `cwd`, limited to those `config.agents` allows. */
export async function detectAgents(options: BaseOptions = {}): Promise<DetectAgentsResult> {
  const config = resolveConfig(options);
  options.signal?.throwIfAborted();
  const detected = await detectInstalledAgents(config.cwd);
  options.signal?.throwIfAborted();
  return {
    agents: detected.filter((id) => isAgentAllowed(id, config.agents)).map(toAgentInfo),
  };
}
