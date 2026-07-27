import { homedir } from 'os';
import { join } from 'path';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { xdgConfig } from 'xdg-basedir';
import type { AgentConfig, AgentType } from './types.ts';

const home = homedir();
// Use xdg-basedir (not env-paths) to match OpenCode/Amp/Goose behavior on all platforms.
const configHome = xdgConfig ?? join(home, '.config');
const codexHome = process.env.CODEX_HOME?.trim() || join(home, '.codex');
const claudeHome = process.env.CLAUDE_CONFIG_DIR?.trim() || join(home, '.claude');
const vibeHome = process.env.VIBE_HOME?.trim() || join(home, '.vibe');
const hermesHome = process.env.HERMES_HOME?.trim() || join(home, '.hermes');
const autohandHome = process.env.AUTOHAND_HOME?.trim() || join(home, '.autohand');
const grokHome = process.env.GROK_HOME?.trim() || join(home, '.grok');
const zedAppDataHome = process.env.APPDATA?.trim();
const zedFlatpakConfigHome = process.env.FLATPAK_XDG_CONFIG_HOME?.trim();

function packageJsonHasDependency(packageJsonPath: string, dependencyName: string): boolean {
  try {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8')) as {
      dependencies?: Record<string, unknown>;
      devDependencies?: Record<string, unknown>;
    };
    return !!(
      packageJson.dependencies?.[dependencyName] || packageJson.devDependencies?.[dependencyName]
    );
  } catch {
    return false;
  }
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

export function isZCodeInstalled(
  homeDir = home,
  pathExists: (path: string) => boolean = existsSync
) {
  return pathExists(join(homeDir, '.zcode')) || pathExists('/Applications/ZCode.app');
}

export function isKimchiInstalled(
  homeDir = home,
  pathExists: (path: string) => boolean = existsSync
) {
  return pathExists(join(homeDir, '.config', 'kimchi'));
}

export const agents: Record<AgentType, AgentConfig> = {
  'aider-desk': {
    name: 'aider-desk',
    displayName: 'AiderDesk',
    skillsDir: '.aider-desk/skills',
    globalSkillsDir: join(home, '.aider-desk/skills'),
    detectInstalled: async () => {
      return existsSync(join(home, '.aider-desk'));
    },
  },
  amp: {
    name: 'amp',
    displayName: 'Amp',
    skillsDir: '.agents/skills',
    globalSkillsDir: join(configHome, 'agents/skills'),
    detectInstalled: async () => {
      return existsSync(join(configHome, 'amp'));
    },
  },
  antigravity: {
    name: 'antigravity',
    displayName: 'Antigravity',
    skillsDir: '.agents/skills',
    globalSkillsDir: join(home, '.gemini/antigravity/skills'),
    detectInstalled: async () => {
      return existsSync(join(home, '.gemini/antigravity'));
    },
  },
  'antigravity-cli': {
    name: 'antigravity-cli',
    displayName: 'Antigravity CLI',
    skillsDir: '.agents/skills',
    globalSkillsDir: join(home, '.gemini/antigravity-cli/skills'),
    detectInstalled: async () => {
      return existsSync(join(home, '.gemini/antigravity-cli'));
    },
  },
  astrbot: {
    name: 'astrbot',
    displayName: 'AstrBot',
    skillsDir: 'data/skills',
    globalSkillsDir: join(home, '.astrbot/data/skills'),
    detectInstalled: async () => {
      return existsSync(join(process.cwd(), 'data/skills')) || existsSync(join(home, '.astrbot'));
    },
  },
  'autohand-code': {
    name: 'autohand-code',
    displayName: 'Autohand Code CLI',
    skillsDir: '.autohand/skills',
    globalSkillsDir: join(autohandHome, 'skills'),
    detectInstalled: async () => {
      return existsSync(autohandHome);
    },
  },
  augment: {
    name: 'augment',
    displayName: 'Augment',
    skillsDir: '.augment/skills',
    globalSkillsDir: join(home, '.augment/skills'),
    detectInstalled: async () => {
      return existsSync(join(home, '.augment'));
    },
  },
  bob: {
    name: 'bob',
    displayName: 'IBM Bob',
    skillsDir: '.bob/skills',
    globalSkillsDir: join(home, '.bob/skills'),
    detectInstalled: async () => {
      return existsSync(join(home, '.bob'));
    },
  },
  'claude-code': {
    name: 'claude-code',
    displayName: 'Claude Code',
    skillsDir: '.claude/skills',
    globalSkillsDir: join(claudeHome, 'skills'),
    detectInstalled: async () => {
      return existsSync(claudeHome);
    },
  },
  openclaw: {
    name: 'openclaw',
    displayName: 'OpenClaw',
    skillsDir: 'skills',
    globalSkillsDir: getOpenClawGlobalSkillsDir(),
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
    skillsDir: '.agents/skills',
    globalSkillsDir: join(home, '.agents', 'skills'),
    detectInstalled: async () => {
      return existsSync(join(home, '.cline'));
    },
  },
  'codearts-agent': {
    name: 'codearts-agent',
    displayName: 'CodeArts Agent',
    skillsDir: '.codeartsdoer/skills',
    globalSkillsDir: join(home, '.codeartsdoer/skills'),
    detectInstalled: async () => {
      return existsSync(join(home, '.codeartsdoer'));
    },
  },
  codebuddy: {
    name: 'codebuddy',
    displayName: 'CodeBuddy',
    skillsDir: '.codebuddy/skills',
    globalSkillsDir: join(home, '.codebuddy/skills'),
    detectInstalled: async () => {
      return existsSync(join(process.cwd(), '.codebuddy')) || existsSync(join(home, '.codebuddy'));
    },
  },
  codemaker: {
    name: 'codemaker',
    displayName: 'Codemaker',
    skillsDir: '.codemaker/skills',
    globalSkillsDir: join(home, '.codemaker/skills'),
    detectInstalled: async () => {
      return existsSync(join(home, '.codemaker'));
    },
  },
  codestudio: {
    name: 'codestudio',
    displayName: 'Code Studio',
    skillsDir: '.codestudio/skills',
    globalSkillsDir: join(home, '.codestudio/skills'),
    detectInstalled: async () => {
      return existsSync(join(home, '.codestudio'));
    },
  },
  codex: {
    name: 'codex',
    displayName: 'Codex',
    skillsDir: '.agents/skills',
    globalSkillsDir: join(codexHome, 'skills'),
    detectInstalled: async () => {
      return existsSync(codexHome) || existsSync('/etc/codex');
    },
  },
  'command-code': {
    name: 'command-code',
    displayName: 'Command Code',
    skillsDir: '.commandcode/skills',
    globalSkillsDir: join(home, '.commandcode/skills'),
    detectInstalled: async () => {
      return existsSync(join(home, '.commandcode'));
    },
  },
  continue: {
    name: 'continue',
    displayName: 'Continue',
    skillsDir: '.continue/skills',
    globalSkillsDir: join(home, '.continue/skills'),
    detectInstalled: async () => {
      return existsSync(join(process.cwd(), '.continue')) || existsSync(join(home, '.continue'));
    },
  },
  cortex: {
    name: 'cortex',
    displayName: 'Cortex Code',
    skillsDir: '.cortex/skills',
    globalSkillsDir: join(home, '.snowflake/cortex/skills'),
    detectInstalled: async () => {
      return existsSync(join(home, '.snowflake/cortex'));
    },
  },
  crush: {
    name: 'crush',
    displayName: 'Crush',
    skillsDir: '.crush/skills',
    globalSkillsDir: join(home, '.config/crush/skills'),
    detectInstalled: async () => {
      return existsSync(join(home, '.config/crush'));
    },
  },
  cursor: {
    name: 'cursor',
    displayName: 'Cursor',
    skillsDir: '.agents/skills',
    globalSkillsDir: join(home, '.cursor/skills'),
    detectInstalled: async () => {
      return existsSync(join(home, '.cursor'));
    },
  },
  deepagents: {
    name: 'deepagents',
    displayName: 'Deep Agents',
    skillsDir: '.agents/skills',
    globalSkillsDir: join(home, '.deepagents/agent/skills'),
    detectInstalled: async () => {
      return existsSync(join(home, '.deepagents'));
    },
  },
  devin: {
    name: 'devin',
    displayName: 'Devin for Terminal',
    skillsDir: '.devin/skills',
    globalSkillsDir: join(configHome, 'devin/skills'),
    detectInstalled: async () => {
      return existsSync(join(configHome, 'devin'));
    },
  },
  dexto: {
    name: 'dexto',
    displayName: 'Dexto',
    skillsDir: '.agents/skills',
    globalSkillsDir: join(home, '.agents/skills'),
    showInUniversalPrompt: false,
    detectInstalled: async () => {
      return existsSync(join(home, '.dexto'));
    },
  },
  droid: {
    name: 'droid',
    displayName: 'Droid',
    skillsDir: '.factory/skills',
    globalSkillsDir: join(home, '.factory/skills'),
    detectInstalled: async () => {
      return existsSync(join(home, '.factory'));
    },
  },
  eve: {
    name: 'eve',
    displayName: 'Eve',
    skillsDir: 'agent/skills',
    globalSkillsDir: undefined,
    detectInstalled: async () => {
      const cwd = process.cwd();
      return (
        existsSync(join(cwd, 'agent')) && packageJsonHasDependency(join(cwd, 'package.json'), 'eve')
      );
    },
  },
  firebender: {
    name: 'firebender',
    displayName: 'Firebender',
    skillsDir: '.agents/skills',
    globalSkillsDir: join(home, '.firebender/skills'),
    showInUniversalPrompt: false,
    detectInstalled: async () => {
      return existsSync(join(home, '.firebender'));
    },
  },
  forgecode: {
    name: 'forgecode',
    displayName: 'ForgeCode',
    skillsDir: '.forge/skills',
    globalSkillsDir: join(home, '.forge/skills'),
    detectInstalled: async () => {
      return existsSync(join(home, '.forge'));
    },
  },
  'gemini-cli': {
    name: 'gemini-cli',
    displayName: 'Gemini CLI',
    skillsDir: '.agents/skills',
    globalSkillsDir: join(home, '.gemini/skills'),
    detectInstalled: async () => {
      return existsSync(join(home, '.gemini'));
    },
  },
  'github-copilot': {
    name: 'github-copilot',
    displayName: 'GitHub Copilot',
    skillsDir: '.agents/skills',
    globalSkillsDir: join(home, '.copilot/skills'),
    detectInstalled: async () => {
      return existsSync(join(home, '.copilot'));
    },
  },
  goose: {
    name: 'goose',
    displayName: 'Goose',
    skillsDir: '.goose/skills',
    globalSkillsDir: join(configHome, 'goose/skills'),
    detectInstalled: async () => {
      return existsSync(join(configHome, 'goose'));
    },
  },
  grok: {
    name: 'grok',
    displayName: 'Grok Build',
    skillsDir: '.grok/skills',
    globalSkillsDir: join(grokHome, 'skills'),
    detectInstalled: async () => {
      return existsSync(grokHome);
    },
  },
  'hermes-agent': {
    name: 'hermes-agent',
    displayName: 'Hermes Agent',
    skillsDir: '.hermes/skills',
    globalSkillsDir: join(hermesHome, 'skills'),
    detectInstalled: async () => {
      return existsSync(hermesHome);
    },
  },
  'inference-sh': {
    name: 'inference-sh',
    displayName: 'inference.sh',
    skillsDir: '.inferencesh/skills',
    globalSkillsDir: join(home, '.inferencesh/skills'),
    detectInstalled: async () => {
      return existsSync(join(home, '.inferencesh'));
    },
  },
  jazz: {
    name: 'jazz',
    displayName: 'Jazz',
    skillsDir: '.jazz/skills',
    globalSkillsDir: join(home, '.jazz/skills'),
    detectInstalled: async () => {
      return existsSync(join(home, '.jazz')) || existsSync(join(process.cwd(), '.jazz'));
    },
  },
  junie: {
    name: 'junie',
    displayName: 'Junie',
    skillsDir: '.junie/skills',
    globalSkillsDir: join(home, '.junie/skills'),
    detectInstalled: async () => {
      return existsSync(join(home, '.junie'));
    },
  },
  'iflow-cli': {
    name: 'iflow-cli',
    displayName: 'iFlow CLI',
    skillsDir: '.iflow/skills',
    globalSkillsDir: join(home, '.iflow/skills'),
    detectInstalled: async () => {
      return existsSync(join(home, '.iflow'));
    },
  },
  kilo: {
    name: 'kilo',
    displayName: 'Kilo Code',
    skillsDir: '.kilocode/skills',
    globalSkillsDir: join(home, '.kilocode/skills'),
    detectInstalled: async () => {
      return existsSync(join(home, '.kilocode'));
    },
  },
  kimchi: {
    name: 'kimchi',
    displayName: 'Kimchi',
    skillsDir: '.kimchi/skills',
    globalSkillsDir: join(home, '.config', 'kimchi', 'harness', 'skills'),
    detectInstalled: async () => {
      return isKimchiInstalled();
    },
  },
  'kimi-code-cli': {
    name: 'kimi-code-cli',
    displayName: 'Kimi Code CLI',
    skillsDir: '.agents/skills',
    globalSkillsDir: join(home, '.agents/skills'),
    detectInstalled: async () => {
      return existsSync(join(home, '.kimi-code')) || existsSync(join(home, '.kimi'));
    },
  },
  'kiro-cli': {
    name: 'kiro-cli',
    displayName: 'Kiro CLI',
    skillsDir: '.kiro/skills',
    globalSkillsDir: join(home, '.kiro/skills'),
    detectInstalled: async () => {
      return existsSync(join(home, '.kiro'));
    },
  },
  kode: {
    name: 'kode',
    displayName: 'Kode',
    skillsDir: '.kode/skills',
    globalSkillsDir: join(home, '.kode/skills'),
    detectInstalled: async () => {
      return existsSync(join(home, '.kode'));
    },
  },
  lingma: {
    name: 'lingma',
    displayName: 'Lingma',
    skillsDir: '.lingma/skills',
    globalSkillsDir: join(home, '.lingma/skills'),
    detectInstalled: async () => {
      return existsSync(join(home, '.lingma'));
    },
  },
  loaf: {
    name: 'loaf',
    displayName: 'Loaf',
    skillsDir: '.agents/skills',
    globalSkillsDir: join(home, '.agents/skills'),
    showInUniversalPrompt: false,
    detectInstalled: async () => {
      return existsSync(join(home, '.loaf'));
    },
  },
  mcpjam: {
    name: 'mcpjam',
    displayName: 'MCPJam',
    skillsDir: '.mcpjam/skills',
    globalSkillsDir: join(home, '.mcpjam/skills'),
    detectInstalled: async () => {
      return existsSync(join(home, '.mcpjam'));
    },
  },
  'mistral-vibe': {
    name: 'mistral-vibe',
    displayName: 'Mistral Vibe',
    skillsDir: '.vibe/skills',
    globalSkillsDir: join(vibeHome, 'skills'),
    detectInstalled: async () => {
      return existsSync(vibeHome);
    },
  },
  moxby: {
    name: 'moxby',
    displayName: 'Moxby',
    skillsDir: '.moxby/skills',
    globalSkillsDir: join(home, '.moxby/skills'),
    detectInstalled: async () => {
      return existsSync(join(home, '.moxby'));
    },
  },
  mux: {
    name: 'mux',
    displayName: 'Mux',
    skillsDir: '.mux/skills',
    globalSkillsDir: join(home, '.mux/skills'),
    detectInstalled: async () => {
      return existsSync(join(home, '.mux'));
    },
  },
  opencode: {
    name: 'opencode',
    displayName: 'OpenCode',
    skillsDir: '.agents/skills',
    globalSkillsDir: join(configHome, 'opencode/skills'),
    detectInstalled: async () => {
      return existsSync(join(configHome, 'opencode'));
    },
  },
  openhands: {
    name: 'openhands',
    displayName: 'OpenHands',
    skillsDir: '.openhands/skills',
    globalSkillsDir: join(home, '.openhands/skills'),
    detectInstalled: async () => {
      return existsSync(join(home, '.openhands'));
    },
  },
  ona: {
    name: 'ona',
    displayName: 'Ona',
    skillsDir: '.ona/skills',
    globalSkillsDir: join(home, '.ona/skills'),
    detectInstalled: async () => {
      return existsSync(join(home, '.ona'));
    },
  },
  pi: {
    name: 'pi',
    displayName: 'Pi',
    skillsDir: '.pi/skills',
    globalSkillsDir: join(home, '.pi/agent/skills'),
    detectInstalled: async () => {
      return existsSync(join(home, '.pi/agent'));
    },
  },
  qoder: {
    name: 'qoder',
    displayName: 'Qoder',
    skillsDir: '.qoder/skills',
    globalSkillsDir: join(home, '.qoder/skills'),
    detectInstalled: async () => {
      return existsSync(join(home, '.qoder'));
    },
  },
  'qoder-cn': {
    name: 'qoder-cn',
    displayName: 'Qoder CN',
    skillsDir: '.qoder/skills',
    globalSkillsDir: join(home, '.qoder-cn/skills'),
    detectInstalled: async () => {
      return existsSync(join(home, '.qoder-cn'));
    },
  },
  'qwen-code': {
    name: 'qwen-code',
    displayName: 'Qwen Code',
    skillsDir: '.qwen/skills',
    globalSkillsDir: join(home, '.qwen/skills'),
    detectInstalled: async () => {
      return existsSync(join(home, '.qwen'));
    },
  },
  replit: {
    name: 'replit',
    displayName: 'Replit',
    skillsDir: '.agents/skills',
    globalSkillsDir: join(configHome, 'agents/skills'),
    showInUniversalList: false,
    detectInstalled: async () => {
      return existsSync(join(process.cwd(), '.replit'));
    },
  },
  reasonix: {
    name: 'reasonix',
    displayName: 'Reasonix',
    skillsDir: '.reasonix/skills',
    globalSkillsDir: join(home, '.reasonix/skills'),
    detectInstalled: async () => {
      return existsSync(join(home, '.reasonix'));
    },
  },
  rovodev: {
    name: 'rovodev',
    displayName: 'Rovo Dev',
    skillsDir: '.rovodev/skills',
    globalSkillsDir: join(home, '.rovodev/skills'),
    detectInstalled: async () => {
      return existsSync(join(home, '.rovodev'));
    },
  },
  roo: {
    name: 'roo',
    displayName: 'Roo Code',
    skillsDir: '.roo/skills',
    globalSkillsDir: join(home, '.roo/skills'),
    detectInstalled: async () => {
      return existsSync(join(home, '.roo'));
    },
  },
  'tabnine-cli': {
    name: 'tabnine-cli',
    displayName: 'Tabnine CLI',
    skillsDir: '.tabnine/agent/skills',
    globalSkillsDir: join(home, '.tabnine/agent/skills'),
    detectInstalled: async () => {
      return existsSync(join(home, '.tabnine'));
    },
  },
  terramind: {
    name: 'terramind',
    displayName: 'Terramind',
    skillsDir: '.terramind/skills',
    globalSkillsDir: join(home, '.terramind/skills'),
    detectInstalled: async () => {
      return existsSync(join(home, '.terramind'));
    },
  },
  tinycloud: {
    name: 'tinycloud',
    displayName: 'Tinycloud',
    skillsDir: '.tinycloud/skills',
    globalSkillsDir: join(home, '.tinycloud/skills'),
    detectInstalled: async () => {
      return existsSync(join(home, '.tinycloud'));
    },
  },
  trae: {
    name: 'trae',
    displayName: 'Trae',
    skillsDir: '.trae/skills',
    globalSkillsDir: join(home, '.trae/skills'),
    detectInstalled: async () => {
      return existsSync(join(home, '.trae'));
    },
  },
  'trae-cn': {
    name: 'trae-cn',
    displayName: 'Trae CN',
    skillsDir: '.trae/skills',
    globalSkillsDir: join(home, '.trae-cn/skills'),
    detectInstalled: async () => {
      return existsSync(join(home, '.trae-cn'));
    },
  },
  warp: {
    name: 'warp',
    displayName: 'Warp',
    skillsDir: '.agents/skills',
    globalSkillsDir: join(home, '.agents/skills'),
    detectInstalled: async () => {
      return existsSync(join(home, '.warp'));
    },
  },
  windsurf: {
    name: 'windsurf',
    displayName: 'Windsurf',
    skillsDir: '.windsurf/skills',
    globalSkillsDir: join(home, '.codeium/windsurf/skills'),
    detectInstalled: async () => {
      return existsSync(join(home, '.codeium/windsurf'));
    },
  },
  zed: {
    name: 'zed',
    displayName: 'Zed',
    skillsDir: '.agents/skills',
    globalSkillsDir: join(home, '.agents/skills'),
    detectInstalled: async () => {
      // Per Zed's config_dir() in crates/paths/src/paths.rs.
      return (
        existsSync(join(configHome, 'zed')) ||
        (!!zedAppDataHome && existsSync(join(zedAppDataHome, 'Zed'))) ||
        (!!zedFlatpakConfigHome && existsSync(join(zedFlatpakConfigHome, 'zed')))
      );
    },
  },
  zcode: {
    name: 'zcode',
    displayName: 'ZCode',
    skillsDir: '.zcode/skills',
    globalSkillsDir: join(home, '.zcode/skills'),
    detectInstalled: async () => {
      return isZCodeInstalled();
    },
  },
  zencoder: {
    name: 'zencoder',
    displayName: 'Zencoder',
    skillsDir: '.zencoder/skills',
    globalSkillsDir: join(home, '.zencoder/skills'),
    detectInstalled: async () => {
      return existsSync(join(home, '.zencoder'));
    },
  },
  zenflow: {
    name: 'zenflow',
    displayName: 'Zenflow',
    skillsDir: '.zencoder/skills',
    globalSkillsDir: join(home, '.zencoder/skills'),
    detectInstalled: async () => {
      return existsSync(join(home, '.zencoder'));
    },
  },
  neovate: {
    name: 'neovate',
    displayName: 'Neovate',
    skillsDir: '.neovate/skills',
    globalSkillsDir: join(home, '.neovate/skills'),
    detectInstalled: async () => {
      return existsSync(join(home, '.neovate'));
    },
  },
  pochi: {
    name: 'pochi',
    displayName: 'Pochi',
    skillsDir: '.pochi/skills',
    globalSkillsDir: join(home, '.pochi/skills'),
    detectInstalled: async () => {
      return existsSync(join(home, '.pochi'));
    },
  },
  promptscript: {
    name: 'promptscript',
    displayName: 'PromptScript',
    skillsDir: '.agents/skills',
    globalSkillsDir: undefined,
    showInUniversalPrompt: false,
    detectInstalled: async () => {
      return (
        existsSync(join(process.cwd(), '.promptscript')) ||
        existsSync(join(process.cwd(), 'promptscript.yaml'))
      );
    },
  },
  adal: {
    name: 'adal',
    displayName: 'AdaL',
    skillsDir: '.adal/skills',
    globalSkillsDir: join(home, '.adal/skills'),
    detectInstalled: async () => {
      return existsSync(join(home, '.adal'));
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
 * Directory (relative to an Eve project root) that holds subagents.
 * Each subagent owns its own skills at `agent/subagents/<name>/skills`,
 * mirroring the root agent's `agent/skills`.
 */
export const EVE_SUBAGENTS_DIR = join('agent', 'subagents');

/**
 * Discover the names of Eve subagents in a project.
 *
 * Eve supports subagents that each have their own skills directory at
 * `agent/subagents/<name>/skills`. This returns the `<name>` of every
 * subagent directory found under `agent/subagents/`, sorted alphabetically.
 * Returns an empty list when the directory doesn't exist or can't be read.
 */
export function getEveSubagents(cwd: string = process.cwd()): string[] {
  const dir = join(cwd, EVE_SUBAGENTS_DIR);
  if (!existsSync(dir)) {
    return [];
  }
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
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
 * Returns the subset of universal agents shown in the interactive locked section.
 * All universal agents are still installed; this only keeps the prompt readable.
 */
export function getVisibleUniversalAgents(): AgentType[] {
  return (Object.entries(agents) as [AgentType, AgentConfig][])
    .filter(
      ([_, config]) =>
        config.skillsDir === '.agents/skills' &&
        config.showInUniversalList !== false &&
        config.showInUniversalPrompt !== false
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
