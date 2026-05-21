import { homedir } from 'os';
import { join } from 'path';
import { existsSync } from 'fs';
import { xdgConfig } from 'xdg-basedir';
import type { AgentConfig, AgentType } from './types.ts';

const home = homedir();
// Use xdg-basedir (not env-paths) to match OpenCode/Amp/Goose behavior on all platforms.
const configHome = xdgConfig ?? join(home, '.config');
const codexHome = process.env.CODEX_HOME?.trim() || join(home, '.codex');
const claudeHome = process.env.CLAUDE_CONFIG_DIR?.trim() || join(home, '.claude');
const vibeHome = process.env.VIBE_HOME?.trim() || join(home, '.vibe');

/**
 * Check if an agent is installed, with project directory taking priority over home directory.
 * @param globalMarker - Global marker path (e.g., '/Users/xxx/.kilocode')
 * @param localMarker - Project-level marker path (e.g., '.kilocode')
 * @returns true if agent is installed (project or global)
 */
async function checkAgentInstallation(
  globalMarker: string,
  localMarker?: string
): Promise<boolean> {
  // Priority 1: Check project directory first (if local marker is defined)
  if (localMarker && existsSync(join(process.cwd(), localMarker))) {
    return true;
  }
  // Priority 2: Fall back to global marker
  return existsSync(globalMarker);
}

export function getOpenClawGlobalSkillsDir(
  homeDir = home,
  pathExists: (path: string) => boolean = existsSync
) {
  if (pathExists(join(homeDir, '.openclaw'))) {
    return join(homeDir, '.openclaw/skills');
  }
  if (pathExists(join(homeDir, '.clawdbot'))) {
    return join(homeDir, '.clawdbot/skills');
  }
  if (pathExists(join(homeDir, '.moltbot'))) {
    return join(homeDir, '.moltbot/skills');
  }
  return join(homeDir, '.openclaw/skills');
}

export const agents: Record<AgentType, AgentConfig> = {
  'aider-desk': {
    name: 'aider-desk',
    displayName: 'AiderDesk',
    skillsDir: '.aider-desk/skills',
    globalSkillsDir: join(home, '.aider-desk/skills'),
    localSkillsDir: '.aider-desk',
    detectInstalled: async () => {
      return await checkAgentInstallation(join(home, '.aider-desk'), '.aider-desk');
    },
  },
  amp: {
    name: 'amp',
    displayName: 'Amp',
    skillsDir: '.agents/skills',
    globalSkillsDir: join(configHome, 'agents/skills'),
    detectInstalled: async () => {
      return await checkAgentInstallation(join(configHome, 'amp'));
    },
  },
  antigravity: {
    name: 'antigravity',
    displayName: 'Antigravity',
    skillsDir: '.agents/skills',
    globalSkillsDir: join(home, '.gemini/antigravity/skills'),
    detectInstalled: async () => {
      return await checkAgentInstallation(join(home, '.gemini/antigravity'));
    },
  },
  augment: {
    name: 'augment',
    displayName: 'Augment',
    skillsDir: '.augment/skills',
    globalSkillsDir: join(home, '.augment/skills'),
    detectInstalled: async () => {
      return await checkAgentInstallation(join(home, '.augment'));
    },
  },
  bob: {
    name: 'bob',
    displayName: 'IBM Bob',
    skillsDir: '.bob/skills',
    globalSkillsDir: join(home, '.bob/skills'),
    detectInstalled: async () => {
      return await checkAgentInstallation(join(home, '.bob'));
    },
  },
  'claude-code': {
    name: 'claude-code',
    displayName: 'Claude Code',
    skillsDir: '.claude/skills',
    globalSkillsDir: join(claudeHome, 'skills'),
    localSkillsDir: '.claude',
    detectInstalled: async () => {
      return await checkAgentInstallation(claudeHome, '.claude');
    },
  },
  openclaw: {
    name: 'openclaw',
    displayName: 'OpenClaw',
    skillsDir: 'skills',
    globalSkillsDir: getOpenClawGlobalSkillsDir(),
    localSkillsDir: '.openclaw',
    detectInstalled: async () => {
      return (
        (await checkAgentInstallation(join(home, '.openclaw'), '.openclaw')) ||
        (await checkAgentInstallation(join(home, '.clawdbot'), '.clawdbot')) ||
        (await checkAgentInstallation(join(home, '.moltbot'), '.moltbot'))
      );
    },
  },
  cline: {
    name: 'cline',
    displayName: 'Cline',
    skillsDir: '.agents/skills',
    globalSkillsDir: join(home, '.agents', 'skills'),
    detectInstalled: async () => {
      return await checkAgentInstallation(join(home, '.cline'));
    },
  },
  'codearts-agent': {
    name: 'codearts-agent',
    displayName: 'CodeArts Agent',
    skillsDir: '.codeartsdoer/skills',
    globalSkillsDir: join(home, '.codeartsdoer/skills'),
    detectInstalled: async () => {
      return await checkAgentInstallation(join(home, '.codeartsdoer'));
    },
  },
  codebuddy: {
    name: 'codebuddy',
    displayName: 'CodeBuddy',
    skillsDir: '.codebuddy/skills',
    globalSkillsDir: join(home, '.codebuddy/skills'),
    detectInstalled: async () => {
      return await checkAgentInstallation(join(home, '.codebuddy'));
    },
  },
  codemaker: {
    name: 'codemaker',
    displayName: 'Codemaker',
    skillsDir: '.codemaker/skills',
    globalSkillsDir: join(home, '.codemaker/skills'),
    detectInstalled: async () => {
      return await checkAgentInstallation(join(home, '.codemaker'));
    },
  },
  codestudio: {
    name: 'codestudio',
    displayName: 'Code Studio',
    skillsDir: '.codestudio/skills',
    globalSkillsDir: join(home, '.codestudio/skills'),
    detectInstalled: async () => {
      return await checkAgentInstallation(join(home, '.codestudio'));
    },
  },
  codex: {
    name: 'codex',
    displayName: 'Codex',
    skillsDir: '.agents/skills',
    globalSkillsDir: join(codexHome, 'skills'),
    localSkillsDir: '.agents',
    detectInstalled: async () => {
      return (await checkAgentInstallation(codexHome, '.agents')) || existsSync('/etc/codex');
    },
  },
  'command-code': {
    name: 'command-code',
    displayName: 'Command Code',
    skillsDir: '.commandcode/skills',
    globalSkillsDir: join(home, '.commandcode/skills'),
    detectInstalled: async () => {
      return await checkAgentInstallation(join(home, '.commandcode'));
    },
  },
  continue: {
    name: 'continue',
    displayName: 'Continue',
    skillsDir: '.continue/skills',
    globalSkillsDir: join(home, '.continue/skills'),
    localSkillsDir: '.continue',
    detectInstalled: async () => {
      return await checkAgentInstallation(join(home, '.continue'), '.continue');
    },
  },
  cortex: {
    name: 'cortex',
    displayName: 'Cortex Code',
    skillsDir: '.cortex/skills',
    globalSkillsDir: join(home, '.snowflake/cortex/skills'),
    detectInstalled: async () => {
      return await checkAgentInstallation(join(home, '.snowflake/cortex'));
    },
  },
  crush: {
    name: 'crush',
    displayName: 'Crush',
    skillsDir: '.crush/skills',
    globalSkillsDir: join(home, '.config/crush/skills'),
    detectInstalled: async () => {
      return await checkAgentInstallation(join(home, '.config/crush'));
    },
  },
  cursor: {
    name: 'cursor',
    displayName: 'Cursor',
    skillsDir: '.agents/skills',
    globalSkillsDir: join(home, '.cursor/skills'),
    detectInstalled: async () => {
      return await checkAgentInstallation(join(home, '.cursor'));
    },
  },
  deepagents: {
    name: 'deepagents',
    displayName: 'Deep Agents',
    skillsDir: '.agents/skills',
    globalSkillsDir: join(home, '.deepagents/agent/skills'),
    detectInstalled: async () => {
      return await checkAgentInstallation(join(home, '.deepagents'));
    },
  },
  devin: {
    name: 'devin',
    displayName: 'Devin for Terminal',
    skillsDir: '.devin/skills',
    globalSkillsDir: join(configHome, 'devin/skills'),
    detectInstalled: async () => {
      return await checkAgentInstallation(join(configHome, 'devin'));
    },
  },
  dexto: {
    name: 'dexto',
    displayName: 'Dexto',
    skillsDir: '.agents/skills',
    globalSkillsDir: join(home, '.agents/skills'),
    detectInstalled: async () => {
      return await checkAgentInstallation(join(home, '.dexto'));
    },
  },
  droid: {
    name: 'droid',
    displayName: 'Droid',
    skillsDir: '.factory/skills',
    globalSkillsDir: join(home, '.factory/skills'),
    detectInstalled: async () => {
      return await checkAgentInstallation(join(home, '.factory'));
    },
  },
  firebender: {
    name: 'firebender',
    displayName: 'Firebender',
    skillsDir: '.agents/skills',
    globalSkillsDir: join(home, '.firebender/skills'),
    detectInstalled: async () => {
      return await checkAgentInstallation(join(home, '.firebender'));
    },
  },
  forgecode: {
    name: 'forgecode',
    displayName: 'ForgeCode',
    skillsDir: '.forge/skills',
    globalSkillsDir: join(home, '.forge/skills'),
    detectInstalled: async () => {
      return await checkAgentInstallation(join(home, '.forge'));
    },
  },
  'gemini-cli': {
    name: 'gemini-cli',
    displayName: 'Gemini CLI',
    skillsDir: '.agents/skills',
    globalSkillsDir: join(home, '.gemini/skills'),
    localSkillsDir: '.agents',
    detectInstalled: async () => {
      return await checkAgentInstallation(join(home, '.gemini'), '.agents');
    },
  },
  'github-copilot': {
    name: 'github-copilot',
    displayName: 'GitHub Copilot',
    skillsDir: '.agents/skills',
    globalSkillsDir: join(home, '.copilot/skills'),
    detectInstalled: async () => {
      return await checkAgentInstallation(join(home, '.copilot'));
    },
  },
  goose: {
    name: 'goose',
    displayName: 'Goose',
    skillsDir: '.goose/skills',
    globalSkillsDir: join(configHome, 'goose/skills'),
    localSkillsDir: '.goose',
    detectInstalled: async () => {
      return await checkAgentInstallation(join(configHome, 'goose'), '.goose');
    },
  },
  'hermes-agent': {
    name: 'hermes-agent',
    displayName: 'Hermes Agent',
    skillsDir: '.hermes/skills',
    globalSkillsDir: join(home, '.hermes/skills'),
    detectInstalled: async () => {
      return await checkAgentInstallation(join(home, '.hermes'));
    },
  },
  junie: {
    name: 'junie',
    displayName: 'Junie',
    skillsDir: '.junie/skills',
    globalSkillsDir: join(home, '.junie/skills'),
    detectInstalled: async () => {
      return await checkAgentInstallation(join(home, '.junie'));
    },
  },
  'iflow-cli': {
    name: 'iflow-cli',
    displayName: 'iFlow CLI',
    skillsDir: '.iflow/skills',
    globalSkillsDir: join(home, '.iflow/skills'),
    detectInstalled: async () => {
      return await checkAgentInstallation(join(home, '.iflow'));
    },
  },
  kilo: {
    name: 'kilo',
    displayName: 'Kilo Code',
    skillsDir: '.kilocode/skills',
    globalSkillsDir: join(home, '.kilocode/skills'),
    localSkillsDir: '.kilocode',
    detectInstalled: async () => {
      return await checkAgentInstallation(join(home, '.kilocode'), '.kilocode');
    },
  },
  'kimi-cli': {
    name: 'kimi-cli',
    displayName: 'Kimi Code CLI',
    skillsDir: '.agents/skills',
    globalSkillsDir: join(home, '.config/agents/skills'),
    localSkillsDir: '.agents',
    detectInstalled: async () => {
      return await checkAgentInstallation(join(home, '.kimi'), '.agents');
    },
  },
  'kiro-cli': {
    name: 'kiro-cli',
    displayName: 'Kiro CLI',
    skillsDir: '.kiro/skills',
    globalSkillsDir: join(home, '.kiro/skills'),
    detectInstalled: async () => {
      return await checkAgentInstallation(join(home, '.kiro'));
    },
  },
  kode: {
    name: 'kode',
    displayName: 'Kode',
    skillsDir: '.kode/skills',
    globalSkillsDir: join(home, '.kode/skills'),
    detectInstalled: async () => {
      return await checkAgentInstallation(join(home, '.kode'));
    },
  },
  mcpjam: {
    name: 'mcpjam',
    displayName: 'MCPJam',
    skillsDir: '.mcpjam/skills',
    globalSkillsDir: join(home, '.mcpjam/skills'),
    localSkillsDir: '.mcpjam',
    detectInstalled: async () => {
      return await checkAgentInstallation(join(home, '.mcpjam'), '.mcpjam');
    },
  },
  'mistral-vibe': {
    name: 'mistral-vibe',
    displayName: 'Mistral Vibe',
    skillsDir: '.vibe/skills',
    globalSkillsDir: join(vibeHome, 'skills'),
    detectInstalled: async () => {
      return await checkAgentInstallation(vibeHome, undefined);
    },
  },
  mux: {
    name: 'mux',
    displayName: 'Mux',
    skillsDir: '.mux/skills',
    globalSkillsDir: join(home, '.mux/skills'),
    detectInstalled: async () => {
      return await checkAgentInstallation(join(home, '.mux'));
    },
  },
  opencode: {
    name: 'opencode',
    displayName: 'OpenCode',
    skillsDir: '.agents/skills',
    globalSkillsDir: join(configHome, 'opencode/skills'),
    localSkillsDir: '.agents',
    detectInstalled: async () => {
      return await checkAgentInstallation(join(configHome, 'opencode'), '.agents');
    },
  },
  openhands: {
    name: 'openhands',
    displayName: 'OpenHands',
    skillsDir: '.openhands/skills',
    globalSkillsDir: join(home, '.openhands/skills'),
    localSkillsDir: '.openhands',
    detectInstalled: async () => {
      return await checkAgentInstallation(join(home, '.openhands'), '.openhands');
    },
  },
  pi: {
    name: 'pi',
    displayName: 'Pi',
    skillsDir: '.pi/skills',
    globalSkillsDir: join(home, '.pi/agent/skills'),
    detectInstalled: async () => {
      return await checkAgentInstallation(join(home, '.pi/agent'));
    },
  },
  qoder: {
    name: 'qoder',
    displayName: 'Qoder',
    skillsDir: '.qoder/skills',
    globalSkillsDir: join(home, '.qoder/skills'),
    detectInstalled: async () => {
      return await checkAgentInstallation(join(home, '.qoder'));
    },
  },
  'qwen-code': {
    name: 'qwen-code',
    displayName: 'Qwen Code',
    skillsDir: '.qwen/skills',
    globalSkillsDir: join(home, '.qwen/skills'),
    localSkillsDir: '.qwen',
    detectInstalled: async () => {
      return await checkAgentInstallation(join(home, '.qwen'), '.qwen');
    },
  },
  replit: {
    name: 'replit',
    displayName: 'Replit',
    skillsDir: '.agents/skills',
    globalSkillsDir: join(configHome, 'agents/skills'),
    showInUniversalList: false,
    detectInstalled: async () => {
      return await checkAgentInstallation(join(configHome, 'agents'));
    },
  },
  rovodev: {
    name: 'rovodev',
    displayName: 'Rovo Dev',
    skillsDir: '.rovodev/skills',
    globalSkillsDir: join(home, '.rovodev/skills'),
    detectInstalled: async () => {
      return await checkAgentInstallation(join(home, '.rovodev'));
    },
  },
  roo: {
    name: 'roo',
    displayName: 'Roo Code',
    skillsDir: '.roo/skills',
    globalSkillsDir: join(home, '.roo/skills'),
    detectInstalled: async () => {
      return await checkAgentInstallation(join(home, '.roo'));
    },
  },
  'tabnine-cli': {
    name: 'tabnine-cli',
    displayName: 'Tabnine CLI',
    skillsDir: '.tabnine/agent/skills',
    globalSkillsDir: join(home, '.tabnine/agent/skills'),
    detectInstalled: async () => {
      return await checkAgentInstallation(join(home, '.tabnine'));
    },
  },
  trae: {
    name: 'trae',
    displayName: 'Trae',
    skillsDir: '.trae/skills',
    globalSkillsDir: join(home, '.trae/skills'),
    detectInstalled: async () => {
      return await checkAgentInstallation(join(home, '.trae'));
    },
  },
  'trae-cn': {
    name: 'trae-cn',
    displayName: 'Trae CN',
    skillsDir: '.trae/skills',
    globalSkillsDir: join(home, '.trae-cn/skills'),
    detectInstalled: async () => {
      return await checkAgentInstallation(join(home, '.trae-cn'));
    },
  },
  warp: {
    name: 'warp',
    displayName: 'Warp',
    skillsDir: '.agents/skills',
    globalSkillsDir: join(home, '.agents/skills'),
    detectInstalled: async () => {
      return await checkAgentInstallation(join(home, '.warp'));
    },
  },
  windsurf: {
    name: 'windsurf',
    displayName: 'Windsurf',
    skillsDir: '.windsurf/skills',
    globalSkillsDir: join(home, '.codeium/windsurf/skills'),
    detectInstalled: async () => {
      return await checkAgentInstallation(join(home, '.codeium/windsurf'));
    },
  },
  zencoder: {
    name: 'zencoder',
    displayName: 'Zencoder',
    skillsDir: '.zencoder/skills',
    globalSkillsDir: join(home, '.zencoder/skills'),
    detectInstalled: async () => {
      return await checkAgentInstallation(join(home, '.zencoder'));
    },
  },
  neovate: {
    name: 'neovate',
    displayName: 'Neovate',
    skillsDir: '.neovate/skills',
    globalSkillsDir: join(home, '.neovate/skills'),
    detectInstalled: async () => {
      return await checkAgentInstallation(join(home, '.neovate'));
    },
  },
  pochi: {
    name: 'pochi',
    displayName: 'Pochi',
    skillsDir: '.pochi/skills',
    globalSkillsDir: join(home, '.pochi/skills'),
    localSkillsDir: '.pochi',
    detectInstalled: async () => {
      return await checkAgentInstallation(join(home, '.pochi'), '.pochi');
    },
  },
  adal: {
    name: 'adal',
    displayName: 'AdaL',
    skillsDir: '.adal/skills',
    globalSkillsDir: join(home, '.adal/skills'),
    detectInstalled: async () => {
      return await checkAgentInstallation(join(home, '.adal'));
    },
  },
  universal: {
    name: 'universal',
    displayName: 'Universal',
    skillsDir: '.agents/skills',
    globalSkillsDir: join(configHome, 'agents/skills'),
    showInUniversalList: false,
    detectInstalled: async () => false,
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
