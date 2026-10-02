import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readTuiPreferences, writeTuiPreferences } from './tui-preferences.ts';

describe('TUI preferences', () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true }))
    );
  });

  async function createPreferencesPath(): Promise<string> {
    const directory = await mkdtemp(join(tmpdir(), 'skills-tui-preferences-'));
    temporaryDirectories.push(directory);
    return join(directory, 'nested', 'tui.json');
  }

  it('saves and restores the selected installed-agent filter', async () => {
    const path = await createPreferencesPath();

    await writeTuiPreferences('codex', path);

    await expect(readTuiPreferences(path)).resolves.toEqual({
      version: 1,
      installedAgentFilter: 'codex',
    });
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({
      version: 1,
      installedAgentFilter: 'codex',
    });
  });

  it('persists the All agents selection as null', async () => {
    const path = await createPreferencesPath();

    await writeTuiPreferences(null, path);

    await expect(readTuiPreferences(path)).resolves.toEqual({
      version: 1,
      installedAgentFilter: null,
    });
  });

  it('falls back safely when the preferences file is malformed', async () => {
    const path = await createPreferencesPath();
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, '{not json', 'utf8');

    await expect(readTuiPreferences(path)).resolves.toEqual({
      version: 1,
      installedAgentFilter: null,
    });
  });
});
