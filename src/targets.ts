import { homedir } from 'os';
import { join } from 'path';
import { existsSync } from 'fs';
import { xdgConfig } from 'xdg-basedir';
import type { TargetConfig, TargetType } from './types.ts';

const home = homedir();
// Use xdg-basedir (not env-paths) to match OpenCode/Amp/Goose behavior on all platforms.
const configHome = xdgConfig ?? join(home, '.config');
const codexHome = process.env.CODEX_HOME?.trim() || join(home, '.codex');
const claudeHome = process.env.CLAUDE_CONFIG_DIR?.trim() || join(home, '.claude');

export function getOpenClawGlobalAgentsDir(
  homeDir = home,
  pathExists: (path: string) => boolean = existsSync
) {
  if (pathExists(join(homeDir, '.openclaw'))) {
    return join(homeDir, '.openclaw/agents');
  }
  if (pathExists(join(homeDir, '.clawdbot'))) {
    return join(homeDir, '.clawdbot/agents');
  }
  if (pathExists(join(homeDir, '.moltbot'))) {
    return join(homeDir, '.moltbot/agents');
  }
  return join(homeDir, '.openclaw/agents');
}

export const targets: Record<TargetType, TargetConfig> = {
  amp: {
    name: 'amp',
    displayName: 'Amp',
    agentsDir: '.agents/agents',
    globalAgentsDir: join(configHome, 'agents/agents'),
    detectInstalled: async () => {
      return existsSync(join(configHome, 'amp'));
    },
  },
  antigravity: {
    name: 'antigravity',
    displayName: 'Antigravity',
    agentsDir: '.agent/agents',
    globalAgentsDir: join(home, '.gemini/antigravity/agents'),
    detectInstalled: async () => {
      return existsSync(join(home, '.gemini/antigravity'));
    },
  },
  augment: {
    name: 'augment',
    displayName: 'Augment',
    agentsDir: '.augment/agents',
    globalAgentsDir: join(home, '.augment/agents'),
    detectInstalled: async () => {
      return existsSync(join(home, '.augment'));
    },
  },
  'claude-code': {
    name: 'claude-code',
    displayName: 'Claude Code',
    agentsDir: '.claude/agents',
    globalAgentsDir: join(claudeHome, 'agents'),
    detectInstalled: async () => {
      return existsSync(claudeHome);
    },
  },
  openclaw: {
    name: 'openclaw',
    displayName: 'OpenClaw',
    agentsDir: 'agents',
    globalAgentsDir: getOpenClawGlobalAgentsDir(),
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
    agentsDir: '.agents/agents',
    globalAgentsDir: join(home, '.agents', 'agents'),
    detectInstalled: async () => {
      return existsSync(join(home, '.cline'));
    },
  },
  codebuddy: {
    name: 'codebuddy',
    displayName: 'CodeBuddy',
    agentsDir: '.codebuddy/agents',
    globalAgentsDir: join(home, '.codebuddy/agents'),
    detectInstalled: async () => {
      return existsSync(join(process.cwd(), '.codebuddy')) || existsSync(join(home, '.codebuddy'));
    },
  },
  codex: {
    name: 'codex',
    displayName: 'Codex',
    agentsDir: '.agents/agents',
    globalAgentsDir: join(codexHome, 'agents'),
    detectInstalled: async () => {
      return existsSync(codexHome) || existsSync('/etc/codex');
    },
  },
  'command-code': {
    name: 'command-code',
    displayName: 'Command Code',
    agentsDir: '.commandcode/agents',
    globalAgentsDir: join(home, '.commandcode/agents'),
    detectInstalled: async () => {
      return existsSync(join(home, '.commandcode'));
    },
  },
  continue: {
    name: 'continue',
    displayName: 'Continue',
    agentsDir: '.continue/agents',
    globalAgentsDir: join(home, '.continue/agents'),
    detectInstalled: async () => {
      return existsSync(join(process.cwd(), '.continue')) || existsSync(join(home, '.continue'));
    },
  },
  cortex: {
    name: 'cortex',
    displayName: 'Cortex Code',
    agentsDir: '.cortex/agents',
    globalAgentsDir: join(home, '.snowflake/cortex/agents'),
    detectInstalled: async () => {
      return existsSync(join(home, '.snowflake/cortex'));
    },
  },
  crush: {
    name: 'crush',
    displayName: 'Crush',
    agentsDir: '.crush/agents',
    globalAgentsDir: join(home, '.config/crush/agents'),
    detectInstalled: async () => {
      return existsSync(join(home, '.config/crush'));
    },
  },
  cursor: {
    name: 'cursor',
    displayName: 'Cursor',
    agentsDir: '.agents/agents',
    globalAgentsDir: join(home, '.cursor/agents'),
    detectInstalled: async () => {
      return existsSync(join(home, '.cursor'));
    },
  },
  droid: {
    name: 'droid',
    displayName: 'Droid',
    agentsDir: '.factory/agents',
    globalAgentsDir: join(home, '.factory/agents'),
    detectInstalled: async () => {
      return existsSync(join(home, '.factory'));
    },
  },
  'gemini-cli': {
    name: 'gemini-cli',
    displayName: 'Gemini CLI',
    agentsDir: '.agents/agents',
    globalAgentsDir: join(home, '.gemini/agents'),
    detectInstalled: async () => {
      return existsSync(join(home, '.gemini'));
    },
  },
  'github-copilot': {
    name: 'github-copilot',
    displayName: 'GitHub Copilot',
    agentsDir: '.agents/agents',
    globalAgentsDir: join(home, '.copilot/agents'),
    detectInstalled: async () => {
      return existsSync(join(home, '.copilot'));
    },
  },
  goose: {
    name: 'goose',
    displayName: 'Goose',
    agentsDir: '.goose/agents',
    globalAgentsDir: join(configHome, 'goose/agents'),
    detectInstalled: async () => {
      return existsSync(join(configHome, 'goose'));
    },
  },
  junie: {
    name: 'junie',
    displayName: 'Junie',
    agentsDir: '.junie/agents',
    globalAgentsDir: join(home, '.junie/agents'),
    detectInstalled: async () => {
      return existsSync(join(home, '.junie'));
    },
  },
  'iflow-cli': {
    name: 'iflow-cli',
    displayName: 'iFlow CLI',
    agentsDir: '.iflow/agents',
    globalAgentsDir: join(home, '.iflow/agents'),
    detectInstalled: async () => {
      return existsSync(join(home, '.iflow'));
    },
  },
  kilo: {
    name: 'kilo',
    displayName: 'Kilo Code',
    agentsDir: '.kilocode/agents',
    globalAgentsDir: join(home, '.kilocode/agents'),
    detectInstalled: async () => {
      return existsSync(join(home, '.kilocode'));
    },
  },
  'kimi-cli': {
    name: 'kimi-cli',
    displayName: 'Kimi Code CLI',
    agentsDir: '.agents/agents',
    globalAgentsDir: join(home, '.config/agents/agents'),
    detectInstalled: async () => {
      return existsSync(join(home, '.kimi'));
    },
  },
  'kiro-cli': {
    name: 'kiro-cli',
    displayName: 'Kiro CLI',
    agentsDir: '.kiro/agents',
    globalAgentsDir: join(home, '.kiro/agents'),
    detectInstalled: async () => {
      return existsSync(join(home, '.kiro'));
    },
  },
  kode: {
    name: 'kode',
    displayName: 'Kode',
    agentsDir: '.kode/agents',
    globalAgentsDir: join(home, '.kode/agents'),
    detectInstalled: async () => {
      return existsSync(join(home, '.kode'));
    },
  },
  mcpjam: {
    name: 'mcpjam',
    displayName: 'MCPJam',
    agentsDir: '.mcpjam/agents',
    globalAgentsDir: join(home, '.mcpjam/agents'),
    detectInstalled: async () => {
      return existsSync(join(home, '.mcpjam'));
    },
  },
  'mistral-vibe': {
    name: 'mistral-vibe',
    displayName: 'Mistral Vibe',
    agentsDir: '.vibe/agents',
    globalAgentsDir: join(home, '.vibe/agents'),
    detectInstalled: async () => {
      return existsSync(join(home, '.vibe'));
    },
  },
  mux: {
    name: 'mux',
    displayName: 'Mux',
    agentsDir: '.mux/agents',
    globalAgentsDir: join(home, '.mux/agents'),
    detectInstalled: async () => {
      return existsSync(join(home, '.mux'));
    },
  },
  opencode: {
    name: 'opencode',
    displayName: 'OpenCode',
    agentsDir: '.agents/agents',
    globalAgentsDir: join(configHome, 'opencode/agents'),
    detectInstalled: async () => {
      return existsSync(join(configHome, 'opencode'));
    },
  },
  openhands: {
    name: 'openhands',
    displayName: 'OpenHands',
    agentsDir: '.openhands/agents',
    globalAgentsDir: join(home, '.openhands/agents'),
    detectInstalled: async () => {
      return existsSync(join(home, '.openhands'));
    },
  },
  pi: {
    name: 'pi',
    displayName: 'Pi',
    agentsDir: '.pi/agents',
    globalAgentsDir: join(home, '.pi/agent/agents'),
    detectInstalled: async () => {
      return existsSync(join(home, '.pi/agent'));
    },
  },
  qoder: {
    name: 'qoder',
    displayName: 'Qoder',
    agentsDir: '.qoder/agents',
    globalAgentsDir: join(home, '.qoder/agents'),
    detectInstalled: async () => {
      return existsSync(join(home, '.qoder'));
    },
  },
  'qwen-code': {
    name: 'qwen-code',
    displayName: 'Qwen Code',
    agentsDir: '.qwen/agents',
    globalAgentsDir: join(home, '.qwen/agents'),
    detectInstalled: async () => {
      return existsSync(join(home, '.qwen'));
    },
  },
  replit: {
    name: 'replit',
    displayName: 'Replit',
    agentsDir: '.agents/agents',
    globalAgentsDir: join(configHome, 'agents/agents'),
    showInUniversalList: false,
    detectInstalled: async () => {
      return existsSync(join(process.cwd(), '.replit'));
    },
  },
  roo: {
    name: 'roo',
    displayName: 'Roo Code',
    agentsDir: '.roo/agents',
    globalAgentsDir: join(home, '.roo/agents'),
    detectInstalled: async () => {
      return existsSync(join(home, '.roo'));
    },
  },
  trae: {
    name: 'trae',
    displayName: 'Trae',
    agentsDir: '.trae/agents',
    globalAgentsDir: join(home, '.trae/agents'),
    detectInstalled: async () => {
      return existsSync(join(home, '.trae'));
    },
  },
  'trae-cn': {
    name: 'trae-cn',
    displayName: 'Trae CN',
    agentsDir: '.trae/agents',
    globalAgentsDir: join(home, '.trae-cn/agents'),
    detectInstalled: async () => {
      return existsSync(join(home, '.trae-cn'));
    },
  },
  warp: {
    name: 'warp',
    displayName: 'Warp',
    agentsDir: '.agents/agents',
    globalAgentsDir: join(home, '.agents/agents'),
    detectInstalled: async () => {
      return existsSync(join(home, '.warp'));
    },
  },
  windsurf: {
    name: 'windsurf',
    displayName: 'Windsurf',
    agentsDir: '.windsurf/agents',
    globalAgentsDir: join(home, '.codeium/windsurf/agents'),
    detectInstalled: async () => {
      return existsSync(join(home, '.codeium/windsurf'));
    },
  },
  zencoder: {
    name: 'zencoder',
    displayName: 'Zencoder',
    agentsDir: '.zencoder/agents',
    globalAgentsDir: join(home, '.zencoder/agents'),
    detectInstalled: async () => {
      return existsSync(join(home, '.zencoder'));
    },
  },
  neovate: {
    name: 'neovate',
    displayName: 'Neovate',
    agentsDir: '.neovate/agents',
    globalAgentsDir: join(home, '.neovate/agents'),
    detectInstalled: async () => {
      return existsSync(join(home, '.neovate'));
    },
  },
  pochi: {
    name: 'pochi',
    displayName: 'Pochi',
    agentsDir: '.pochi/agents',
    globalAgentsDir: join(home, '.pochi/agents'),
    detectInstalled: async () => {
      return existsSync(join(home, '.pochi'));
    },
  },
  adal: {
    name: 'adal',
    displayName: 'AdaL',
    agentsDir: '.adal/agents',
    globalAgentsDir: join(home, '.adal/agents'),
    detectInstalled: async () => {
      return existsSync(join(home, '.adal'));
    },
  },
  universal: {
    name: 'universal',
    displayName: 'Universal',
    agentsDir: '.agents/agents',
    globalAgentsDir: join(configHome, 'agents/agents'),
    showInUniversalList: false,
    detectInstalled: async () => false,
  },
};

export async function detectInstalledTargets(): Promise<TargetType[]> {
  const results = await Promise.all(
    Object.entries(targets).map(async ([type, config]) => ({
      type: type as TargetType,
      installed: await config.detectInstalled(),
    }))
  );
  return results.filter((r) => r.installed).map((r) => r.type);
}

export function getTargetConfig(type: TargetType): TargetConfig {
  return targets[type];
}

/**
 * Returns targets that use the universal .agents/agents directory.
 * These targets share a common agent location and don't need symlinks.
 * Targets with showInUniversalList: false are excluded.
 */
export function getUniversalTargets(): TargetType[] {
  return (Object.entries(targets) as [TargetType, TargetConfig][])
    .filter(
      ([_, config]) => config.agentsDir === '.agents/agents' && config.showInUniversalList !== false
    )
    .map(([type]) => type);
}

/**
 * Returns targets that use target-specific agent directories (not universal).
 * These targets need symlinks from the canonical .agents/agents location.
 */
export function getNonUniversalTargets(): TargetType[] {
  return (Object.entries(targets) as [TargetType, TargetConfig][])
    .filter(([_, config]) => config.agentsDir !== '.agents/agents')
    .map(([type]) => type);
}

/**
 * Check if a target uses the universal .agents/agents directory.
 */
export function isUniversalTarget(type: TargetType): boolean {
  return targets[type].agentsDir === '.agents/agents';
}
