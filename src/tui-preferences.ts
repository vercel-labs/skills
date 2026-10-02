import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { xdgConfig } from 'xdg-basedir';
import type { AgentType } from './types.ts';

export interface TuiPreferences {
  version: 1;
  installedAgentFilter: AgentType | null;
}

const DEFAULT_PREFERENCES: TuiPreferences = {
  version: 1,
  installedAgentFilter: null,
};

export function getTuiPreferencesPath(): string {
  const configHome = xdgConfig ?? join(homedir(), '.config');
  return join(configHome, 'skills', 'tui.json');
}

export async function readTuiPreferences(path = getTuiPreferencesPath()): Promise<TuiPreferences> {
  try {
    const value = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
    if (value.version !== 1) return { ...DEFAULT_PREFERENCES };
    if (value.installedAgentFilter !== null && typeof value.installedAgentFilter !== 'string') {
      return { ...DEFAULT_PREFERENCES };
    }
    return {
      version: 1,
      installedAgentFilter: value.installedAgentFilter as AgentType | null,
    };
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}

export async function writeTuiPreferences(
  installedAgentFilter: AgentType | null,
  path = getTuiPreferencesPath()
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const preferences: TuiPreferences = { version: 1, installedAgentFilter };
  await writeFile(path, `${JSON.stringify(preferences, null, 2)}\n`, 'utf8');
}
