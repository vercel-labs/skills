import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'fs';
import { execFileSync, spawn, type ChildProcess } from 'child_process';
import { once } from 'events';
import { tmpdir } from 'os';
import { join, relative, sep } from 'path';
import { pathToFileURL } from 'url';
import { createTestHomeEnvironment, runCli } from '../src/test-utils.ts';

describe.each(['git', 'well-known'] as const)('%s source', (sourceType) => {
  describe.each(['project', 'global'] as const)('%s update symlink destinations', (scope) => {
    let root: string;
    let source: string;
    let server: ChildProcess | undefined;
    let repo: string;
    let project: string;
    let base: string;
    let env: Record<string, string>;
    const scopeFlags = scope === 'global' ? ['-g'] : ['--project'];
    const agentPath = (agent: string, skill = 'alpha') => join(base, agent, 'skills', skill);
    const canonicalPath = () => agentPath('.agents');
    const lockPath = () =>
      scope === 'global'
        ? join(env.XDG_STATE_HOME!, 'skills', '.skill-lock.json')
        : join(project, 'skills-lock.json');
    const content = (path: string) => readFileSync(join(path, 'SKILL.md'), 'utf8');
    const git = (...args: string[]) =>
      execFileSync(
        'git',
        ['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.test', ...args],
        {
          cwd: repo,
          env: { ...process.env, ...env },
          stdio: 'pipe',
        }
      );
    const publish = (version: string, skill = 'alpha') => {
      mkdirSync(join(repo, 'skills', skill), { recursive: true });
      writeFileSync(
        join(repo, 'skills', skill, 'SKILL.md'),
        `---\nname: ${skill}\ndescription: ${skill}\n---\n${version}\n`
      );
      git('add', '.');
      git('commit', '-qm', `${skill} ${version}`);
    };
    const cli = (args: string[]) => {
      const result = runCli(args, project, env);
      expect(result.exitCode, result.stdout + result.stderr).toBe(0);
      return result;
    };
    const add = (skill = 'alpha', agent = 'claude-code') =>
      cli([
        'add',
        source,
        '--skill',
        skill,
        '-a',
        agent,
        'universal',
        '-y',
        ...(scope === 'global' ? ['-g'] : []),
      ]);
    const update = () => {
      const result = cli(['update', 'alpha', '-y', ...scopeFlags]);
      expect(result.stdout).toContain('Updated alpha');
      return result;
    };

    beforeEach(async () => {
      source = 'https://gitlab.com/skills-fixture/update-targets.git';
      root = realpathSync(mkdtempSync(join(tmpdir(), 'skills-update-targets-')));
      repo = join(root, 'repo');
      project = join(root, 'project');
      const home = join(root, 'home');
      base = scope === 'global' ? home : project;
      env = {
        ...createTestHomeEnvironment(home),
        GROK_HOME: join(home, '.grok'),
        SARVAM_HOME: join(home, '.sarvam'),
        GH_CONFIG_DIR: join(home, '.config', 'gh'),
        GITHUB_TOKEN: '',
        GH_TOKEN: '',
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_GLOBAL: join(root, 'gitconfig'),
        GIT_CONFIG_COUNT: '0',
        GIT_ALLOW_PROTOCOL: 'file',
        GIT_TERMINAL_PROMPT: '0',
      };
      mkdirSync(repo, { recursive: true });
      mkdirSync(project, { recursive: true });
      mkdirSync(join(base, '.claude'), { recursive: true });
      mkdirSync(join(base, '.hermes', 'skills'), { recursive: true });
      mkdirSync(join(home, '.hermes', 'skills'), { recursive: true });
      git('init', '-q');
      git(
        'config',
        '--file',
        join(root, 'gitconfig'),
        `url.${pathToFileURL(repo).href}.insteadOf`,
        source
      );
      publish('alpha v1');
      publish('beta v1', 'beta');
      if (sourceType === 'well-known') {
        server = spawn(
          process.execPath,
          [
            '--input-type=module',
            '-e',
            `
        import { createServer } from 'node:http';
        import { readFileSync } from 'node:fs';
        import { join } from 'node:path';
        const repo = process.argv[1];
        const server = createServer((req, res) => {
          if (req.url === '/.well-known/skills/index.json') {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ skills: ['alpha', 'beta'].map(name => ({
              name, description: name, files: ['SKILL.md']
            })) }));
            return;
          }
          const match = req.url.match(/^\\/\\.well-known\\/skills\\/(alpha|beta)\\/SKILL\\.md$/);
          if (match) {
            res.end(readFileSync(join(repo, 'skills', match[1], 'SKILL.md')));
            return;
          }
          res.writeHead(404).end();
        });
        server.listen(0, '127.0.0.1', () => console.log(server.address().port));
      `,
            repo,
          ],
          { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'inherit'] }
        );
        const [port] = await once(server.stdout!, 'data');
        source = `http://127.0.0.1:${String(port).trim()}`;
      }
    });

    afterEach(async () => {
      if (server) {
        server.kill();
        await once(server, 'exit');
        server = undefined;
      }
      rmSync(root, { recursive: true, force: true });
    });

    it('updates shared content without adding destinations or restoring removed links', () => {
      add('beta', 'hermes-agent');
      add();
      const claude = agentPath('.claude');
      const hermes = agentPath('.hermes');
      const beta = agentPath('.hermes', 'beta');
      const claudeLink = readlinkSync(claude);
      const betaLink = readlinkSync(beta);
      expect(lstatSync(claude).isSymbolicLink()).toBe(true);
      expect(existsSync(hermes)).toBe(false);

      publish('alpha v2');
      const result = update();

      expect(result.stdout + result.stderr).not.toContain('Warning:');
      expect(readlinkSync(claude)).toBe(claudeLink);
      expect(content(claude)).toContain('alpha v2');
      expect(() => lstatSync(hermes)).toThrow(/ENOENT/);
      expect(readlinkSync(beta)).toBe(betaLink);
      expect(content(beta)).toContain('beta v1');
      expect(existsSync(agentPath('.claude', 'beta'))).toBe(false);

      unlinkSync(claude);
      publish('alpha v3');
      const removedLinkResult = update();

      expect(removedLinkResult.stdout + removedLinkResult.stderr).not.toContain('Warning:');
      expect(() => lstatSync(claude)).toThrow(/ENOENT/);
      expect(() => lstatSync(hermes)).toThrow(/ENOENT/);
      expect(content(canonicalPath())).toContain('alpha v3');

      add('alpha', 'hermes-agent');
      expect(lstatSync(hermes).isSymbolicLink()).toBe(true);
      expect(content(hermes)).toContain('alpha v3');
      expect(() => lstatSync(claude)).toThrow(/ENOENT/);
      expect(readlinkSync(beta)).toBe(betaLink);
      expect(content(beta)).toContain('beta v1');
      expect(existsSync(agentPath('.claude', 'beta'))).toBe(false);
    });

    it('restores erased shared content without guessing removed destinations', () => {
      add();
      unlinkSync(agentPath('.claude'));
      rmSync(canonicalPath(), { recursive: true });
      publish('alpha v2');

      const result = update();

      expect(result.stdout + result.stderr).not.toContain('Warning:');
      expect(content(canonicalPath())).toContain('alpha v2');
      expect(() => lstatSync(agentPath('.claude'))).toThrow(/ENOENT/);
      expect(() => lstatSync(agentPath('.hermes'))).toThrow(/ENOENT/);
    });

    it('keeps an existing implicit single-agent copy as a copy', () => {
      cli([
        'add',
        source,
        '--skill',
        'alpha',
        '-a',
        'claude-code',
        '-y',
        ...(scope === 'global' ? ['-g'] : []),
      ]);
      const claude = agentPath('.claude');
      expect(lstatSync(claude).isSymbolicLink()).toBe(false);
      expect(existsSync(canonicalPath())).toBe(false);
      publish('alpha v2');

      update();

      expect(lstatSync(claude).isSymbolicLink()).toBe(false);
      expect(content(claude)).toContain('alpha v2');
      expect(() => lstatSync(agentPath('.hermes'))).toThrow(/ENOENT/);
    });

    it.each(['directory', 'missing', 'broken'] as const)(
      'updates an implicit copy and warns about a foreign link to a %s target',
      (targetKind) => {
        cli([
          'add',
          source,
          '--skill',
          'alpha',
          '-a',
          'claude-code',
          '-y',
          ...(scope === 'global' ? ['-g'] : []),
        ]);
        const claude = agentPath('.claude');
        const hermes = agentPath('.hermes');
        const foreign = join(root, 'foreign-alpha');
        if (targetKind === 'directory') {
          mkdirSync(foreign);
          writeFileSync(join(foreign, 'SKILL.md'), 'foreign content');
        } else if (targetKind === 'broken') {
          symlinkSync(
            join(root, 'missing-alpha'),
            foreign,
            process.platform === 'win32' ? 'junction' : 'dir'
          );
        }
        symlinkSync(foreign, hermes, process.platform === 'win32' ? 'junction' : 'dir');
        const link = readlinkSync(hermes);
        expect(lstatSync(claude).isSymbolicLink()).toBe(false);
        expect(existsSync(canonicalPath())).toBe(false);
        publish('alpha v2');

        const result = update();

        expect(lstatSync(claude).isSymbolicLink()).toBe(false);
        expect(content(claude)).toContain('alpha v2');
        expect(existsSync(canonicalPath())).toBe(false);
        expect(readlinkSync(hermes)).toBe(link);
        if (targetKind === 'directory') expect(content(foreign)).toBe('foreign content');
        else {
          expect(existsSync(hermes)).toBe(false);
          if (targetKind === 'broken')
            expect(readlinkSync(foreign)).toBe(join(root, 'missing-alpha'));
          else expect(() => lstatSync(foreign)).toThrow(/ENOENT/);
        }
        const output = result.stdout + result.stderr;
        expect(output).toContain('Warning:');
        expect(output).toContain(hermes);
        expect(output).toContain(foreign);
        expect(output).toContain('left unchanged');
        expect(output).toContain(`expected ${canonicalPath()}`);
        expect(output).toContain(
          `npx skills add '${source}' --skill 'alpha' --agent 'hermes-agent' universal${scope === 'global' ? ' -g' : ''} -y`
        );
      }
    );

    it.skipIf(process.platform === 'win32').each(['missing', 'present'] as const)(
      'resolves a symlink before .. with %s canonical content',
      (canonicalState) => {
        add();
        const canonicalParent = join(base, '.agents', 'skills');
        mkdirSync(join(canonicalParent, 'child'));
        const alias = join(root, 'child-alias');
        symlinkSync(join(canonicalParent, 'child'), alias, 'dir');
        const claude = agentPath('.claude');
        unlinkSync(claude);
        const target = `${alias}${sep}..${sep}alpha`;
        symlinkSync(target, claude, 'dir');
        if (canonicalState === 'missing') rmSync(canonicalPath(), { recursive: true });
        publish('alpha v2');

        const result = update();

        expect(result.stdout + result.stderr).not.toContain('Warning:');
        expect(readlinkSync(claude)).toBe(target);
        expect(content(claude)).toContain('alpha v2');
      }
    );

    it('restores canonical content through links whose canonical parents are missing', () => {
      add();
      const claude = agentPath('.claude');
      const target = readlinkSync(claude);
      rmSync(join(base, '.agents'), { recursive: true });
      publish('alpha v2');

      const result = update();

      expect(result.stdout + result.stderr).not.toContain('Warning:');
      expect(readlinkSync(claude)).toBe(target);
      expect(content(claude)).toContain('alpha v2');
      expect(() => lstatSync(agentPath('.hermes'))).toThrow(/ENOENT/);
    });

    it('warns once when agent parents alias the same foreign link', () => {
      add();
      const claude = agentPath('.claude');
      const foreign = join(root, 'foreign-alpha');
      mkdirSync(foreign);
      writeFileSync(join(foreign, 'SKILL.md'), 'foreign content');
      unlinkSync(claude);
      symlinkSync(foreign, claude, process.platform === 'win32' ? 'junction' : 'dir');
      const hermesSkills = join(base, '.hermes', 'skills');
      rmSync(hermesSkills, { recursive: true });
      symlinkSync(
        join(base, '.claude', 'skills'),
        hermesSkills,
        process.platform === 'win32' ? 'junction' : 'dir'
      );
      publish('alpha v2');

      const result = update();

      expect((result.stdout + result.stderr).match(/Warning:/g)).toHaveLength(1);
      expect(readlinkSync(claude)).toBe(foreign);
      expect(readlinkSync(agentPath('.hermes'))).toBe(foreign);
      expect(content(foreign)).toBe('foreign content');
      expect(content(canonicalPath())).toContain('alpha v2');
    });

    it.each([
      ['relative', 'missing'],
      ['absolute', 'missing'],
      ['relative', 'present'],
      ['absolute', 'present'],
      ['alias', 'missing'],
      ['alias', 'present'],
    ] as const)(
      'preserves %s links through a symlinked parent with %s canonical content',
      (kind, canonicalState) => {
        add();
        const skillsDir = join(base, '.claude', 'skills');
        const storage = join(root, 'claude-skills');
        renameSync(skillsDir, storage);
        symlinkSync(storage, skillsDir, process.platform === 'win32' ? 'junction' : 'dir');
        const claude = agentPath('.claude');
        unlinkSync(claude);
        let target =
          kind === 'absolute' || process.platform === 'win32'
            ? canonicalPath()
            : relative(storage, canonicalPath());
        if (kind === 'alias') {
          const shared = join(root, 'shared-skills');
          const canonicalParent = join(base, '.agents', 'skills');
          renameSync(canonicalParent, shared);
          symlinkSync(shared, canonicalParent, process.platform === 'win32' ? 'junction' : 'dir');
          const alias = join(root, 'skills-alias');
          symlinkSync(shared, alias, process.platform === 'win32' ? 'junction' : 'dir');
          target =
            process.platform === 'win32'
              ? join(alias, 'alpha')
              : relative(storage, join(alias, 'alpha'));
        }
        symlinkSync(target, claude, process.platform === 'win32' ? 'junction' : 'dir');
        const link = readlinkSync(claude);
        if (canonicalState === 'missing') {
          rmSync(canonicalPath(), { recursive: true });
          expect(existsSync(claude)).toBe(false);
        }

        publish('alpha v2');
        const result = update();

        expect(result.stdout + result.stderr).not.toContain('Warning:');
        expect(readlinkSync(claude)).toBe(link);
        expect(content(claude)).toContain('alpha v2');
        expect(() => lstatSync(agentPath('.hermes'))).toThrow(/ENOENT/);
      }
    );

    it('does not replace a canonical symlink or advance its lock entry', () => {
      add();
      const storage = join(root, 'linked-source');
      renameSync(canonicalPath(), storage);
      symlinkSync(storage, canonicalPath(), process.platform === 'win32' ? 'junction' : 'dir');
      const link = readlinkSync(canonicalPath());
      const before = JSON.parse(readFileSync(lockPath(), 'utf8')).skills.alpha;
      publish('alpha v2');

      const result = runCli(['update', 'alpha', '-y', ...scopeFlags], project, env);

      expect(result.exitCode).toBe(1);
      expect(result.stdout).toContain('canonical skill directory is a symbolic link');
      expect(readlinkSync(canonicalPath())).toBe(link);
      expect(content(storage)).toContain('alpha v1');
      expect(JSON.parse(readFileSync(lockPath(), 'utf8')).skills.alpha).toEqual(before);
      expect(() => lstatSync(agentPath('.hermes'))).toThrow(/ENOENT/);
    });

    if (sourceType === 'git') {
      it.each(['POSIX sh', 'PowerShell'] as const)(
        'renders a %s recovery command with quoted recorded arguments',
        (shell) => {
          source = "https://gitlab.com/skills-fixture/update'targets.git";
          git(
            'config',
            '--file',
            env.GIT_CONFIG_GLOBAL!,
            `url.${pathToFileURL(repo).href}.insteadOf`,
            source
          );
          const skill = "alpha's skill";
          publish('quoted v1', skill);
          add(skill);
          const claude = agentPath('.claude', 'alpha-s-skill');
          const foreign = join(root, 'foreign-quoted-skill');
          mkdirSync(foreign);
          writeFileSync(join(foreign, 'SKILL.md'), 'foreign content');
          unlinkSync(claude);
          symlinkSync(foreign, claude, process.platform === 'win32' ? 'junction' : 'dir');
          publish('quoted v2', skill);
          const preload = join(root, 'recovery-platform.mjs');
          writeFileSync(
            preload,
            `await import(${JSON.stringify(pathToFileURL(join(import.meta.dirname, '../src/update.ts')).href)});
Object.defineProperty(process, 'platform', { value: ${JSON.stringify(shell === 'PowerShell' ? 'win32' : 'linux')} });`
          );

          const result = runCli(['update', skill, '-y', ...scopeFlags], project, {
            ...env,
            NODE_OPTIONS: `--import=${pathToFileURL(preload).href}`,
          });

          expect(result.exitCode, result.stdout + result.stderr).toBe(0);
          expect(content(agentPath('.agents', 'alpha-s-skill'))).toContain('quoted v2');
          expect(readlinkSync(claude)).toBe(foreign);
          expect(content(foreign)).toBe('foreign content');
          const sourceArgument =
            shell === 'PowerShell'
              ? "'https://gitlab.com/skills-fixture/update''targets.git'"
              : "'https://gitlab.com/skills-fixture/update'\\''targets.git'";
          const skillArgument = shell === 'PowerShell' ? "'alpha''s skill'" : "'alpha'\\''s skill'";
          expect(result.stdout).toContain(
            `run in ${shell}: npx skills add ${sourceArgument} --skill ${skillArgument} --agent 'claude-code' universal${scope === 'global' ? ' -g' : ''} -y`
          );
          if (shell === 'POSIX sh' && process.platform !== 'win32') {
            const line = result.stdout
              .split('\n')
              .find((line) => line.includes('npx skills add '))!;
            const command = line.slice(line.indexOf('npx skills add '));
            const argumentsOutput = execFileSync(
              'sh',
              ['-c', `set -- ${command}; printf '%s\\000' "$@"`],
              { cwd: project, env: { ...process.env, ...env }, encoding: 'utf8' }
            );
            expect(argumentsOutput.split('\0').slice(0, -1)).toEqual([
              'npx',
              'skills',
              'add',
              source,
              '--skill',
              skill,
              '--agent',
              'claude-code',
              'universal',
              ...(scope === 'global' ? ['-g'] : []),
              '-y',
            ]);
          }
        }
      );

      it('updates explicit copies when a canonical ancestor is cyclic', () => {
        mkdirSync(join(env.HOME!, '.claude'), { recursive: true });
        mkdirSync(join(base, '.agents'), { recursive: true });
        const canonicalParent = join(base, '.agents', 'skills');
        symlinkSync(
          canonicalParent,
          canonicalParent,
          process.platform === 'win32' ? 'junction' : 'dir'
        );
        cli([
          'add',
          source,
          '--skill',
          'alpha',
          '-a',
          'claude-code',
          '--copy',
          '-y',
          ...(scope === 'global' ? ['-g'] : []),
        ]);
        expect(JSON.parse(readFileSync(lockPath(), 'utf8')).skills.alpha.installMode).toBe('copy');
        expect(content(agentPath('.claude'))).toContain('alpha v1');
        const before = JSON.parse(readFileSync(lockPath(), 'utf8')).skills.alpha;
        publish('alpha v2');

        const result = update();

        expect(content(agentPath('.claude'))).toContain('alpha v2');
        expect(lstatSync(agentPath('.claude')).isSymbolicLink()).toBe(false);
        expect(readlinkSync(canonicalParent)).toBe(canonicalParent);
        expect(JSON.parse(readFileSync(lockPath(), 'utf8')).skills.alpha).not.toEqual(before);
        expect(result.stdout).not.toContain('Failed to update alpha');
      });

      it('updates explicit copies when the canonical entry is a foreign symlink', () => {
        mkdirSync(join(env.HOME!, '.claude'), { recursive: true });
        cli([
          'add',
          source,
          '--skill',
          'alpha',
          '-a',
          'claude-code',
          'universal',
          '--copy',
          '-y',
          ...(scope === 'global' ? ['-g'] : []),
        ]);
        const claude = agentPath('.claude');
        const foreign = join(root, 'foreign-alpha');
        mkdirSync(foreign);
        writeFileSync(join(foreign, 'SKILL.md'), 'foreign content');
        rmSync(canonicalPath(), { recursive: true });
        symlinkSync(foreign, canonicalPath(), process.platform === 'win32' ? 'junction' : 'dir');
        expect(JSON.parse(readFileSync(lockPath(), 'utf8')).skills.alpha.installMode).toBe('copy');
        publish('alpha v2');

        update();

        expect(lstatSync(claude).isSymbolicLink()).toBe(false);
        expect(content(claude)).toContain('alpha v2');
        expect(content(foreign)).toBe('foreign content');
      });
    }

    it('reports a failed update when an agent parent cannot be inspected and continues the batch', () => {
      add();
      mkdirSync(join(env.HOME!, '.claude'), { recursive: true });
      cli([
        'add',
        source,
        '--skill',
        'beta',
        '-a',
        'claude-code',
        'universal',
        '--copy',
        '-y',
        ...(scope === 'global' ? ['-g'] : []),
      ]);
      if (sourceType === 'well-known') {
        const lockWithRecordedBetaCopy = JSON.parse(readFileSync(lockPath(), 'utf8'));
        lockWithRecordedBetaCopy.skills.beta.installMode = 'copy';
        writeFileSync(lockPath(), JSON.stringify(lockWithRecordedBetaCopy, null, 2));
      }
      expect(JSON.parse(readFileSync(lockPath(), 'utf8')).skills.beta.installMode).toBe('copy');
      const before = JSON.parse(readFileSync(lockPath(), 'utf8')).skills.alpha;
      const skillsDir = join(base, '.aider-desk', 'skills');
      mkdirSync(join(base, '.aider-desk'));
      rmSync(canonicalPath(), { recursive: true });
      symlinkSync(skillsDir, skillsDir, process.platform === 'win32' ? 'junction' : 'dir');
      publish('alpha v2');
      publish('beta v2', 'beta');

      const result = runCli(['update', 'alpha', 'beta', '-y', ...scopeFlags], project, env);

      expect(result.exitCode, result.stdout + result.stderr).toBe(1);
      expect(result.stdout).toContain('Failed to update alpha');
      expect(existsSync(canonicalPath())).toBe(false);
      expect(JSON.parse(readFileSync(lockPath(), 'utf8')).skills.alpha).toEqual(before);
      expect(result.stdout).toContain('Updated beta');
      expect(content(agentPath('.claude', 'beta'))).toContain('beta v2');
      expect(lstatSync(agentPath('.claude', 'beta')).isSymbolicLink()).toBe(false);
    });

    it('refreshes shared content when an unrelated agent parent cannot be inspected', () => {
      add();
      const claude = agentPath('.claude');
      const claudeTarget = readlinkSync(claude);
      const skillsDir = join(base, '.aider-desk', 'skills');
      mkdirSync(join(base, '.aider-desk'));
      symlinkSync(skillsDir, skillsDir, process.platform === 'win32' ? 'junction' : 'dir');
      publish('alpha v2');

      const result = runCli(['update', 'alpha', '-y', ...scopeFlags], project, env);

      expect(result.exitCode, result.stdout + result.stderr).toBe(0);
      expect(result.stdout).toContain('Updated alpha');
      expect(result.stdout).toContain('Warning:');
      expect(result.stdout).toContain(skillsDir);
      expect(result.stdout).toContain('ELOOP');
      expect(result.stdout).toContain('left unchanged');
      expect(result.stdout).not.toContain('expected ');
      expect(readlinkSync(skillsDir)).toBe(skillsDir);
      expect(readlinkSync(claude)).toBe(claudeTarget);
      expect(content(claude)).toContain('alpha v2');
      expect(content(canonicalPath())).toContain('alpha v2');
    });

    if (scope === 'project' && sourceType === 'git') {
      it('requires manual review of an Eve flat link before reinstalling', () => {
        add();
        const foreign = join(root, 'foreign-eve.md');
        writeFileSync(foreign, 'foreign Eve content');
        const eveFlat = join(project, 'agent', 'skills', 'alpha.md');
        mkdirSync(join(project, 'agent', 'skills'), { recursive: true });
        symlinkSync(foreign, eveFlat, 'file');
        const link = readlinkSync(eveFlat);
        publish('alpha v2');

        const result = update();

        expect(result.stdout).toContain(eveFlat);
        expect(result.stdout).toContain(foreign);
        expect(result.stdout).toContain('left unchanged');
        expect(result.stdout).toContain(
          'Review and remove or relink the flat Eve entry before reinstalling.'
        );
        expect(result.stdout).not.toContain('To replace it explicitly, run');
        expect(result.stdout).toContain(
          `npx skills add '${source}' --skill 'alpha' --agent 'eve' universal --subagent 'root' -y`
        );
        expect(readlinkSync(eveFlat)).toBe(link);
        expect(content(canonicalPath())).toContain('alpha v2');

        cli([
          'add',
          source,
          '--skill',
          'alpha',
          '--agent',
          'eve',
          'universal',
          '--subagent',
          'root',
          '-y',
        ]);

        expect(readlinkSync(eveFlat)).toBe(link);
        expect(readFileSync(eveFlat, 'utf8')).toBe('foreign Eve content');
        expect(content(join(project, 'agent', 'skills', 'alpha'))).toContain('alpha v2');
      });

      it.each(['present', 'missing'] as const)(
        'updates existing Eve stores and preserves Eve symlinks with %s canonical content',
        (canonicalState) => {
          cli([
            'add',
            source,
            '--skill',
            'alpha',
            '-a',
            'eve',
            'universal',
            '--subagent',
            'root',
            'research',
            '-y',
          ]);
          const eveRoot = join(project, 'agent', 'skills', 'alpha');
          const eveSubagent = join(project, 'agent', 'subagents', 'research', 'skills', 'alpha');
          const foreign = join(root, 'foreign-eve-alpha');
          mkdirSync(foreign);
          writeFileSync(join(foreign, 'SKILL.md'), 'foreign Eve content');
          rmSync(eveRoot, { recursive: true });
          symlinkSync(foreign, eveRoot, process.platform === 'win32' ? 'junction' : 'dir');
          const link = readlinkSync(eveRoot);
          if (canonicalState === 'missing') rmSync(canonicalPath(), { recursive: true });
          publish('alpha v2');

          const result = update();

          expect(readlinkSync(eveRoot)).toBe(link);
          expect(content(foreign)).toBe('foreign Eve content');
          expect(content(eveSubagent)).toContain('alpha v2');
          if (canonicalState === 'present') expect(content(canonicalPath())).toContain('alpha v2');
          else expect(existsSync(canonicalPath())).toBe(false);
          expect(result.stdout).toContain(
            `npx skills add '${source}' --skill 'alpha' --agent 'eve' universal --subagent 'root' -y`
          );
          expect(() => lstatSync(agentPath('.claude'))).toThrow(/ENOENT/);
          expect(() => lstatSync(agentPath('.hermes'))).toThrow(/ENOENT/);
        }
      );
    }

    it('leaves independent copies and foreign symlinks untouched', () => {
      add();
      const foreign = join(root, 'foreign-alpha');
      mkdirSync(foreign);
      writeFileSync(join(foreign, 'SKILL.md'), 'foreign content');
      const claude = agentPath('.claude');
      unlinkSync(claude);
      symlinkSync(foreign, claude, process.platform === 'win32' ? 'junction' : 'dir');
      const hermes = agentPath('.hermes');
      mkdirSync(hermes);
      writeFileSync(join(hermes, 'SKILL.md'), 'independent copy');
      const link = readlinkSync(claude);

      const unchanged = cli(['update', 'alpha', '-y', ...scopeFlags]);
      expect(unchanged.stdout + unchanged.stderr).not.toContain('Warning:');
      publish('alpha v2');
      const check = runCli(['check', 'alpha', '-y', ...scopeFlags], project, env);
      expect(check.exitCode, check.stdout + check.stderr).toBe(1);
      expect(check.stdout + check.stderr).not.toContain('Warning:');
      const result = update();

      expect(content(canonicalPath())).toContain('alpha v2');
      expect(readlinkSync(claude)).toBe(link);
      expect(content(claude)).toBe('foreign content');
      expect(lstatSync(hermes).isSymbolicLink()).toBe(false);
      expect(content(hermes)).toBe('independent copy');
      const output = result.stdout + result.stderr;
      expect(output).toContain('Warning:');
      expect(output).toContain(claude);
      expect(output).toContain(foreign);
      expect(output).toContain('left unchanged');
      expect(output).toContain(`expected ${canonicalPath()}`);
      expect(output).toContain(
        `npx skills add '${source}' --skill 'alpha' --agent 'claude-code' universal${scope === 'global' ? ' -g' : ''} -y`
      );
    });
  });
});
