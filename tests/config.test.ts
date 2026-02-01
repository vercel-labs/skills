import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  getUserConfigPath,
  loadUserConfig,
  getDefaultConfig,
  getCanonicalBase,
  convertUserAgentConfig,
  clearConfigCache,
} from '../src/config.ts';
import type { UserConfig, UserAgentConfig } from '../src/types.ts';

describe('config', () => {
  let tempDir: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    originalHome = process.env.HOME;
    tempDir = mkdtempSync(join(tmpdir(), 'skills-config-test-'));
    process.env.HOME = tempDir;
    clearConfigCache();
  });

  afterEach(() => {
    if (originalHome) {
      process.env.HOME = originalHome;
    }
    rmSync(tempDir, { recursive: true, force: true });
    clearConfigCache();
  });

  describe('getUserConfigPath', () => {
    it('should return path in ~/.agents/', () => {
      const path = getUserConfigPath();
      expect(path).toContain('.agents/config.json');
    });
  });

  describe('loadUserConfig', () => {
    it('should return null when no config exists', () => {
      const config = loadUserConfig();
      expect(config).toBeNull();
    });

    it('should load valid config file', () => {
      const configDir = join(tempDir, '.agents');
      mkdirSync(configDir, { recursive: true });

      const testConfig: UserConfig = {
        canonicalBase: '~/custom-agents/skills',
        agents: {
          'test-agent': {
            name: 'test-agent',
            displayName: 'Test Agent',
            skillsDir: '.test/skills',
            globalSkillsDir: '~/.test/skills',
            detectInstalled: {
              type: 'exists',
              paths: ['~/.test'],
            },
          },
        },
      };

      writeFileSync(join(configDir, 'config.json'), JSON.stringify(testConfig), 'utf-8');

      const loaded = loadUserConfig();
      expect(loaded).not.toBeNull();
      expect(loaded?.canonicalBase).toBe('~/custom-agents/skills');
      expect(loaded?.agents?.['test-agent']).toBeDefined();
    });

    it('should return null for invalid config', () => {
      const configDir = join(tempDir, '.agents');
      mkdirSync(configDir, { recursive: true });

      writeFileSync(
        join(configDir, 'config.json'),
        JSON.stringify({ agents: { 'bad-agent': { name: 'bad' } } }),
        'utf-8'
      );

      const loaded = loadUserConfig();
      expect(loaded).toBeNull();
    });

    it('should cache config', () => {
      const configDir = join(tempDir, '.agents');
      mkdirSync(configDir, { recursive: true });

      const testConfig: UserConfig = {
        canonicalBase: '~/test',
      };

      writeFileSync(join(configDir, 'config.json'), JSON.stringify(testConfig), 'utf-8');

      const first = loadUserConfig();
      const second = loadUserConfig();
      expect(first).toBe(second);
    });
  });

  describe('getDefaultConfig', () => {
    it('should return config with canonicalBase', () => {
      const config = getDefaultConfig();
      expect(config.canonicalBase).toBe('~/.agents/skills');
      expect(config.agents).toBeDefined();
    });
  });

  describe('getCanonicalBase', () => {
    it('should return default global base when no config', () => {
      const base = getCanonicalBase(true);
      expect(base).toBe(join(tempDir, '.agents'));
    });

    it('should return default project base when no config', () => {
      const projectDir = join(tempDir, 'my-project');
      mkdirSync(projectDir, { recursive: true });
      const base = getCanonicalBase(false, projectDir);
      expect(base).toBe(join(projectDir, '.agents'));
    });

    it('should return custom global base from global config', () => {
      const configDir = join(tempDir, '.agents');
      mkdirSync(configDir, { recursive: true });

      const testConfig: UserConfig = {
        canonicalBase: '~/my-agents/skills',
      };

      writeFileSync(join(configDir, 'config.json'), JSON.stringify(testConfig), 'utf-8');
      clearConfigCache();

      const base = getCanonicalBase(true);
      expect(base).toBe(join(tempDir, 'my-agents/skills'));
    });

    it('should return custom project base from project config', () => {
      const projectDir = join(tempDir, 'my-project');
      const configDir = join(projectDir, '.agents');
      mkdirSync(configDir, { recursive: true });

      const testConfig: UserConfig = {
        canonicalBase: './custom-agents/skills',
      };

      writeFileSync(join(configDir, 'config.json'), JSON.stringify(testConfig), 'utf-8');
      clearConfigCache();

      const base = getCanonicalBase(false, projectDir);
      expect(base).toBe(join(projectDir, 'custom-agents/skills'));
    });

    it('should expand ~ to home directory in global config', () => {
      const configDir = join(tempDir, '.agents');
      mkdirSync(configDir, { recursive: true });

      const testConfig: UserConfig = {
        canonicalBase: '~/custom/path',
      };

      writeFileSync(join(configDir, 'config.json'), JSON.stringify(testConfig), 'utf-8');
      clearConfigCache();

      const base = getCanonicalBase(true);
      expect(base).toBe(join(tempDir, 'custom/path'));
    });

    it('should expand ~ to home directory in project config', () => {
      const projectDir = join(tempDir, 'my-project');
      const configDir = join(projectDir, '.agents');
      mkdirSync(configDir, { recursive: true });

      const testConfig: UserConfig = {
        canonicalBase: '~/project-global/skills',
      };

      writeFileSync(join(configDir, 'config.json'), JSON.stringify(testConfig), 'utf-8');
      clearConfigCache();

      const base = getCanonicalBase(false, projectDir);
      expect(base).toBe(join(tempDir, 'project-global/skills'));
    });
  });

  describe('convertUserAgentConfig', () => {
    it('should convert user config to full agent config', () => {
      const userAgent: UserAgentConfig = {
        name: 'my-agent',
        displayName: 'My Agent',
        skillsDir: '.my/skills',
        globalSkillsDir: '~/.my/skills',
        detectInstalled: {
          type: 'exists',
          paths: ['~/.my'],
        },
      };

      const agent = convertUserAgentConfig(userAgent);

      expect(agent.name).toBe('my-agent');
      expect(agent.displayName).toBe('My Agent');
      expect(agent.skillsDir).toBe('.my/skills');
      expect(agent.globalSkillsDir).toBe(join(tempDir, '.my/skills'));
      expect(typeof agent.detectInstalled).toBe('function');
    });

    it('should handle undefined globalSkillsDir', () => {
      const userAgent: UserAgentConfig = {
        name: 'my-agent',
        displayName: 'My Agent',
        skillsDir: '.my/skills',
        detectInstalled: {
          type: 'exists',
          paths: ['./.my'],
        },
      };

      const agent = convertUserAgentConfig(userAgent);
      expect(agent.globalSkillsDir).toBeUndefined();
    });

    it('should expand ~ in globalSkillsDir', () => {
      const userAgent: UserAgentConfig = {
        name: 'my-agent',
        displayName: 'My Agent',
        skillsDir: '.my/skills',
        globalSkillsDir: '~/my-global/skills',
        detectInstalled: {
          type: 'exists',
          paths: ['~/.my'],
        },
      };

      const agent = convertUserAgentConfig(userAgent);
      expect(agent.globalSkillsDir).toBe(join(tempDir, 'my-global/skills'));
    });
  });

  describe('detectInstalled strategies', () => {
    it('should detect with exists strategy', async () => {
      const userAgent: UserAgentConfig = {
        name: 'test-agent',
        displayName: 'Test Agent',
        skillsDir: '.test/skills',
        detectInstalled: {
          type: 'exists',
          paths: ['~/.test-config'],
        },
      };

      const agent = convertUserAgentConfig(userAgent);

      expect(await agent.detectInstalled()).toBe(false);

      mkdirSync(join(tempDir, '.test-config'), { recursive: true });

      expect(await agent.detectInstalled()).toBe(true);
    });

    it('should detect with env strategy', async () => {
      const userAgent: UserAgentConfig = {
        name: 'test-agent',
        displayName: 'Test Agent',
        skillsDir: '.test/skills',
        detectInstalled: {
          type: 'env',
          var: 'TEST_AGENT_HOME',
        },
      };

      const agent = convertUserAgentConfig(userAgent);

      delete process.env.TEST_AGENT_HOME;
      expect(await agent.detectInstalled()).toBe(false);

      process.env.TEST_AGENT_HOME = '/some/path';
      expect(await agent.detectInstalled()).toBe(true);

      delete process.env.TEST_AGENT_HOME;
    });
  });
});
