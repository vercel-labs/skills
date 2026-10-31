import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'fs';
import { execFileSync, spawn, type ChildProcess } from 'child_process';
import { once } from 'events';
import { tmpdir } from 'os';
import { join, relative } from 'path';
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
    };

    beforeEach(async () => {
      source = 'https://gitlab.com/skills-fixture/update-targets.git';
      root = mkdtempSync(join(tmpdir(), 'skills-update-targets-'));
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
      update();

      expect(readlinkSync(claude)).toBe(claudeLink);
      expect(content(claude)).toContain('alpha v2');
      expect(() => lstatSync(hermes)).toThrow(/ENOENT/);
      expect(readlinkSync(beta)).toBe(betaLink);
      expect(content(beta)).toContain('beta v1');
      expect(existsSync(agentPath('.claude', 'beta'))).toBe(false);

      unlinkSync(claude);
      publish('alpha v3');
      update();

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

      update();

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

    it.each(['relative', 'absolute'] as const)(
      'preserves %s links through a symlinked parent',
      (kind) => {
        add();
        const skillsDir = join(base, '.claude', 'skills');
        const storage = join(root, 'claude-skills');
        renameSync(skillsDir, storage);
        symlinkSync(storage, skillsDir, process.platform === 'win32' ? 'junction' : 'dir');
        const claude = agentPath('.claude');
        unlinkSync(claude);
        const target =
          kind === 'absolute' || process.platform === 'win32'
            ? canonicalPath()
            : relative(storage, canonicalPath());
        symlinkSync(target, claude, process.platform === 'win32' ? 'junction' : 'dir');
        const link = readlinkSync(claude);
        rmSync(canonicalPath(), { recursive: true });
        expect(existsSync(claude)).toBe(false);

        publish('alpha v2');
        update();

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
      const lockPath =
        scope === 'global'
          ? join(env.XDG_STATE_HOME!, 'skills', '.skill-lock.json')
          : join(project, 'skills-lock.json');
      const before = JSON.parse(readFileSync(lockPath, 'utf8')).skills.alpha;
      publish('alpha v2');

      const result = runCli(['update', 'alpha', '-y', ...scopeFlags], project, env);

      expect(result.exitCode).toBe(1);
      expect(result.stdout).toContain('canonical skill directory is a symbolic link');
      expect(readlinkSync(canonicalPath())).toBe(link);
      expect(content(storage)).toContain('alpha v1');
      expect(JSON.parse(readFileSync(lockPath, 'utf8')).skills.alpha).toEqual(before);
      expect(() => lstatSync(agentPath('.hermes'))).toThrow(/ENOENT/);
    });

    if (scope === 'project' && sourceType === 'git') {
      it('reports a failed update when an agent parent cannot be inspected', () => {
        add();
        const skillsDir = join(project, '.aider-desk', 'skills');
        mkdirSync(join(project, '.aider-desk'));
        rmSync(canonicalPath(), { recursive: true });
        symlinkSync(skillsDir, skillsDir, process.platform === 'win32' ? 'junction' : 'dir');
        publish('alpha v2');

        const result = runCli(['update', 'alpha', '--project', '-y'], project, env);

        expect(result.exitCode).toBe(1);
        expect(result.stdout).toContain('Failed to update alpha');
        expect(existsSync(canonicalPath())).toBe(false);
      });

      it('updates existing Eve stores and preserves Eve symlinks', () => {
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
        publish('alpha v2');

        update();

        expect(readlinkSync(eveRoot)).toBe(link);
        expect(content(foreign)).toBe('foreign Eve content');
        expect(content(eveSubagent)).toContain('alpha v2');
        expect(content(canonicalPath())).toContain('alpha v2');
        expect(() => lstatSync(agentPath('.claude'))).toThrow(/ENOENT/);
        expect(() => lstatSync(agentPath('.hermes'))).toThrow(/ENOENT/);
      });
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

      publish('alpha v2');
      update();

      expect(content(canonicalPath())).toContain('alpha v2');
      expect(readlinkSync(claude)).toBe(link);
      expect(content(claude)).toBe('foreign content');
      expect(lstatSync(hermes).isSymbolicLink()).toBe(false);
      expect(content(hermes)).toBe('independent copy');
    });
  });
});
