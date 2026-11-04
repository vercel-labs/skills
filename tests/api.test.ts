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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Api = typeof import('../src/index.ts');

const ENV_KEYS = ['HOME', 'XDG_CONFIG_HOME', 'XDG_STATE_HOME', 'DISABLE_TELEMETRY'] as const;
// Agent home overrides; any of them would point global installs outside the temp HOME.
const AGENT_HOME_KEYS = [
  'APPDATA',
  'AUTOHAND_HOME',
  'CLAUDE_CONFIG_DIR',
  'CODEX_HOME',
  'FLATPAK_XDG_CONFIG_HOME',
  'GROK_HOME',
  'HERMES_HOME',
  'REASONIX_HOME',
  'SARVAM_HOME',
  'VIBE_HOME',
];

let root: string;
let cwd: string;
let source: string;
let savedEnv: Record<string, string | undefined>;
let api: Api;

function writeSkill(dir: string, name: string): void {
  mkdirSync(join(dir, name), { recursive: true });
  writeFileSync(
    join(dir, name, 'SKILL.md'),
    `---\nname: ${name}\ndescription: The ${name} skill\n---\n\n# ${name}\n`
  );
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'skills-api-'));
  cwd = join(root, 'project');
  source = join(root, 'source');
  mkdirSync(join(cwd, '.claude'), { recursive: true });
  mkdirSync(join(cwd, '.cursor'), { recursive: true });
  writeSkill(join(source, 'skills'), 'alpha');
  writeSkill(join(source, 'skills'), 'beta');

  savedEnv = Object.fromEntries(
    [...ENV_KEYS, ...AGENT_HOME_KEYS].map((key) => [key, process.env[key]])
  );
  for (const key of AGENT_HOME_KEYS) delete process.env[key];
  process.env.HOME = join(root, 'home');
  process.env.XDG_CONFIG_HOME = join(root, 'home', '.config');
  process.env.XDG_STATE_HOME = join(root, 'home', '.local', 'state');
  process.env.DISABLE_TELEMETRY = '1';
  mkdirSync(process.env.HOME, { recursive: true });

  // Agent paths are computed from HOME when the module loads.
  vi.resetModules();
  api = await import('../src/index.ts');
});

afterEach(() => {
  for (const key of [...ENV_KEYS, ...AGENT_HOME_KEYS]) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  vi.doUnmock('../src/add.ts');
  rmSync(root, { recursive: true, force: true });
});

async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  await expect(promise).rejects.toMatchObject({ name: 'SkillsError', code });
}

describe('agents', () => {
  it('lists supported agents as frozen records without the universal pseudo-agent', () => {
    const agents = api.getAgents();
    const claude = agents.find((agent) => agent.id === 'claude-code');
    expect(claude).toMatchObject({ name: 'Claude Code', projectSkillsDir: '.claude/skills' });
    expect(agents.some((agent) => agent.id === 'universal')).toBe(false);
    expect(Object.isFrozen(agents)).toBe(true);
    expect(Object.isFrozen(claude)).toBe(true);
  });

  it('limits detected agents to config.agents', async () => {
    mkdirSync(join(process.env.HOME!, '.claude'), { recursive: true });
    const all = await api.detectAgents({ cwd });
    expect(all.agents.map((agent) => agent.id)).toContain('claude-code');

    const limited = await api.detectAgents({
      cwd,
      config: { agents: { exclude: ['claude-code'] } },
    });
    expect(limited.agents.map((agent) => agent.id)).not.toContain('claude-code');
  });

  it('rejects unknown agents in config', async () => {
    await expectCode(
      api.detectAgents({ config: { agents: { include: ['nope'] } } }),
      'UNKNOWN_AGENT'
    );
  });
});

describe('resolveSource', () => {
  it('previews skills and can be disposed more than once', async () => {
    const handle = await api.resolveSource(source, { cwd });
    expect(handle.source).toMatchObject({ input: source, type: 'local', url: source });
    expect(handle.skills.map((skill) => skill.name).sort()).toEqual(['alpha', 'beta']);
    await handle.dispose();
    await handle.dispose();
    await expectCode(api.installSkills(handle, { cwd }), 'SOURCE_DISPOSED');
  });

  it('resolves relative local paths against cwd', async () => {
    const handle = await api.resolveSource('../source', { cwd });
    expect(handle.source.url).toBe(source);
    await handle.dispose();
  });

  it('reports a missing local path', async () => {
    await expectCode(api.resolveSource('./missing', { cwd }), 'SOURCE_NOT_FOUND');
  });

  it('honors an aborted signal', async () => {
    const controller = new AbortController();
    controller.abort();
    await expectCode(api.resolveSource(source, { cwd, signal: controller.signal }), 'ABORTED');
  });
});

describe('installSkills', () => {
  it('installs the named skills into the named agents and records the project lock', async () => {
    const events: string[] = [];
    const result = await api.installSkills(source, {
      cwd,
      skills: ['alpha'],
      agents: ['claude-code', 'cursor'],
      onProgress: (event) => events.push(event.type),
    });

    expect(result.failed).toEqual([]);
    expect(result.installed.map((t) => [t.skill, t.agent, t.scope]).sort()).toEqual([
      ['alpha', 'claude-code', 'project'],
      ['alpha', 'cursor', 'project'],
    ]);
    const claude = result.installed.find((t) => t.agent === 'claude-code')!;
    expect(claude.mode).toBe('symlink');
    expect(lstatSync(join(cwd, '.claude/skills/alpha')).isSymbolicLink()).toBe(true);
    expect(existsSync(join(cwd, '.agents/skills/alpha/SKILL.md'))).toBe(true);
    expect(existsSync(join(cwd, '.agents/skills/beta'))).toBe(false);

    const lock = JSON.parse(readFileSync(join(cwd, 'skills-lock.json'), 'utf-8'));
    expect(Object.keys(lock.skills)).toEqual(['alpha']);
    expect(events).toEqual(['resolve:start', 'resolve:done', 'install:start', 'install:done']);
  });

  it('installs from a resolved source and leaves it for the caller to dispose', async () => {
    const handle = await api.resolveSource(source, { cwd });
    const first = await api.installSkills(handle, { cwd, skills: ['alpha'], agents: ['cursor'] });
    const second = await api.installSkills(handle, { cwd, skills: ['beta'], agents: ['cursor'] });
    await handle.dispose();
    expect(first.installed.map((t) => t.skill)).toEqual(['alpha']);
    expect(second.installed.map((t) => t.skill)).toEqual(['beta']);
  });

  it('skips the lock file when lockfile is false', async () => {
    await api.installSkills(source, { cwd, agents: ['cursor'], lockfile: false });
    expect(existsSync(join(cwd, 'skills-lock.json'))).toBe(false);
  });

  it('lets call options override config, and config override defaults', async () => {
    const config = { mode: 'copy' as const, agents: { default: ['claude-code'] } };
    const fromConfig = await api.installSkills(source, { cwd, skills: ['alpha'], config });
    expect(fromConfig.installed.map((t) => [t.agent, t.mode])).toEqual([['claude-code', 'copy']]);
    expect(lstatSync(join(cwd, '.claude/skills/alpha')).isSymbolicLink()).toBe(false);

    const overridden = await api.installSkills(source, {
      cwd,
      skills: ['beta'],
      mode: 'symlink',
      config,
    });
    expect(overridden.installed.map((t) => t.mode)).toEqual(['symlink']);
    expect(lstatSync(join(cwd, '.claude/skills/beta')).isSymbolicLink()).toBe(true);
  });

  it('reports agents config does not allow and installs into the rest', async () => {
    const result = await api.installSkills(source, {
      cwd,
      skills: ['alpha'],
      agents: ['claude-code', 'cursor'],
      config: { agents: { exclude: ['cursor'] } },
    });
    expect(result.installed.map((t) => t.agent)).toEqual(['claude-code']);
    expect(result.failed).toEqual([
      expect.objectContaining({ skill: 'alpha', agent: 'cursor', code: 'AGENT_NOT_ALLOWED' }),
    ]);
  });

  it('throws when no allowed agent is left', async () => {
    await expectCode(
      api.installSkills(source, {
        cwd,
        agents: ['cursor'],
        config: { agents: { include: ['claude-code'] } },
      }),
      'NO_TARGET_AGENTS'
    );
  });

  it('rejects unknown skills and agents before writing anything', async () => {
    await expectCode(api.installSkills(source, { cwd, skills: ['gamma'] }), 'SKILL_NOT_FOUND');
    await expectCode(api.installSkills(source, { cwd, agents: ['nope'] }), 'UNKNOWN_AGENT');
    await expectCode(api.installSkills(source, { cwd, scope: 'nope' as never }), 'INVALID_OPTIONS');
    expect(existsSync(join(cwd, '.agents'))).toBe(false);
  });

  it('reports an invalid project lock instead of overwriting it', async () => {
    writeFileSync(join(cwd, 'skills-lock.json'), '{ not json');
    await expectCode(api.installSkills(source, { cwd, agents: ['cursor'] }), 'INVALID_LOCKFILE');
  });

  it('installs globally into the home directory', async () => {
    const result = await api.installSkills(source, {
      cwd,
      skills: ['alpha'],
      agents: ['claude-code'],
      scope: 'global',
    });
    expect(result.installed).toEqual([
      expect.objectContaining({ agent: 'claude-code', scope: 'global' }),
    ]);
    expect(result.installed[0]!.path.startsWith(process.env.HOME!)).toBe(true);
    expect(existsSync(join(process.env.HOME!, '.claude/skills/alpha/SKILL.md'))).toBe(true);
    const lock = JSON.parse(
      readFileSync(join(process.env.XDG_STATE_HOME!, 'skills/.skill-lock.json'), 'utf-8')
    );
    expect(Object.keys(lock.skills)).toEqual(['alpha']);
  });
});

describe('telemetry', () => {
  it('is sent unless turned off per call or in config', async () => {
    const trackSourceInstall = vi.fn(async () => {});
    vi.doMock('../src/add.ts', async (importOriginal) => ({
      ...(await importOriginal<typeof import('../src/add.ts')>()),
      trackSourceInstall,
    }));
    vi.resetModules();
    const mocked: Api = await import('../src/index.ts');

    await mocked.installSkills(source, { cwd, skills: ['alpha'], agents: ['cursor'] });
    expect(trackSourceInstall).toHaveBeenCalledTimes(1);

    await mocked.installSkills(source, { cwd, agents: ['cursor'], telemetry: false });
    await mocked.installSkills(source, { cwd, agents: ['cursor'], config: { telemetry: false } });
    expect(trackSourceInstall).toHaveBeenCalledTimes(1);
  });
});

describe('listSkills and removeSkills', () => {
  it('lists installed skills with their lock source, then removes them', async () => {
    await api.installSkills(source, { cwd, agents: ['claude-code'] });

    const listed = await api.listSkills({ cwd, scope: 'project' });
    expect(listed.skills.map((skill) => [skill.name, skill.scope]).sort()).toEqual([
      ['alpha', 'project'],
      ['beta', 'project'],
    ]);
    expect(listed.skills[0]!.source).toBe(source);

    const removed = await api.removeSkills(['alpha', 'nope'], { cwd });
    expect(removed).toEqual({ removed: ['alpha'], notFound: ['nope'], failed: [] });
    expect(existsSync(join(cwd, '.agents/skills/alpha'))).toBe(false);
    expect(existsSync(join(cwd, '.claude/skills/alpha'))).toBe(false);
    const lock = JSON.parse(readFileSync(join(cwd, 'skills-lock.json'), 'utf-8'));
    expect(Object.keys(lock.skills)).toEqual(['beta']);

    const rest = await api.removeSkills(['*'], { cwd });
    expect(rest.removed).toEqual(['beta']);
    expect((await api.listSkills({ cwd, scope: 'project' })).skills).toEqual([]);
  });

  it('refuses to remove from agents config does not allow', async () => {
    await expectCode(
      api.removeSkills(['alpha'], {
        cwd,
        agents: ['cursor'],
        config: { agents: { exclude: ['cursor'] } },
      }),
      'AGENT_NOT_ALLOWED'
    );
  });
});
