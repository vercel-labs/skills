import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { runCli } from './test-utils.ts';
import {
  buildUsePrompt,
  materializeUseSkill,
  parseUseOptions,
  launchAgentInteractively,
  type AgentProcess,
  type AgentSpawn,
  type UseSkill,
} from './use.ts';

describe('use command', () => {
  let testDir: string;
  const cleanupDirs: string[] = [];

  beforeEach(() => {
    testDir = join(
      tmpdir(),
      `skills-use-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    for (const dir of cleanupDirs.splice(0)) {
      if (existsSync(dir)) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('parseUseOptions', () => {
    it('parses owner/repo@skill as the source', () => {
      const result = parseUseOptions(['vercel-labs/agent-skills@web-design-guidelines']);

      expect(result.source).toEqual(['vercel-labs/agent-skills@web-design-guidelines']);
      expect(result.options.skill).toBeUndefined();
      expect(result.errors).toEqual([]);
    });

    it('parses --skill and -s selectors', () => {
      const longFlag = parseUseOptions([
        'vercel-labs/agent-skills',
        '--skill',
        'web-design-guidelines',
      ]);
      const shortFlag = parseUseOptions([
        'vercel-labs/agent-skills',
        '-s',
        'web-design-guidelines',
      ]);

      expect(longFlag.options.skill).toBe('web-design-guidelines');
      expect(shortFlag.options.skill).toBe('web-design-guidelines');
      expect(longFlag.errors).toEqual([]);
      expect(shortFlag.errors).toEqual([]);
    });

    it('rejects repeated skill selectors and unknown flags', () => {
      const result = parseUseOptions([
        'vercel-labs/agent-skills',
        '--skill',
        'one',
        '--skill',
        'two',
        '--wat',
      ]);

      expect(result.errors).toContain('Only one --skill value can be provided');
      expect(result.errors).toContain('Unknown option: --wat');
    });

    it('parses --agent and -a values', () => {
      const longFlag = parseUseOptions(['vercel-labs/agent-skills', '--agent', 'claude-code']);
      const shortFlag = parseUseOptions(['vercel-labs/agent-skills', '-a', 'codex']);

      expect(longFlag.options.agent).toEqual(['claude-code']);
      expect(shortFlag.options.agent).toEqual(['codex']);
      expect(longFlag.errors).toEqual([]);
      expect(shortFlag.errors).toEqual([]);
    });

    it('rejects wildcard, missing, invalid, and multiple agents', () => {
      const wildcard = parseUseOptions(['source', '--agent', '*']);
      const missing = parseUseOptions(['source', '--agent', '--skill', 'web-design-guidelines']);
      const invalid = parseUseOptions(['source', '--agent', 'not-an-agent']);
      const multiple = parseUseOptions(['source', '--agent', 'claude-code', 'codex']);

      expect(wildcard.errors).toContain(
        "skills use --agent does not support '*'; specify exactly one agent."
      );
      expect(missing.errors).toContain('--agent requires an agent name');
      expect(invalid.errors.join('\n')).toContain('Invalid agents: not-an-agent');
      expect(multiple.errors).toContain('skills use --agent accepts exactly one agent.');
    });
  });

  describe('buildUsePrompt', () => {
    it('inlines SKILL.md without support directory when there are no supporting files', () => {
      const prompt = buildUsePrompt({
        skillMd: '# Skill\nDo the thing.',
        hasSupportingFiles: false,
      });

      expect(prompt).toContain('<SKILL.md>\n# Skill\nDo the thing.\n</SKILL.md>');
      expect(prompt).not.toContain('Supporting files for this skill were downloaded to:');
    });

    it('includes support directory when supporting files exist', () => {
      const prompt = buildUsePrompt({
        skillMd: '# Skill',
        supportDir: '/tmp/skills-use-abc/my-skill',
        hasSupportingFiles: true,
      });

      expect(prompt).toContain('/tmp/skills-use-abc/my-skill');
      expect(prompt).toContain('When the SKILL.md references relative paths');
    });
  });

  describe('materializeUseSkill', () => {
    it('writes blob-shaped files to a skills-use temp directory', async () => {
      const skill: UseSkill = {
        kind: 'blob',
        name: 'Blob Skill',
        directoryName: 'Blob Skill',
        rawContent: '# Blob Skill',
        files: [
          { path: 'SKILL.md', contents: '# Blob Skill' },
          { path: 'scripts/run.sh', contents: 'echo hi' },
        ],
      };

      const materialized = await materializeUseSkill(skill);
      cleanupDirs.push(materialized.tempRoot);

      expect(materialized.skillDir).toContain('skills-use-');
      expect(readFileSync(join(materialized.skillDir, 'scripts', 'run.sh'), 'utf-8')).toBe(
        'echo hi'
      );
      expect(materialized.hasSupportingFiles).toBe(true);
    });

    it('writes well-known-shaped files to a skills-use temp directory', async () => {
      const skill: UseSkill = {
        kind: 'well-known',
        name: 'Well Known Skill',
        directoryName: 'well-known-skill',
        rawContent: '# Well Known Skill',
        files: new Map([
          ['SKILL.md', '# Well Known Skill'],
          ['reference.md', 'Reference'],
        ]),
      };

      const materialized = await materializeUseSkill(skill);
      cleanupDirs.push(materialized.tempRoot);

      expect(readFileSync(join(materialized.skillDir, 'reference.md'), 'utf-8')).toBe('Reference');
      expect(materialized.hasSupportingFiles).toBe(true);
    });
  });

  describe('launchAgentInteractively', () => {
    it('starts Claude Code interactively with the prompt argument', async () => {
      const fake = createFakeSpawn({ closeCode: 0 });

      await expect(
        launchAgentInteractively('claude-code', 'prompt body', fake.spawn)
      ).resolves.toBe(0);

      expect(fake.calls).toEqual([
        {
          command: 'claude',
          args: ['prompt body'],
          options: { stdio: 'inherit' },
        },
      ]);
    });

    it('starts Codex interactively with the prompt argument', async () => {
      const fake = createFakeSpawn({ closeCode: 0 });

      await expect(launchAgentInteractively('codex', 'prompt body', fake.spawn)).resolves.toBe(0);

      expect(fake.calls[0]).toMatchObject({
        command: 'codex',
        args: ['prompt body'],
        options: { stdio: 'inherit' },
      });
    });

    it('returns nonzero agent exit codes', async () => {
      const fake = createFakeSpawn({ closeCode: 37 });

      await expect(launchAgentInteractively('codex', 'prompt body', fake.spawn)).resolves.toBe(37);
    });

    it('reports missing agent executables', async () => {
      const error = Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' });
      const fake = createFakeSpawn({ error });

      await expect(
        launchAgentInteractively('claude-code', 'prompt body', fake.spawn)
      ).rejects.toThrow('command not found: claude');
    });

    it('rejects valid but unsupported agents', async () => {
      const fake = createFakeSpawn({ closeCode: 0 });

      await expect(
        launchAgentInteractively('cursor' as any, 'prompt body', fake.spawn)
      ).rejects.toThrow('Running Cursor is not supported yet.');
      expect(fake.calls).toEqual([]);
    });
  });

  describe('CLI behavior', () => {
    it('prints only the generated prompt for a single local skill', () => {
      writeSkill(join(testDir, 'single'), 'single-skill', 'Single skill body.');

      const result = runCli(['use', testDir], testDir);

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe('');
      expect(result.stdout).toContain('You are being given a Skill');
      expect(result.stdout).toContain('Single skill body.');
      expect(result.stdout).not.toContain('████');
      expect(result.stdout).not.toContain('skills add');
    });

    it('includes a temp directory only when supporting files exist', () => {
      const skillDir = writeSkill(
        join(testDir, 'skills', 'with-files'),
        'with-files',
        'Use script.'
      );
      mkdirSync(join(skillDir, 'scripts'), { recursive: true });
      writeFileSync(join(skillDir, 'scripts', 'run.sh'), 'echo with-files');

      const result = runCli(['use', testDir, '--skill', 'with-files'], testDir);
      const supportDir = extractSupportDir(result.stdout);
      if (supportDir) cleanupDirs.push(join(supportDir, '..'));

      expect(result.exitCode).toBe(0);
      expect(supportDir).toBeTruthy();
      expect(existsSync(join(supportDir!, 'scripts', 'run.sh'))).toBe(true);
    });

    it('omits the temp directory section for a skill with only SKILL.md', () => {
      writeSkill(join(testDir, 'single'), 'single-skill', 'Only instructions.');

      const result = runCli(['use', testDir], testDir);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).not.toContain('Supporting files for this skill were downloaded to:');
    });

    it('fails with available names when multiple skills have no selector', () => {
      writeSkill(join(testDir, 'skills', 'one'), 'one', 'One.');
      writeSkill(join(testDir, 'skills', 'two'), 'two', 'Two.');

      const result = runCli(['use', testDir], testDir);

      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe('');
      expect(result.stderr).toContain('This source contains multiple skills');
      expect(result.stderr).toContain('one');
      expect(result.stderr).toContain('two');
    });

    it('selects a local skill with --skill', () => {
      writeSkill(join(testDir, 'skills', 'one'), 'one', 'One.');
      writeSkill(join(testDir, 'skills', 'two'), 'two', 'Two.');

      const result = runCli(['use', testDir, '--skill', 'two'], testDir);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Two.');
      expect(result.stdout).not.toContain('One.');
    });

    it('fails for conflicting @skill and --skill selectors before downloading', () => {
      const result = runCli(
        [
          'use',
          'vercel-labs/agent-skills@web-design-guidelines',
          '--skill',
          'react-best-practices',
        ],
        testDir
      );

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('Conflicting skill selectors');
    });

    it('uses --full-depth to discover nested skills skipped by normal discovery', () => {
      writeSkill(testDir, 'root-skill', 'Root.');
      writeSkill(join(testDir, 'nested', 'target'), 'target', 'Nested target.');

      const shallow = runCli(['use', testDir, '--skill', 'target'], testDir);
      const fullDepth = runCli(['use', testDir, '--skill', 'target', '--full-depth'], testDir);

      expect(shallow.exitCode).toBe(1);
      expect(shallow.stderr).toContain('No matching skill found');
      expect(fullDepth.exitCode).toBe(0);
      expect(fullDepth.stdout).toContain('Nested target.');
    });

    it('does not register prompt as a command alias', () => {
      const result = runCli(['prompt'], testDir);

      expect(result.stdout).toContain('Unknown command: prompt');
    });

    it('does not register run as a command alias', () => {
      const result = runCli(['run', testDir], testDir);

      expect(result.stdout).toContain('Unknown command: run');
    });

    it('blocks OpenClaw sources before network access unless explicitly accepted', () => {
      const result = runCli(['use', 'openclaw/example@demo'], testDir);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('OpenClaw skills are unverified');
    });
  });
});

function writeSkill(skillDir: string, name: string, body: string): string {
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(
    join(skillDir, 'SKILL.md'),
    `---
name: ${name}
description: ${name} description
---

# ${name}

${body}
`
  );
  return skillDir;
}

function extractSupportDir(stdout: string): string | undefined {
  const marker = 'Supporting files for this skill were downloaded to:\n';
  return stdout.split(marker)[1]?.split('\n')[0];
}

function createFakeSpawn({
  closeCode,
  error,
}: {
  closeCode?: number;
  error?: NodeJS.ErrnoException;
}) {
  const calls: Array<{
    command: string;
    args: string[];
    options: { stdio: 'inherit' };
  }> = [];
  const spawn: AgentSpawn = (command, args, options) => {
    calls.push({ command, args, options });
    const child = new EventEmitter();
    setImmediate(() => {
      if (error) {
        child.emit('error', error);
      } else {
        child.emit('close', closeCode ?? 0);
      }
    });
    return child as unknown as AgentProcess;
  };

  return { calls, spawn };
}
