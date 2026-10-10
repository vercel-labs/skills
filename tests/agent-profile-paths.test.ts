import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCli } from '../src/test-utils.ts';

const skillName = 'profile-probe';
const manifest = `---\nname: ${skillName}\ndescription: Active profile test\n---\nTest skill.\n`;
const cases = [
  {
    agent: 'openclaw',
    displayName: 'OpenClaw',
    defaultDir: '.openclaw',
    profileDir: 'work/openclaw',
    envKey: 'OPENCLAW_STATE_DIR',
  },
  {
    agent: 'hermes-agent',
    displayName: 'Hermes Agent',
    defaultDir: process.platform === 'win32' ? 'AppData/Local/hermes' : '.hermes',
    profileDir: process.platform === 'win32' ? 'AppData/Local/hermes-work' : '.hermes-work',
    envKey: 'HERMES_DATA_DIR_SUFFIX',
  },
  {
    agent: 'qwen-code',
    displayName: 'Qwen Code',
    defaultDir: '.qwen',
    profileDir: 'work/qwen',
    envKey: 'QWEN_HOME',
  },
] as const;

describe('global skills in active agent profiles', { timeout: 30000 }, () => {
  let root: string;
  let home: string;
  let project: string;
  let source: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'skills-agent-profile-'));
    home = join(root, 'home');
    project = join(root, 'project');
    source = join(root, 'source');
    for (const dir of [home, project, source]) mkdirSync(dir, { recursive: true });
    writeFileSync(join(source, 'SKILL.md'), manifest);
    mkdirSync(join(source, 'references'));
    writeFileSync(join(source, 'references', 'guide.md'), 'Profile skill resource.\n');
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  for (const { agent, displayName, defaultDir, profileDir, envKey } of cases) {
    for (const mode of ['copy', 'symlink'] as const) {
      it(`${agent}: add, list and remove use the active profile in ${mode} mode`, () => {
        const activeDir = join(home, profileDir, 'skills', skillName);
        const inactiveDir = join(home, defaultDir, 'skills', skillName);
        mkdirSync(inactiveDir, { recursive: true });
        const inactiveManifest = manifest.replace('Test skill.', 'Keep the inactive profile.');
        writeFileSync(join(inactiveDir, 'SKILL.md'), inactiveManifest);
        const env = {
          HOME: home,
          OPENCLAW_HOME: home,
          OPENCLAW_STATE_DIR: '',
          HERMES_HOME: '',
          HERMES_DATA_DIR_SUFFIX: '',
          QWEN_HOME: '',
          [envKey]: envKey === 'HERMES_DATA_DIR_SUFFIX' ? '-work' : join(home, profileDir),
        };
        // Two distinct agent destinations select symlink mode without interactive prompts.
        const targets = mode === 'symlink' ? [agent, 'claude-code'] : [agent];
        const addArgs = ['add', source, '-g', '-y', '-a', ...targets];
        if (mode === 'copy') addArgs.push('--copy');

        for (let attempt = 0; attempt < 2; attempt++) {
          const added = runCli(addArgs, project, env);
          expect(added.exitCode, added.stdout + added.stderr).toBe(0);
          expect(lstatSync(activeDir).isSymbolicLink()).toBe(mode === 'symlink');
          expect(readFileSync(join(activeDir, 'SKILL.md'), 'utf-8')).toBe(manifest);
          expect(readFileSync(join(activeDir, 'references', 'guide.md'), 'utf-8')).toBe(
            'Profile skill resource.\n'
          );
          expect(readFileSync(join(inactiveDir, 'SKILL.md'), 'utf-8')).toBe(inactiveManifest);
        }

        const listed = runCli(['list', '-g', '-a', agent, '--json'], project, env);
        expect(listed.exitCode, listed.stderr).toBe(0);
        expect(JSON.parse(listed.stdout)).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              name: skillName,
              agents: expect.arrayContaining([displayName]),
            }),
          ])
        );

        const removed = runCli(['remove', skillName, '-g', '-y', '-a', agent], project, env);
        expect(removed.exitCode, removed.stdout + removed.stderr).toBe(0);
        expect(existsSync(activeDir)).toBe(false);
        expect(readFileSync(join(inactiveDir, 'SKILL.md'), 'utf-8')).toBe(inactiveManifest);
      });
    }
  }
});
