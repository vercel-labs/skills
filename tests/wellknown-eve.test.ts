import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

vi.mock('@clack/prompts', () => {
  const noop = () => {};
  return {
    intro: noop,
    outro: noop,
    cancel: noop,
    note: vi.fn(),
    confirm: vi.fn().mockResolvedValue(true),
    multiselect: vi.fn().mockResolvedValue(['research']),
    select: vi.fn().mockResolvedValue(false),
    isCancel: (value: unknown) => typeof value === 'symbol',
    log: { info: noop, message: noop, warn: noop, error: vi.fn(), step: noop, success: noop },
    spinner: () => ({ start: noop, stop: noop }),
  };
});
vi.mock('../src/telemetry.ts', () => ({
  track: vi.fn(),
  setVersion: vi.fn(),
  fetchAuditData: vi.fn().mockResolvedValue(null),
}));
vi.mock('../src/detect-agent.ts', () => ({
  detectAgent: vi.fn().mockResolvedValue({ isAgent: false, agent: { name: 'none' } }),
  getAgentType: vi.fn(),
  ensureUniversalAgents: (agents: string[]) => agents,
}));
vi.mock('../src/source-parser.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/source-parser.ts')>();
  return { ...actual, isRepoPrivate: vi.fn().mockResolvedValue(false) };
});
vi.mock('../src/agents.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/agents.ts')>();
  return { ...actual, detectInstalledAgents: vi.fn().mockResolvedValue(['claude-code']) };
});

import { runAdd, type AddOptions } from '../src/add.ts';
import * as installer from '../src/installer.ts';
import * as prompts from '@clack/prompts';
import { readLocalLock } from '../src/local-lock.ts';
import * as globalLock from '../src/skill-lock.ts';
import { detectInstalledAgents } from '../src/agents.ts';

const baseUrl = 'https://skills.example.com';
const content = '---\nname: remote-eve\ndescription: Remote Eve fixture\n---\n# Remote fixture\n';
let project: string;
let originalCwd: string;

function location(subagent?: string): string {
  return subagent
    ? join(project, 'agent', 'subagents', subagent, 'skills', 'remote-eve', 'SKILL.md')
    : join(project, 'agent', 'skills', 'remote-eve', 'SKILL.md');
}

async function install(options: AddOptions = {}): Promise<void> {
  await runAdd([baseUrl], { agent: ['eve'], copy: true, yes: true, ...options });
}

beforeEach(async () => {
  vi.clearAllMocks();
  vi.stubEnv('DISABLE_TELEMETRY', '1');
  vi.stubEnv('DO_NOT_TRACK', '1');
  process.exitCode = undefined;
  project = await mkdtemp(join(tmpdir(), 'wellknown-eve-'));
  originalCwd = process.cwd();
  process.chdir(project);
  await mkdir(join(project, 'agent', 'subagents', 'research'), { recursive: true });
  await writeFile(
    join(project, 'package.json'),
    JSON.stringify({ dependencies: { eve: '^0.11.5' } })
  );
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/.well-known/skills/index.json')) {
        return Response.json({
          skills: [
            {
              name: 'remote-eve',
              description: 'Remote Eve fixture',
              files: ['SKILL.md', 'references/note.md'],
            },
          ],
        });
      }
      if (url.endsWith('/.well-known/skills/remote-eve/SKILL.md')) return new Response(content);
      if (url.endsWith('/.well-known/skills/remote-eve/references/note.md'))
        return new Response('Reference fixture\n');
      return new Response(null, { status: 404 });
    })
  );
});

afterEach(async () => {
  process.chdir(originalCwd);
  process.exitCode = undefined;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  await rm(project, { recursive: true, force: true });
});

describe('well-known Eve subagents', () => {
  it('writes the named subagent and records its placement', async () => {
    await install({ subagent: ['research'] });
    expect(await readFile(location('research'), 'utf8')).toContain('# Remote fixture');
    expect(existsSync(location())).toBe(false);
    expect(
      await readFile(
        join(project, 'agent/subagents/research/skills/remote-eve/references/note.md'),
        'utf8'
      )
    ).toBe('Reference fixture\n');
    const lock = await readLocalLock(project);
    expect(lock.skills['remote-eve']?.subagents).toEqual(['research']);
  });

  it.each(['root', '.'])('supports the %s root alias', async (alias) => {
    await install({ subagent: [alias] });
    expect(await readFile(location(), 'utf8')).toContain('# Remote fixture');
    expect(existsSync(location(alias))).toBe(false);
  });

  it('expands and deduplicates root and multiple named targets', async () => {
    await install({ subagent: ['root', 'research', '.', 'writer', 'research'] });
    for (const subagent of [undefined, 'research', 'writer']) {
      expect(await readFile(location(subagent), 'utf8')).toContain('# Remote fixture');
    }
    const lock = await readLocalLock(project);
    expect(lock.skills['remote-eve']?.subagents).toEqual(['', 'research', 'writer']);
  });

  it('adds Eve when a subagent is requested alongside another agent', async () => {
    await mkdir(join(project, '.claude'), { recursive: true });
    await install({ agent: ['claude-code'], subagent: ['research'] });
    expect(await readFile(location('research'), 'utf8')).toContain('# Remote fixture');
    expect(await readFile(join(project, '.claude/skills/remote-eve/SKILL.md'), 'utf8')).toContain(
      '# Remote fixture'
    );
    expect(existsSync(location())).toBe(false);
  });

  it('offers the existing subagent selection in interactive mode', async () => {
    await install({ yes: false });
    expect(prompts.multiselect).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Where should Eve skills be installed?' })
    );
    expect(await readFile(location('research'), 'utf8')).toContain('# Remote fixture');
    expect(existsSync(location())).toBe(false);
  });

  it('uses the actual named target in preview and overwrite detection', async () => {
    await mkdir(join(project, 'agent/subagents/research/skills/remote-eve'), { recursive: true });
    await writeFile(location('research'), content);
    await install({ subagent: ['research'] });
    const preview = vi
      .mocked(prompts.note)
      .mock.calls.find((call) => call[1] === 'Installation Summary')?.[0];
    expect(preview).toContain('research');
    expect(preview).toContain('overwrites:');
    expect(preview).toContain('Eve (research)');
  });

  it.each([true, false])('routes mixed Eve and ordinary targets, copy=%s', async (copy) => {
    await mkdir(join(project, '.claude'), { recursive: true });
    await install({ agent: ['eve', 'claude-code'], subagent: ['research'], copy });
    expect(await readFile(location('research'), 'utf8')).toContain('# Remote fixture');
    expect(await readFile(join(project, '.claude/skills/remote-eve/SKILL.md'), 'utf8')).toContain(
      '# Remote fixture'
    );
    expect(existsSync(location())).toBe(false);
  });

  it('rejects global Eve subagents before writing targets or a lock', async () => {
    const installSpy = vi.spyOn(installer, 'installWellKnownSkillForAgent');
    await install({ subagent: ['research'], global: true });
    expect(process.exitCode).toBe(1);
    expect(installSpy).not.toHaveBeenCalled();
    expect(existsSync(location())).toBe(false);
    expect(existsSync(location('research'))).toBe(false);
    expect(existsSync(join(project, 'skills-lock.json'))).toBe(false);
  });

  it('records only Eve targets that installed successfully', async () => {
    const actual = installer.installWellKnownSkillForAgent;
    vi.spyOn(installer, 'installWellKnownSkillForAgent').mockImplementation(
      async (skill, agent, options) => {
        if (options?.eveSubagent === 'blocked')
          return { success: false, path: '', mode: 'copy', error: 'Fixture target failure' };
        return actual(skill, agent, options);
      }
    );
    await install({ subagent: ['research', 'blocked'] });
    expect((await readLocalLock(project)).skills['remote-eve']?.subagents).toEqual(['research']);
    expect(existsSync(location('blocked'))).toBe(false);
  });

  it.each([{ agent: [] }, { agent: ['*'] }])(
    'does not reject ordinary global batch targets, agents=$agent',
    async ({ agent }) => {
      vi.mocked(detectInstalledAgents).mockResolvedValueOnce([]);
      vi.spyOn(globalLock, 'addSkillToLock').mockResolvedValue();
      vi.spyOn(installer, 'isSkillInstalled').mockResolvedValue(false);
      const installSpy = vi
        .spyOn(installer, 'installWellKnownSkillForAgent')
        .mockImplementation(async (_skill, agent) =>
          agent === 'eve'
            ? { success: false, path: '', mode: 'copy', error: 'Eve is project-only' }
            : { success: true, path: join(project, 'fixture-global-result'), mode: 'copy' }
        );
      await runAdd([baseUrl], { global: true, yes: true, copy: true, agent });
      expect(installSpy).toHaveBeenCalled();
      expect(process.exitCode).toBeUndefined();
      expect(prompts.log.error).not.toHaveBeenCalledWith(
        'Eve skills and subagents only support project installation.'
      );
    }
  );

  it('does not create a lock entry when every named target fails', async () => {
    vi.spyOn(installer, 'installWellKnownSkillForAgent').mockResolvedValue({
      success: false,
      path: '',
      mode: 'copy',
      error: 'Fixture target failure',
    });
    await install({ subagent: ['research', 'writer'] });
    expect(existsSync(join(project, 'skills-lock.json'))).toBe(false);
    expect(existsSync(location('research'))).toBe(false);
    expect(prompts.log.error).toHaveBeenCalled();
  });

  it('strips terminal commands from subagent display labels', async () => {
    const command = '\u001b]0;injected-title\u0007';
    await install({ subagent: [`research${command}`] });
    const previews = vi
      .mocked(prompts.note)
      .mock.calls.map((call) => String(call[0]))
      .join('\n');
    expect(previews).toContain('Eve (research)');
    expect(previews).not.toContain(command);
  });
});
