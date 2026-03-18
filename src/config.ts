import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const CONFIG_DIR = join(homedir(), '.skills');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

export interface CliConfig {
  global?: boolean;
  yes?: boolean;
  copy?: boolean;
  json?: boolean;
  agent?: string[];
}

const VALID_KEYS = ['global', 'yes', 'copy', 'json', 'agent'] as const;
type ConfigKey = (typeof VALID_KEYS)[number];

function isValidKey(key: string): key is ConfigKey {
  return (VALID_KEYS as readonly string[]).includes(key);
}

export function loadConfig(): CliConfig {
  try {
    if (!existsSync(CONFIG_FILE)) return {};
    const raw = readFileSync(CONFIG_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    const config: CliConfig = {};
    for (const key of VALID_KEYS) {
      if (key in parsed) {
        (config as Record<string, unknown>)[key] = parsed[key];
      }
    }
    return config;
  } catch {
    return {};
  }
}

export function saveConfig(config: CliConfig): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + '\n', 'utf-8');
}

export function setConfigValue(key: string, value: string | boolean | string[]): void {
  if (!isValidKey(key)) {
    console.error(`Unknown config key: ${key}`);
    console.error(`Valid keys: ${VALID_KEYS.join(', ')}`);
    process.exit(1);
  }
  const config = loadConfig();
  (config as Record<string, unknown>)[key] = value;
  saveConfig(config);
}

export function unsetConfigValue(key: string): void {
  if (!isValidKey(key)) {
    console.error(`Unknown config key: ${key}`);
    console.error(`Valid keys: ${VALID_KEYS.join(', ')}`);
    process.exit(1);
  }
  const config = loadConfig();
  delete (config as Record<string, unknown>)[key];
  saveConfig(config);
}

export function runConfig(args: string[]): void {
  const sub = args[0];

  if (!sub || sub === 'list' || sub === 'ls') {
    const config = loadConfig();
    const entries = Object.entries(config);
    if (entries.length === 0) {
      console.log('No config set. Use `skills config set <key> <value>` to set defaults.');
      return;
    }
    for (const [key, value] of entries) {
      console.log(`${key} = ${JSON.stringify(value)}`);
    }
    return;
  }

  if (sub === 'set') {
    const key = args[1];
    const rawValue = args[2];
    if (!key) {
      console.error('Usage: skills config set <key> <value>');
      console.error(`Valid keys: ${VALID_KEYS.join(', ')}`);
      process.exit(1);
    }
    let value: string | boolean | string[];
    if (key === 'agent') {
      value = args.slice(2);
    } else if (rawValue === 'true' || rawValue === undefined) {
      value = true;
    } else if (rawValue === 'false') {
      value = false;
    } else {
      value = rawValue;
    }
    setConfigValue(key, value);
    console.log(`Set ${key} = ${JSON.stringify(value)}`);
    return;
  }

  if (sub === 'unset' || sub === 'rm') {
    const key = args[1];
    if (!key) {
      console.error('Usage: skills config unset <key>');
      process.exit(1);
    }
    unsetConfigValue(key);
    console.log(`Unset ${key}`);
    return;
  }

  if (sub === 'path') {
    console.log(CONFIG_FILE);
    return;
  }

  console.error(`Unknown config subcommand: ${sub}`);
  console.error('Usage: skills config [list|set|unset|path]');
  process.exit(1);
}
