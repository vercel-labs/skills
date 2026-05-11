import { access, constants } from 'fs/promises';
import type { AgentType } from './types.ts';

type AgentResult =
  | {
      isAgent: true;
      agent: { name: string };
    }
  | {
      isAgent: false;
      agent: undefined;
    };

let cachedResult: AgentResult | null = null;

/**
 * Map from detected agent names to agentart-cli AgentType identifiers.
 * Only includes agents that exist in both systems.
 */
const agentNameToType: Record<string, AgentType> = {
  cursor: 'cursor',
  'cursor-cli': 'cursor',
  claude: 'claude-code',
  cowork: 'claude-code',
  devin: 'universal', // Devin not in agentart-cli agent list, use universal
  replit: 'replit',
  gemini: 'gemini-cli',
  codex: 'codex',
  antigravity: 'antigravity',
  'augment-cli': 'augment',
  opencode: 'opencode',
  'github-copilot': 'github-copilot',
};

async function determineAgent(): Promise<AgentResult> {
  const aiAgent = process.env.AI_AGENT?.trim();
  if (aiAgent) {
    return {
      isAgent: true,
      agent: { name: aiAgent === 'github-copilot-cli' ? 'github-copilot' : aiAgent },
    };
  }

  if (process.env.CURSOR_TRACE_ID) return { isAgent: true, agent: { name: 'cursor' } };
  if (process.env.CURSOR_AGENT || process.env.CURSOR_EXTENSION_HOST_ROLE === 'agent-exec') {
    return { isAgent: true, agent: { name: 'cursor-cli' } };
  }
  if (process.env.GEMINI_CLI) return { isAgent: true, agent: { name: 'gemini' } };
  if (process.env.CODEX_SANDBOX || process.env.CODEX_CI || process.env.CODEX_THREAD_ID) {
    return { isAgent: true, agent: { name: 'codex' } };
  }
  if (process.env.ANTIGRAVITY_AGENT) return { isAgent: true, agent: { name: 'antigravity' } };
  if (process.env.AUGMENT_AGENT) return { isAgent: true, agent: { name: 'augment-cli' } };
  if (process.env.OPENCODE_CLIENT) return { isAgent: true, agent: { name: 'opencode' } };
  if (process.env.CLAUDECODE || process.env.CLAUDE_CODE) {
    return {
      isAgent: true,
      agent: { name: process.env.CLAUDE_CODE_IS_COWORK ? 'cowork' : 'claude' },
    };
  }
  if (process.env.REPL_ID) return { isAgent: true, agent: { name: 'replit' } };
  if (
    process.env.COPILOT_MODEL ||
    process.env.COPILOT_ALLOW_ALL ||
    process.env.COPILOT_GITHUB_TOKEN
  ) {
    return { isAgent: true, agent: { name: 'github-copilot' } };
  }

  try {
    await access('/opt/.devin', constants.F_OK);
    return { isAgent: true, agent: { name: 'devin' } };
  } catch {
    return { isAgent: false, agent: undefined };
  }
}

/**
 * Detect if the CLI is being run inside an AI agent environment.
 * Results are cached after the first call.
 */
export async function detectAgent(): Promise<AgentResult> {
  if (cachedResult) return cachedResult;
  cachedResult = await determineAgent();
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
  return result.isAgent && result.agent ? result.agent.name : null;
}

/**
 * Maps a detected agent name to the corresponding agentart-cli AgentType.
 * Returns null if the agent can't be mapped to a specific agentart-cli agent.
 */
export function getAgentType(agentName: string): AgentType | null {
  return agentNameToType[agentName] ?? null;
}
