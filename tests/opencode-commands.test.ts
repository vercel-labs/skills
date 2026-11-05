import { existsSync } from 'fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { installCommandsForAgent } from '../src/installer.ts';

const temporaryDirs: string[] = [];

const makeTemporaryDir = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), 'skills-commands-test-'));
  temporaryDirs.push(dir);
  return dir;
};

afterEach(async () => {
  await Promise.all(
    temporaryDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))
  );
});

describe('installCommandsForAgent', () => {
  it('copies a repo commands directory into the OpenCode project commands directory', async () => {
    const sourceRepo = await makeTemporaryDir();
    const cwd = await makeTemporaryDir();
    await mkdir(join(sourceRepo, 'commands'), { recursive: true });
    await writeFile(join(sourceRepo, 'commands', 'deep-research.md'), '# deep-research\n');
    await writeFile(join(sourceRepo, 'commands', 'auto-research.md'), '# auto-research\n');

    const result = await installCommandsForAgent(sourceRepo, 'opencode', { cwd });

    expect(result.success).toBe(true);
    expect(result.installed).toEqual(['auto-research', 'deep-research']);
    const installedFile = join(cwd, '.opencode', 'commands', 'deep-research.md');
    expect(existsSync(installedFile)).toBe(true);
    expect(await readFile(installedFile, 'utf8')).toBe('# deep-research\n');
  });

  it('does nothing when the repo has no commands directory', async () => {
    const sourceRepo = await makeTemporaryDir();
    const cwd = await makeTemporaryDir();

    const result = await installCommandsForAgent(sourceRepo, 'opencode', { cwd });

    expect(result.success).toBe(true);
    expect(result.installed).toEqual([]);
    expect(existsSync(join(cwd, '.opencode'))).toBe(false);
  });

  it('does nothing for an agent without a commands directory', async () => {
    const sourceRepo = await makeTemporaryDir();
    const cwd = await makeTemporaryDir();
    await mkdir(join(sourceRepo, 'commands'), { recursive: true });
    await writeFile(join(sourceRepo, 'commands', 'hello.md'), '# hello\n');

    const result = await installCommandsForAgent(sourceRepo, 'amp', { cwd });

    expect(result.success).toBe(true);
    expect(result.installed).toEqual([]);
  });

  it('ignores files that are not markdown', async () => {
    const sourceRepo = await makeTemporaryDir();
    const cwd = await makeTemporaryDir();
    await mkdir(join(sourceRepo, 'commands'), { recursive: true });
    await writeFile(join(sourceRepo, 'commands', 'notes.txt'), 'notes\n');
    await writeFile(join(sourceRepo, 'commands', 'deploy.md'), '# deploy\n');

    const result = await installCommandsForAgent(sourceRepo, 'opencode', { cwd });

    expect(result.installed).toEqual(['deploy']);
    expect(existsSync(join(cwd, '.opencode', 'commands', 'notes.txt'))).toBe(false);
  });
});
