import { determineAgent, type AgentResult } from '@vercel/detect-agent';
import { setDetectedAgent } from './telemetry.ts';
import type { AgentType } from './types.ts';

let cachedResult: AgentResult | null = null;

/**
 * @vercel/detect-agent treats any CURSOR_TRACE_ID as a Cursor agent, but that
 * variable is also present in Cursor's integrated terminal for regular user
 * sessions. Require stronger execution signals before enabling agent mode.
 */
function hasStrongCursorAgentSignal(): boolean {
  return (
    Boolean(process.env.CURSOR_AGENT?.trim()) ||
    process.env.CURSOR_EXTENSION_HOST_ROLE === 'agent-exec'
  );
}

function refineAgentResult(result: AgentResult): AgentResult {
  if (!result.isAgent || !result.agent) {
    return result;
  }

  if (result.agent.name === 'cursor' || result.agent.name === 'cursor-cli') {
    if (!hasStrongCursorAgentSignal()) {
      return { isAgent: false, agent: undefined };
    }

    if (result.agent.name === 'cursor') {
      return { isAgent: true, agent: { name: 'cursor-cli' } };
    }
  }

  return result;
}

/**
 * Map from @vercel/detect-agent names to skills-cli AgentType identifiers.
 * Only includes agents that exist in both systems.
 */
const agentNameToType: Record<string, AgentType> = {
  cursor: 'cursor',
  'cursor-cli': 'cursor',
  claude: 'claude-code',
  cowork: 'claude-code',
  devin: 'universal', // Devin not in skills-cli agent list, use universal
  replit: 'replit',
  gemini: 'gemini-cli',
  codex: 'codex',
  antigravity: 'antigravity',
  'augment-cli': 'augment',
  opencode: 'opencode',
  'github-copilot': 'github-copilot',
};

/**
 * Detect if the CLI is being run inside an AI agent environment.
 * Results are cached after the first call. Also updates telemetry with the agent name.
 */
export async function detectAgent(): Promise<AgentResult> {
  if (cachedResult) return cachedResult;
  cachedResult = refineAgentResult(await determineAgent());
  if (cachedResult.isAgent) {
    setDetectedAgent(cachedResult.agent.name);
  }
  return cachedResult;
}

/**
 * Returns true if the CLI is running inside a detected AI agent.
 * When true, the CLI should skip interactive prompts and use sensible defaults.
 */
export async function isRunningInAgent(): Promise<boolean> {
  const result = await detectAgent();
  return result.isAgent;
}

/**
 * Returns the name of the detected agent, or null if not running in an agent.
 */
export async function getAgentName(): Promise<string | null> {
  const result = await detectAgent();
  return result.isAgent ? result.agent.name : null;
}

/**
 * Maps a detected agent name to the corresponding skills-cli AgentType.
 * Returns null if the agent can't be mapped to a specific skills-cli agent.
 */
export function getAgentType(agentName: string): AgentType | null {
  return agentNameToType[agentName] ?? null;
}
