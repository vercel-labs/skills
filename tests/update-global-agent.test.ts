import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runCli, runCliAsync } from '../src/test-utils.ts';

function skillContent(version: string): string {
  return `---\nname: scope-skill\ndescription: Update regression\n---\n\n# ${version}\n`;
}

describe('global update agent selection', () => {
  let root: string;
  let home: string;
  let project: string;
  let server: Server;
  let sourceUrl: string;
  let version: string;

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'skills-update-global-'));
    home = join(root, 'home');
    project = join(root, 'project');
    mkdirSync(join(home, '.codex'), { recursive: true });
    mkdirSync(project);
    version = 'v1';
    server = createServer((request, response) => {
      if (request.url === '/.well-known/agent-skills/index.json') {
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(
          JSON.stringify({
            skills: [
              { name: 'scope-skill', description: 'Update regression', files: ['SKILL.md'] },
            ],
          })
        );
      } else if (request.url === '/.well-known/agent-skills/scope-skill/SKILL.md') {
        response.writeHead(200, { 'Content-Type': 'text/plain' });
        response.end(skillContent(version));
      } else {
        response.writeHead(404);
        response.end();
      }
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    sourceUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(root, { recursive: true, force: true });
  });

  it.each(['codex', 'eve and codex', 'agent context'])(
    'updates installed files without unsupported targets when detecting %s',
    async (detected) => {
      if (detected === 'eve and codex') {
        mkdirSync(join(project, 'agent'));
        writeFileSync(
          join(project, 'package.json'),
          JSON.stringify({ dependencies: { eve: '1' } })
        );
      }
      const env = { HOME: home, ...(detected === 'agent context' ? { CODEX_CI: '1' } : {}) };
      const add = await runCliAsync(
        ['add', sourceUrl, '-g', '-y', '--agent', 'codex', '--copy'],
        project,
        env
      );
      expect(add.exitCode, add.stdout + add.stderr).toBe(0);

      const installed = join(home, '.agents', 'skills', 'scope-skill', 'SKILL.md');
      const lock = join(home, '.local', 'state', 'skills', '.skill-lock.json');
      const originalDigest = JSON.parse(readFileSync(lock, 'utf-8')).skills['scope-skill']
        .wellKnownDigest;
      expect(readFileSync(installed, 'utf-8')).toContain('# v1');

      version = 'v2';
      const update = await runCliAsync(['update', '-g', '-y'], project, env);
      const output = update.stdout + update.stderr;

      expect(update.exitCode, output).toBe(0);
      expect(output).toContain('Updated scope-skill');
      expect(output).not.toContain('does not support global skill installation');
      expect(output.match(/Skipping /g)).toHaveLength(1);
      expect(readFileSync(installed, 'utf-8')).toContain('# v2');
      expect(
        JSON.parse(readFileSync(lock, 'utf-8')).skills['scope-skill'].wellKnownDigest
      ).not.toBe(originalDigest);
    },
    30000
  );
});

it('preserves project updates to the Eve root and recorded subagent', () => {
  const root = mkdtempSync(join(tmpdir(), 'skills-update-eve-project-'));
  const repo = join(root, 'repo');
  const project = join(root, 'project');
  const home = join(root, 'home');
  try {
    mkdirSync(join(repo, 'skills', 'scope-skill'), { recursive: true });
    mkdirSync(join(project, 'agent', 'subagents', 'research'), { recursive: true });
    mkdirSync(home);
    writeFileSync(join(project, 'package.json'), JSON.stringify({ dependencies: { eve: '1' } }));
    const git = (...args: string[]) =>
      execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], {
        cwd: repo,
        stdio: 'ignore',
      });
    const publish = (version: string) => {
      writeFileSync(join(repo, 'skills', 'scope-skill', 'SKILL.md'), skillContent(version));
      git('add', '.');
      git('commit', '-qm', version);
    };
    git('init', '-q');
    publish('v1');

    const add = runCli(
      ['add', pathToFileURL(repo).href, '-y', '--agent', 'eve', '--subagent', 'root', 'research'],
      project,
      { HOME: home }
    );
    expect(add.exitCode, add.stdout + add.stderr).toBe(0);
    const rootSkill = join(project, 'agent', 'skills', 'scope-skill', 'SKILL.md');
    const subagentSkill = join(
      project,
      'agent',
      'subagents',
      'research',
      'skills',
      'scope-skill',
      'SKILL.md'
    );
    expect(readFileSync(rootSkill, 'utf-8')).toContain('# v1');
    expect(readFileSync(subagentSkill, 'utf-8')).toContain('# v1');

    publish('v2');
    const update = runCli(['update', '-p', '-y'], project, { HOME: home });
    expect(update.exitCode, update.stdout + update.stderr).toBe(0);
    expect(readFileSync(rootSkill, 'utf-8')).toContain('# v2');
    expect(readFileSync(subagentSkill, 'utf-8')).toContain('# v2');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 30000);
