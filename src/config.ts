import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { existsSync as fsExistsSync } from 'fs';
import type { UserConfig, UserAgentConfig, AgentConfig, DetectStrategy } from './types.ts';
import { AGENTS_DIR, CONFIG_FILE } from './constants.ts';

let cachedGlobalConfig: UserConfig | null = null;
let cachedProjectConfig: UserConfig | null = null;
let cachedProjectPath: string | null = null;

function getGlobalConfigPath(): string {
  return join(homedir(), AGENTS_DIR, CONFIG_FILE);
}

function getProjectConfigPath(cwd?: string): string {
  const baseDir = cwd || process.cwd();
  return join(baseDir, AGENTS_DIR, CONFIG_FILE);
}

function loadConfigFromPath(configPath: string): UserConfig | null {
  if (!existsSync(configPath)) {
    return null;
  }

  try {
    const content = readFileSync(configPath, 'utf-8');
    const config = JSON.parse(content) as UserConfig;

    if (config.agents) {
      for (const [key, agent] of Object.entries(config.agents)) {
        if (!agent.name || !agent.displayName || !agent.skillsDir) {
          console.warn(`Invalid agent config for "${key}": missing required fields`);
          return null;
        }
        if (!agent.detectInstalled || !agent.detectInstalled.type) {
          console.warn(`Invalid agent config for "${key}": missing detectInstalled strategy`);
          return null;
        }
      }
    }

    return config;
  } catch {
    return null;
  }
}

export function getUserConfigPath(): string {
  return getGlobalConfigPath();
}

export function loadUserConfig(): UserConfig | null {
  if (cachedGlobalConfig !== null) {
    return cachedGlobalConfig;
  }

  const configPath = getGlobalConfigPath();
  cachedGlobalConfig = loadConfigFromPath(configPath);
  return cachedGlobalConfig;
}

export function loadProjectConfig(cwd?: string): UserConfig | null {
  const projectPath = cwd || process.cwd();

  if (cachedProjectPath === projectPath && cachedProjectConfig !== null) {
    return cachedProjectConfig;
  }

  const configPath = getProjectConfigPath(projectPath);
  cachedProjectPath = projectPath;
  cachedProjectConfig = loadConfigFromPath(configPath);
  return cachedProjectConfig;
}

export function clearConfigCache(): void {
  cachedGlobalConfig = null;
  cachedProjectConfig = null;
  cachedProjectPath = null;
}

export function getCanonicalBase(global: boolean, cwd?: string): string {
  if (global) {
    const globalConfig = loadUserConfig();
    if (globalConfig?.canonicalBase) {
      if (globalConfig.canonicalBase.startsWith('~/')) {
        return join(homedir(), globalConfig.canonicalBase.slice(2));
      }
      return globalConfig.canonicalBase;
    }
    return join(homedir(), AGENTS_DIR);
  }

  const projectConfig = loadProjectConfig(cwd);
  if (projectConfig?.canonicalBase) {
    const baseDir = cwd || process.cwd();
    if (projectConfig.canonicalBase.startsWith('~/')) {
      return join(homedir(), projectConfig.canonicalBase.slice(2));
    }
    if (projectConfig.canonicalBase.startsWith('./')) {
      return join(baseDir, projectConfig.canonicalBase.slice(2));
    }
    return projectConfig.canonicalBase;
  }

  const baseDir = cwd || process.cwd();
  return join(baseDir, AGENTS_DIR);
}

function createDetectInstalled(strategy: DetectStrategy): () => Promise<boolean> {
  return async (): Promise<boolean> => {
    switch (strategy.type) {
      case 'exists': {
        const paths = strategy.paths.map((p) => {
          if (p.startsWith('~/')) {
            return join(homedir(), p.slice(2));
          }
          if (p.startsWith('./')) {
            return join(process.cwd(), p.slice(2));
          }
          return p;
        });
        return paths.some((p) => fsExistsSync(p));
      }
      case 'command': {
        try {
          const { execSync } = await import('child_process');
          execSync(`which ${strategy.cmd}`, { stdio: 'ignore' });
          return true;
        } catch {
          return false;
        }
      }
      case 'env': {
        return process.env[strategy.var] !== undefined;
      }
      default:
        return false;
    }
  };
}

export function convertUserAgentConfig(userConfig: UserAgentConfig): AgentConfig {
  const globalSkillsDir = userConfig.globalSkillsDir
    ? userConfig.globalSkillsDir.startsWith('~/')
      ? join(homedir(), userConfig.globalSkillsDir.slice(2))
      : userConfig.globalSkillsDir
    : undefined;

  return {
    name: userConfig.name,
    displayName: userConfig.displayName,
    skillsDir: userConfig.skillsDir,
    globalSkillsDir,
    detectInstalled: createDetectInstalled(userConfig.detectInstalled),
  };
}

export function getDefaultConfig(): UserConfig {
  return {
    canonicalBase: '~/.agents/skills',
    agents: {
      'my-custom-agent': {
        name: 'my-custom-agent',
        displayName: 'My Custom Agent',
        skillsDir: '.myagent/skills',
        globalSkillsDir: '~/.myagent/skills',
        detectInstalled: {
          type: 'exists',
          paths: ['~/.myagent', './.myagent'],
        },
      },
    },
  };
}
