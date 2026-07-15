import { execFile } from 'child_process';
import { access, mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { delimiter, join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { cloneRepo } from '../src/git.ts';

function runGit(args: string[], env: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile('git', args, { env }, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

describe('cloneRepo transport allowlist', () => {
  const tempDirs: string[] = [];
  const originalEnv = {
    GIT_ALLOW_PROTOCOL: process.env.GIT_ALLOW_PROTOCOL,
    GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL,
    GIT_CONFIG_NOSYSTEM: process.env.GIT_CONFIG_NOSYSTEM,
    PATH: process.env.PATH,
    SKILLS_TEST_MARKER: process.env.SKILLS_TEST_MARKER,
  };

  afterEach(async () => {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('overrides inherited allowances for command-capable transports', async () => {
    const root = await mkdtemp(join(tmpdir(), 'skills-transport-test-'));
    tempDirs.push(root);
    const binDir = join(root, 'bin');
    const marker = join(root, 'executed');
    const globalConfig = join(root, 'global.gitconfig');
    const helper = join(
      binDir,
      process.platform === 'win32' ? 'git-remote-skills-test.cmd' : 'git-remote-skills-test'
    );

    await mkdir(binDir);
    await writeFile(
      helper,
      process.platform === 'win32'
        ? '@echo off\r\n> "%SKILLS_TEST_MARKER%" echo executed\r\nexit /b 1\r\n'
        : '#!/bin/sh\nprintf executed > "$SKILLS_TEST_MARKER"\nexit 1\n',
      { mode: 0o755 }
    );
    await writeFile(
      globalConfig,
      '[protocol "skills-test"]\n  allow = always\n[protocol "fd"]\n  allow = always\n'
    );

    process.env.GIT_CONFIG_GLOBAL = globalConfig;
    process.env.GIT_CONFIG_NOSYSTEM = '1';
    process.env.PATH = `${binDir}${delimiter}${originalEnv.PATH ?? ''}`;
    process.env.SKILLS_TEST_MARKER = marker;

    await expect(
      runGit(['clone', 'skills-test::fixture', join(root, 'baseline')], process.env)
    ).rejects.toThrow();
    await expect(access(marker)).resolves.toBeUndefined();
    await rm(marker);

    // Make sure user's env doesn't bypass our allow list
    process.env.GIT_ALLOW_PROTOCOL = 'skills-test:ext:fd';
    await expect(cloneRepo('skills-test::fixture')).rejects.toThrow(/transport .* not allowed/i);
    await expect(cloneRepo('ext::git-remote-skills-test')).rejects.toThrow(
      'Unsupported Git transport: ext'
    );
    await expect(cloneRepo('fd::3')).rejects.toThrow(/transport .* not allowed/i);
    await expect(access(marker)).rejects.toThrow();
  });
});
