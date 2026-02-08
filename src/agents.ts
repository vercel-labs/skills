import { homedir } from 'os';
import { join } from 'path';
import { existsSync } from 'fs';
import { xdgConfig } from 'xdg-basedir';
import type { AgentConfig, AgentType, CognitiveType } from './types.ts';
import { COGNITIVE_SUBDIRS } from './constants.ts';

const home = homedir();
// Use xdg-basedir (not env-paths) to match OpenCode/Amp/Goose behavior on all platforms.
const configHome = xdgConfig ?? join(home, '.config');
const codexHome = process.env.CODEX_HOME?.trim() || join(home, '.codex');
const claudeHome = process.env.CLAUDE_CONFIG_DIR?.trim() || join(home, '.claude');

export const agents: Record<AgentType, AgentConfig> = {
  amp: {
    name: 'amp',
    displayName: 'Amp',
    skillsDir: '.agents/skills',
    globalSkillsDir: join(configHome, 'agents/skills'),
    agentsDir: '.agents/agents',
    globalAgentsDir: join(configHome, 'agents/agents'),
    promptsDir: '.agents/prompts',
    globalPromptsDir: join(configHome, 'agents/prompts'),
    detectInstalled: async () => {
      return existsSync(join(configHome, 'amp'));
    },
  },
  antigravity: {
    name: 'antigravity',
    displayName: 'Antigravity',
    skillsDir: '.agent/skills',
    globalSkillsDir: join(home, '.gemini/antigravity/skills'),
    agentsDir: '.agent/agents',
    globalAgentsDir: join(home, '.gemini/antigravity/agents'),
    promptsDir: '.agent/prompts',
    globalPromptsDir: join(home, '.gemini/antigravity/prompts'),
    detectInstalled: async () => {
      return (
        existsSync(join(process.cwd(), '.agent')) || existsSync(join(home, '.gemini/antigravity'))
      );
    },
  },
  augment: {
    name: 'augment',
    displayName: 'Augment',
    skillsDir: '.augment/skills',
    globalSkillsDir: join(home, '.augment/skills'),
    agentsDir: '.augment/agents',
    globalAgentsDir: join(home, '.augment/agents'),
    promptsDir: '.augment/prompts',
    globalPromptsDir: join(home, '.augment/prompts'),
    detectInstalled: async () => {
      return existsSync(join(home, '.augment'));
    },
  },
  'claude-code': {
    name: 'claude-code',
    displayName: 'Claude Code',
    skillsDir: '.claude/skills',
    globalSkillsDir: join(claudeHome, 'skills'),
    agentsDir: '.claude/agents',
    globalAgentsDir: join(claudeHome, 'agents'),
    promptsDir: '.claude/prompts',
    globalPromptsDir: join(claudeHome, 'prompts'),
    detectInstalled: async () => {
      return existsSync(claudeHome);
    },
  },
  openclaw: {
    name: 'openclaw',
    displayName: 'OpenClaw',
    skillsDir: 'skills',
    globalSkillsDir: existsSync(join(home, '.openclaw'))
      ? join(home, '.openclaw/skills')
      : existsSync(join(home, '.clawdbot'))
        ? join(home, '.clawdbot/skills')
        : join(home, '.moltbot/skills'),
    agentsDir: 'agents',
    globalAgentsDir: existsSync(join(home, '.openclaw'))
      ? join(home, '.openclaw/agents')
      : existsSync(join(home, '.clawdbot'))
        ? join(home, '.clawdbot/agents')
        : join(home, '.moltbot/agents'),
    promptsDir: 'prompts',
    globalPromptsDir: existsSync(join(home, '.openclaw'))
      ? join(home, '.openclaw/prompts')
      : existsSync(join(home, '.clawdbot'))
        ? join(home, '.clawdbot/prompts')
        : join(home, '.moltbot/prompts'),
    detectInstalled: async () => {
      return (
        existsSync(join(home, '.openclaw')) ||
        existsSync(join(home, '.clawdbot')) ||
        existsSync(join(home, '.moltbot'))
      );
    },
  },
  cline: {
    name: 'cline',
    displayName: 'Cline',
    skillsDir: '.cline/skills',
    globalSkillsDir: join(home, '.cline/skills'),
    agentsDir: '.cline/agents',
    globalAgentsDir: join(home, '.cline/agents'),
    promptsDir: '.cline/prompts',
    globalPromptsDir: join(home, '.cline/prompts'),
    detectInstalled: async () => {
      return existsSync(join(home, '.cline'));
    },
  },
  codebuddy: {
    name: 'codebuddy',
    displayName: 'CodeBuddy',
    skillsDir: '.codebuddy/skills',
    globalSkillsDir: join(home, '.codebuddy/skills'),
    agentsDir: '.codebuddy/agents',
    globalAgentsDir: join(home, '.codebuddy/agents'),
    promptsDir: '.codebuddy/prompts',
    globalPromptsDir: join(home, '.codebuddy/prompts'),
    detectInstalled: async () => {
      return existsSync(join(process.cwd(), '.codebuddy')) || existsSync(join(home, '.codebuddy'));
    },
  },
  codex: {
    name: 'codex',
    displayName: 'Codex',
    skillsDir: '.agents/skills',
    globalSkillsDir: join(codexHome, 'skills'),
    agentsDir: '.agents/agents',
    globalAgentsDir: join(codexHome, 'agents'),
    promptsDir: '.agents/prompts',
    globalPromptsDir: join(codexHome, 'prompts'),
    detectInstalled: async () => {
      return existsSync(codexHome) || existsSync('/etc/codex');
    },
  },
  'command-code': {
    name: 'command-code',
    displayName: 'Command Code',
    skillsDir: '.commandcode/skills',
    globalSkillsDir: join(home, '.commandcode/skills'),
    agentsDir: '.commandcode/agents',
    globalAgentsDir: join(home, '.commandcode/agents'),
    promptsDir: '.commandcode/prompts',
    globalPromptsDir: join(home, '.commandcode/prompts'),
    detectInstalled: async () => {
      return existsSync(join(home, '.commandcode'));
    },
  },
  continue: {
    name: 'continue',
    displayName: 'Continue',
    skillsDir: '.continue/skills',
    globalSkillsDir: join(home, '.continue/skills'),
    agentsDir: '.continue/agents',
    globalAgentsDir: join(home, '.continue/agents'),
    promptsDir: '.continue/prompts',
    globalPromptsDir: join(home, '.continue/prompts'),
    detectInstalled: async () => {
      return existsSync(join(process.cwd(), '.continue')) || existsSync(join(home, '.continue'));
    },
  },
  crush: {
    name: 'crush',
    displayName: 'Crush',
    skillsDir: '.crush/skills',
    globalSkillsDir: join(home, '.config/crush/skills'),
    agentsDir: '.crush/agents',
    globalAgentsDir: join(home, '.config/crush/agents'),
    promptsDir: '.crush/prompts',
    globalPromptsDir: join(home, '.config/crush/prompts'),
    detectInstalled: async () => {
      return existsSync(join(home, '.config/crush'));
    },
  },
  cursor: {
    name: 'cursor',
    displayName: 'Cursor',
    skillsDir: '.cursor/skills',
    globalSkillsDir: join(home, '.cursor/skills'),
    agentsDir: '.cursor/agents',
    globalAgentsDir: join(home, '.cursor/agents'),
    promptsDir: '.cursor/prompts',
    globalPromptsDir: join(home, '.cursor/prompts'),
    detectInstalled: async () => {
      return existsSync(join(home, '.cursor'));
    },
  },
  droid: {
    name: 'droid',
    displayName: 'Droid',
    skillsDir: '.factory/skills',
    globalSkillsDir: join(home, '.factory/skills'),
    agentsDir: '.factory/agents',
    globalAgentsDir: join(home, '.factory/agents'),
    promptsDir: '.factory/prompts',
    globalPromptsDir: join(home, '.factory/prompts'),
    detectInstalled: async () => {
      return existsSync(join(home, '.factory'));
    },
  },
  'gemini-cli': {
    name: 'gemini-cli',
    displayName: 'Gemini CLI',
    skillsDir: '.agents/skills',
    globalSkillsDir: join(home, '.gemini/skills'),
    agentsDir: '.agents/agents',
    globalAgentsDir: join(home, '.gemini/agents'),
    promptsDir: '.agents/prompts',
    globalPromptsDir: join(home, '.gemini/prompts'),
    detectInstalled: async () => {
      return existsSync(join(home, '.gemini'));
    },
  },
  'github-copilot': {
    name: 'github-copilot',
    displayName: 'GitHub Copilot',
    skillsDir: '.agents/skills',
    globalSkillsDir: join(home, '.copilot/skills'),
    agentsDir: '.agents/agents',
    globalAgentsDir: join(home, '.copilot/agents'),
    promptsDir: '.agents/prompts',
    globalPromptsDir: join(home, '.copilot/prompts'),
    detectInstalled: async () => {
      return existsSync(join(process.cwd(), '.github')) || existsSync(join(home, '.copilot'));
    },
  },
  goose: {
    name: 'goose',
    displayName: 'Goose',
    skillsDir: '.goose/skills',
    globalSkillsDir: join(configHome, 'goose/skills'),
    agentsDir: '.goose/agents',
    globalAgentsDir: join(configHome, 'goose/agents'),
    promptsDir: '.goose/prompts',
    globalPromptsDir: join(configHome, 'goose/prompts'),
    detectInstalled: async () => {
      return existsSync(join(configHome, 'goose'));
    },
  },
  junie: {
    name: 'junie',
    displayName: 'Junie',
    skillsDir: '.junie/skills',
    globalSkillsDir: join(home, '.junie/skills'),
    agentsDir: '.junie/agents',
    globalAgentsDir: join(home, '.junie/agents'),
    promptsDir: '.junie/prompts',
    globalPromptsDir: join(home, '.junie/prompts'),
    detectInstalled: async () => {
      return existsSync(join(home, '.junie'));
    },
  },
  'iflow-cli': {
    name: 'iflow-cli',
    displayName: 'iFlow CLI',
    skillsDir: '.iflow/skills',
    globalSkillsDir: join(home, '.iflow/skills'),
    agentsDir: '.iflow/agents',
    globalAgentsDir: join(home, '.iflow/agents'),
    promptsDir: '.iflow/prompts',
    globalPromptsDir: join(home, '.iflow/prompts'),
    detectInstalled: async () => {
      return existsSync(join(home, '.iflow'));
    },
  },
  kilo: {
    name: 'kilo',
    displayName: 'Kilo Code',
    skillsDir: '.kilocode/skills',
    globalSkillsDir: join(home, '.kilocode/skills'),
    agentsDir: '.kilocode/agents',
    globalAgentsDir: join(home, '.kilocode/agents'),
    promptsDir: '.kilocode/prompts',
    globalPromptsDir: join(home, '.kilocode/prompts'),
    detectInstalled: async () => {
      return existsSync(join(home, '.kilocode'));
    },
  },
  'kimi-cli': {
    name: 'kimi-cli',
    displayName: 'Kimi Code CLI',
    skillsDir: '.agents/skills',
    globalSkillsDir: join(home, '.config/agents/skills'),
    agentsDir: '.agents/agents',
    globalAgentsDir: join(home, '.config/agents/agents'),
    promptsDir: '.agents/prompts',
    globalPromptsDir: join(home, '.config/agents/prompts'),
    detectInstalled: async () => {
      return existsSync(join(home, '.kimi'));
    },
  },
  'kiro-cli': {
    name: 'kiro-cli',
    displayName: 'Kiro CLI',
    skillsDir: '.kiro/skills',
    globalSkillsDir: join(home, '.kiro/skills'),
    agentsDir: '.kiro/agents',
    globalAgentsDir: join(home, '.kiro/agents'),
    promptsDir: '.kiro/prompts',
    globalPromptsDir: join(home, '.kiro/prompts'),
    detectInstalled: async () => {
      return existsSync(join(home, '.kiro'));
    },
  },
  kode: {
    name: 'kode',
    displayName: 'Kode',
    skillsDir: '.kode/skills',
    globalSkillsDir: join(home, '.kode/skills'),
    agentsDir: '.kode/agents',
    globalAgentsDir: join(home, '.kode/agents'),
    promptsDir: '.kode/prompts',
    globalPromptsDir: join(home, '.kode/prompts'),
    detectInstalled: async () => {
      return existsSync(join(home, '.kode'));
    },
  },
  mcpjam: {
    name: 'mcpjam',
    displayName: 'MCPJam',
    skillsDir: '.mcpjam/skills',
    globalSkillsDir: join(home, '.mcpjam/skills'),
    agentsDir: '.mcpjam/agents',
    globalAgentsDir: join(home, '.mcpjam/agents'),
    promptsDir: '.mcpjam/prompts',
    globalPromptsDir: join(home, '.mcpjam/prompts'),
    detectInstalled: async () => {
      return existsSync(join(home, '.mcpjam'));
    },
  },
  'mistral-vibe': {
    name: 'mistral-vibe',
    displayName: 'Mistral Vibe',
    skillsDir: '.vibe/skills',
    globalSkillsDir: join(home, '.vibe/skills'),
    agentsDir: '.vibe/agents',
    globalAgentsDir: join(home, '.vibe/agents'),
    promptsDir: '.vibe/prompts',
    globalPromptsDir: join(home, '.vibe/prompts'),
    detectInstalled: async () => {
      return existsSync(join(home, '.vibe'));
    },
  },
  mux: {
    name: 'mux',
    displayName: 'Mux',
    skillsDir: '.mux/skills',
    globalSkillsDir: join(home, '.mux/skills'),
    agentsDir: '.mux/agents',
    globalAgentsDir: join(home, '.mux/agents'),
    promptsDir: '.mux/prompts',
    globalPromptsDir: join(home, '.mux/prompts'),
    detectInstalled: async () => {
      return existsSync(join(home, '.mux'));
    },
  },
  opencode: {
    name: 'opencode',
    displayName: 'OpenCode',
    skillsDir: '.agents/skills',
    globalSkillsDir: join(configHome, 'opencode/skills'),
    agentsDir: '.agents/agents',
    globalAgentsDir: join(configHome, 'opencode/agents'),
    promptsDir: '.agents/prompts',
    globalPromptsDir: join(configHome, 'opencode/prompts'),
    detectInstalled: async () => {
      return existsSync(join(configHome, 'opencode')) || existsSync(join(claudeHome, 'skills'));
    },
  },
  openhands: {
    name: 'openhands',
    displayName: 'OpenHands',
    skillsDir: '.openhands/skills',
    globalSkillsDir: join(home, '.openhands/skills'),
    agentsDir: '.openhands/agents',
    globalAgentsDir: join(home, '.openhands/agents'),
    promptsDir: '.openhands/prompts',
    globalPromptsDir: join(home, '.openhands/prompts'),
    detectInstalled: async () => {
      return existsSync(join(home, '.openhands'));
    },
  },
  pi: {
    name: 'pi',
    displayName: 'Pi',
    skillsDir: '.pi/skills',
    globalSkillsDir: join(home, '.pi/agent/skills'),
    agentsDir: '.pi/agents',
    globalAgentsDir: join(home, '.pi/agent/agents'),
    promptsDir: '.pi/prompts',
    globalPromptsDir: join(home, '.pi/agent/prompts'),
    detectInstalled: async () => {
      return existsSync(join(home, '.pi/agent'));
    },
  },
  qoder: {
    name: 'qoder',
    displayName: 'Qoder',
    skillsDir: '.qoder/skills',
    globalSkillsDir: join(home, '.qoder/skills'),
    agentsDir: '.qoder/agents',
    globalAgentsDir: join(home, '.qoder/agents'),
    promptsDir: '.qoder/prompts',
    globalPromptsDir: join(home, '.qoder/prompts'),
    detectInstalled: async () => {
      return existsSync(join(home, '.qoder'));
    },
  },
  'qwen-code': {
    name: 'qwen-code',
    displayName: 'Qwen Code',
    skillsDir: '.qwen/skills',
    globalSkillsDir: join(home, '.qwen/skills'),
    agentsDir: '.qwen/agents',
    globalAgentsDir: join(home, '.qwen/agents'),
    promptsDir: '.qwen/prompts',
    globalPromptsDir: join(home, '.qwen/prompts'),
    detectInstalled: async () => {
      return existsSync(join(home, '.qwen'));
    },
  },
  replit: {
    name: 'replit',
    displayName: 'Replit',
    skillsDir: '.agents/skills',
    globalSkillsDir: join(configHome, 'agents/skills'),
    agentsDir: '.agents/agents',
    globalAgentsDir: join(configHome, 'agents/agents'),
    promptsDir: '.agents/prompts',
    globalPromptsDir: join(configHome, 'agents/prompts'),
    showInUniversalList: false,
    detectInstalled: async () => {
      return existsSync(join(process.cwd(), '.agents'));
    },
  },
  roo: {
    name: 'roo',
    displayName: 'Roo Code',
    skillsDir: '.roo/skills',
    globalSkillsDir: join(home, '.roo/skills'),
    agentsDir: '.roo/agents',
    globalAgentsDir: join(home, '.roo/agents'),
    promptsDir: '.roo/prompts',
    globalPromptsDir: join(home, '.roo/prompts'),
    detectInstalled: async () => {
      return existsSync(join(home, '.roo'));
    },
  },
  trae: {
    name: 'trae',
    displayName: 'Trae',
    skillsDir: '.trae/skills',
    globalSkillsDir: join(home, '.trae/skills'),
    agentsDir: '.trae/agents',
    globalAgentsDir: join(home, '.trae/agents'),
    promptsDir: '.trae/prompts',
    globalPromptsDir: join(home, '.trae/prompts'),
    detectInstalled: async () => {
      return existsSync(join(home, '.trae'));
    },
  },
  'trae-cn': {
    name: 'trae-cn',
    displayName: 'Trae CN',
    skillsDir: '.trae/skills',
    globalSkillsDir: join(home, '.trae-cn/skills'),
    agentsDir: '.trae/agents',
    globalAgentsDir: join(home, '.trae-cn/agents'),
    promptsDir: '.trae/prompts',
    globalPromptsDir: join(home, '.trae-cn/prompts'),
    detectInstalled: async () => {
      return existsSync(join(home, '.trae-cn'));
    },
  },
  windsurf: {
    name: 'windsurf',
    displayName: 'Windsurf',
    skillsDir: '.windsurf/skills',
    globalSkillsDir: join(home, '.codeium/windsurf/skills'),
    agentsDir: '.windsurf/agents',
    globalAgentsDir: join(home, '.codeium/windsurf/agents'),
    promptsDir: '.windsurf/prompts',
    globalPromptsDir: join(home, '.codeium/windsurf/prompts'),
    detectInstalled: async () => {
      return existsSync(join(home, '.codeium/windsurf'));
    },
  },
  zencoder: {
    name: 'zencoder',
    displayName: 'Zencoder',
    skillsDir: '.zencoder/skills',
    globalSkillsDir: join(home, '.zencoder/skills'),
    agentsDir: '.zencoder/agents',
    globalAgentsDir: join(home, '.zencoder/agents'),
    promptsDir: '.zencoder/prompts',
    globalPromptsDir: join(home, '.zencoder/prompts'),
    detectInstalled: async () => {
      return existsSync(join(home, '.zencoder'));
    },
  },
  neovate: {
    name: 'neovate',
    displayName: 'Neovate',
    skillsDir: '.neovate/skills',
    globalSkillsDir: join(home, '.neovate/skills'),
    agentsDir: '.neovate/agents',
    globalAgentsDir: join(home, '.neovate/agents'),
    promptsDir: '.neovate/prompts',
    globalPromptsDir: join(home, '.neovate/prompts'),
    detectInstalled: async () => {
      return existsSync(join(home, '.neovate'));
    },
  },
  pochi: {
    name: 'pochi',
    displayName: 'Pochi',
    skillsDir: '.pochi/skills',
    globalSkillsDir: join(home, '.pochi/skills'),
    agentsDir: '.pochi/agents',
    globalAgentsDir: join(home, '.pochi/agents'),
    promptsDir: '.pochi/prompts',
    globalPromptsDir: join(home, '.pochi/prompts'),
    detectInstalled: async () => {
      return existsSync(join(home, '.pochi'));
    },
  },
  adal: {
    name: 'adal',
    displayName: 'AdaL',
    skillsDir: '.adal/skills',
    globalSkillsDir: join(home, '.adal/skills'),
    agentsDir: '.adal/agents',
    globalAgentsDir: join(home, '.adal/agents'),
    promptsDir: '.adal/prompts',
    globalPromptsDir: join(home, '.adal/prompts'),
    detectInstalled: async () => {
      return existsSync(join(home, '.adal'));
    },
  },
};

export async function detectInstalledAgents(): Promise<AgentType[]> {
  const results = await Promise.all(
    Object.entries(agents).map(async ([type, config]) => ({
      type: type as AgentType,
      installed: await config.detectInstalled(),
    }))
  );
  return results.filter((r) => r.installed).map((r) => r.type);
}

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
