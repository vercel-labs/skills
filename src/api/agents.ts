import { agents as agentConfigs, detectInstalledAgents, isUniversalAgent } from '../agents.ts';
import type { AgentType } from '../types.ts';
import { isAgentAllowed, resolveConfig } from './config.ts';
import { throwIfAborted } from './errors.ts';
import type { AgentInfo, BaseOptions, DetectAgentsResult } from './types.ts';

let agentInfos: readonly AgentInfo[] | undefined;

export function toAgentInfo(id: AgentType): AgentInfo {
  const config = agentConfigs[id];
  return Object.freeze({
    id,
    name: config.displayName,
    projectSkillsDir: config.skillsDir,
    globalSkillsDir: config.globalSkillsDir ?? null,
    universal: isUniversalAgent(id),
  });
}

/** Every supported agent. The `universal` pseudo-agent is not listed. */
export function getAgents(): readonly AgentInfo[] {
  agentInfos ??= Object.freeze(
    (Object.keys(agentConfigs) as AgentType[]).filter((id) => id !== 'universal').map(toAgentInfo)
  );
  return agentInfos;
}

/** Agents installed on this machine or in `cwd`, limited to those `config.agents` allows. */
export async function detectAgents(options: BaseOptions = {}): Promise<DetectAgentsResult> {
  const config = resolveConfig(options);
  throwIfAborted(options.signal);
  const detected = await detectInstalledAgents(config.cwd);
  throwIfAborted(options.signal);
  return {
    agents: detected
      .filter((id) => id !== 'universal' && isAgentAllowed(id, config.agents))
      .map(toAgentInfo),
  };
}
