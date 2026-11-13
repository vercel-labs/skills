import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { execFileSync } from 'child_process';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Api = typeof import('../src/index.ts');
type DiagnosticCode = import('../src/index.ts').DiagnosticCode;

// USERPROFILE is what os.homedir() reads on Windows.
const ENV_KEYS = [
  'HOME',
  'USERPROFILE',
  'XDG_CONFIG_HOME',
  'XDG_STATE_HOME',
  'DISABLE_TELEMETRY',
] as const;
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
  process.env.USERPROFILE = process.env.HOME;
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

async function expectCode(promise: Promise<unknown>, code: DiagnosticCode): Promise<void> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e
  );
  expect(error).toMatchObject({ code });
  expect(api.isDiagnostic(error, code)).toBe(true);
}

describe('agents', () => {
  it('lists supported agents as frozen records, including the neutral universal target', () => {
    const agents = api.getSupportedAgents();
    const claude = agents.find((agent) => agent.id === 'claude-code');
    expect(claude).toMatchObject({ name: 'Claude Code', projectSkillsDir: '.claude/skills' });
    expect(agents.find((agent) => agent.id === 'universal')).toMatchObject({
      projectSkillsDir: '.agents/skills',
      universal: true,
    });
    expect(Object.isFrozen(agents)).toBe(true);
    expect(Object.isFrozen(claude)).toBe(true);
  });

  it('detects agents from project markers in cwd', async () => {
    const other = join(root, 'other');
    mkdirSync(join(other, '.continue'), { recursive: true });
    const inOther = await api.detectAgents({ cwd: other });
    expect(inOther.agents.map((agent) => agent.id)).toContain('continue');
    const inCwd = await api.detectAgents({ cwd });
    expect(inCwd.agents.map((agent) => agent.id)).not.toContain('continue');
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
      'SKILLS_INVALID_AGENTS'
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
    await expectCode(api.installSkills(handle, { cwd }), 'SKILLS_SOURCE_DISPOSED');
  });

  it('resolves relative local paths against cwd', async () => {
    const handle = await api.resolveSource('../source', { cwd });
    expect(handle.source.url).toBe(source);
    await handle.dispose();
  });

  it('reports a missing local path', async () => {
    await expectCode(api.resolveSource('./missing', { cwd }), 'SKILLS_LOCAL_PATH_NOT_FOUND');
  });

  it('honors an aborted signal', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      api.resolveSource(source, { cwd, signal: controller.signal })
    ).rejects.toMatchObject({
      name: 'AbortError',
    });
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
      expect.objectContaining({
        skill: 'alpha',
        agent: 'cursor',
        code: 'SKILLS_AGENT_NOT_ALLOWED',
      }),
    ]);
  });

  it('throws when no allowed agent is left', async () => {
    await expectCode(
      api.installSkills(source, {
        cwd,
        agents: ['cursor'],
        config: { agents: { include: ['claude-code'] } },
      }),
      'SKILLS_NO_TARGET_AGENTS'
    );
  });

  it('rejects unknown skills and agents before writing anything', async () => {
    await expectCode(
      api.installSkills(source, { cwd, skills: ['gamma'] }),
      'SKILLS_NO_MATCHING_SKILLS'
    );
    await expectCode(api.installSkills(source, { cwd, agents: ['nope'] }), 'SKILLS_INVALID_AGENTS');
    await expectCode(
      api.installSkills(source, { cwd, scope: 'nope' as never }),
      'SKILLS_INVALID_OPTION_VALUE'
    );
    expect(existsSync(join(cwd, '.agents'))).toBe(false);
  });

  it('reports an invalid project lock instead of overwriting it', async () => {
    writeFileSync(join(cwd, 'skills-lock.json'), '{ not json');
    await expectCode(
      api.installSkills(source, { cwd, agents: ['cursor'] }),
      'SKILLS_INVALID_LOCAL_LOCK'
    );
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

describe('rename', () => {
  const lockOf = () => JSON.parse(readFileSync(join(cwd, 'skills-lock.json'), 'utf-8'));
  const skillMd = (name: string) =>
    readFileSync(join(cwd, `.claude/skills/${name}/SKILL.md`), 'utf-8');

  it('installs a skill under a new name and lists where it came from', async () => {
    const result = await api.installSkills(source, {
      cwd,
      skills: ['alpha'],
      rename: { alpha: 'gamma' },
      agents: ['claude-code'],
    });

    expect(result.installed.map((target) => target.skill)).toEqual(['gamma']);
    expect(skillMd('gamma')).toContain('name: gamma\n');
    expect(lockOf().skills.gamma.skillName).toBe('alpha');
    const listed = await api.listSkills({ cwd, scope: 'project' });
    expect(listed.skills).toEqual([
      expect.objectContaining({ name: 'gamma', source, renamedFrom: 'alpha' }),
    ]);
  });

  it('renames several skills in one call and installs the rest as-is', async () => {
    await api.installSkills(source, {
      cwd,
      rename: { alpha: 'gamma', beta: 'delta' },
      agents: ['claude-code'],
    });

    expect(skillMd('gamma')).toContain('name: gamma\n');
    expect(skillMd('delta')).toContain('name: delta\n');
    expect(lockOf().skills).toEqual({
      gamma: expect.objectContaining({ skillName: 'alpha' }),
      delta: expect.objectContaining({ skillName: 'beta' }),
    });

    writeSkill(join(source, 'skills'), 'epsilon');
    await api.installSkills(source, {
      cwd,
      skills: ['alpha', 'epsilon'],
      rename: { alpha: 'zeta' },
      agents: ['claude-code'],
    });
    expect(lockOf().skills.zeta.skillName).toBe('alpha');
    expect(lockOf().skills.epsilon.skillName).toBeUndefined();
  });

  it('rejects a bad map before writing anything', async () => {
    const install = (rename: unknown, skills?: string[]) =>
      api.installSkills(source, {
        cwd,
        agents: ['claude-code'],
        ...(skills && { skills }),
        rename: rename as Record<string, string>,
      });

    await expect(install('gamma')).rejects.toMatchObject({ code: 'SKILLS_INVALID_OPTION_VALUE' });
    await expect(install({ alpha: '../gamma' })).rejects.toMatchObject({
      code: 'SKILLS_INVALID_OPTION_VALUE',
    });
    // A key must name a skill being installed
    await expect(install({ nope: 'gamma' })).rejects.toMatchObject({
      code: 'SKILLS_NO_MATCHING_SKILLS',
    });
    await expect(install({ beta: 'gamma' }, ['alpha'])).rejects.toMatchObject({
      code: 'SKILLS_NO_MATCHING_SKILLS',
    });
    // No two skills may end up with one name
    await expect(install({ alpha: 'beta' })).rejects.toMatchObject({
      code: 'SKILLS_INVALID_OPTION_VALUE',
    });
    await expect(install({ alpha: 'gamma', beta: 'gamma' })).rejects.toMatchObject({
      code: 'SKILLS_INVALID_OPTION_VALUE',
    });
    expect(existsSync(join(cwd, 'skills-lock.json'))).toBe(false);
    expect(existsSync(join(cwd, '.claude/skills'))).toBe(false);
  });

  it('can swap the names of two skills', async () => {
    await api.installSkills(source, {
      cwd,
      rename: { alpha: 'beta', beta: 'alpha' },
      agents: ['claude-code'],
    });

    expect(skillMd('beta')).toContain('The alpha skill');
    expect(lockOf().skills.beta.skillName).toBe('alpha');
    expect(lockOf().skills.alpha.skillName).toBe('beta');
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

  it("removes only lock-tracked skills for '*' and warns about untracked dirs (#604)", async () => {
    await api.installSkills(source, { cwd, skills: ['alpha'], agents: ['claude-code'] });
    const mine = join(cwd, '.agents/skills/mine');
    mkdirSync(mine, { recursive: true });
    writeFileSync(join(mine, 'SKILL.md'), '---\nname: mine\ndescription: mine\n---\n');
    const warnings: string[] = [];

    const removed = await api.removeSkills(['*'], {
      cwd,
      onWarning: (warning) => warnings.push(warning.code),
    });

    expect(removed.removed).toEqual(['alpha']);
    expect(existsSync(join(mine, 'SKILL.md'))).toBe(true);
    expect(warnings).toEqual(['SKILLS_REMOVE_UNTRACKED_SKIPPED']);
  });

  it("keeps a user's skills/<name> folder that is not an installed copy (#1771)", async () => {
    await api.installSkills(source, { cwd, skills: ['alpha'], agents: ['claude-code'] });
    const mine = join(cwd, 'skills/alpha');
    mkdirSync(mine, { recursive: true });
    writeFileSync(join(mine, 'SKILL.md'), '---\nname: alpha\ndescription: mine\n---\n');
    const warnings: string[] = [];

    const removed = await api.removeSkills(['alpha'], {
      cwd,
      onWarning: (warning) => warnings.push(warning.code),
    });

    expect(removed.removed).toEqual(['alpha']);
    expect(existsSync(join(mine, 'SKILL.md'))).toBe(true);
    expect(existsSync(join(cwd, '.agents/skills/alpha'))).toBe(false);
    expect(warnings).toEqual(['SKILLS_REMOVE_UNMANAGED_DIR_KEPT']);
  });

  it('removes a skill linked into .agents/skills and keeps the link target (#2679)', async () => {
    const skillLink = join(cwd, '.agents/skills/alpha');
    mkdirSync(join(cwd, '.agents/skills'), { recursive: true });
    symlinkSync(join(source, 'skills', 'alpha'), skillLink, 'junction');

    const removed = await api.removeSkills(['alpha'], { cwd });

    expect(removed).toEqual({ removed: ['alpha'], notFound: [], failed: [] });
    expect(lstatSync(skillLink, { throwIfNoEntry: false })).toBeUndefined();
    expect(existsSync(join(source, 'skills', 'alpha', 'SKILL.md'))).toBe(true);
  });

  it('refuses to remove from agents config does not allow', async () => {
    await expectCode(
      api.removeSkills(['alpha'], {
        cwd,
        agents: ['cursor'],
        config: { agents: { exclude: ['cursor'] } },
      }),
      'SKILLS_AGENT_NOT_ALLOWED'
    );
  });
});

/** Commit `source` as a git repository and return its file:// URL and commit SHA. */
function gitRepo(dir: string): { url: string; sha: string } {
  const git = (...args: string[]) =>
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
      cwd: dir,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  git('init', '-q');
  git('add', '.');
  git('commit', '-q', '-m', 'skills');
  return { url: pathToFileURL(dir).href, sha: git('rev-parse', 'HEAD').trim() };
}

const unixOnly = it.skipIf(process.platform === 'win32');

describe('warnings', () => {
  it('routes skipped SKILL.md files to onWarning and never to the console', async () => {
    mkdirSync(join(source, 'skills', 'broken'), { recursive: true });
    writeFileSync(join(source, 'skills', 'broken', 'SKILL.md'), '# no frontmatter\n');
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const warnings: string[] = [];

    const silent = await api.resolveSource(source, { cwd });
    await silent.dispose();
    const reported = await api.resolveSource(source, {
      cwd,
      onWarning: (warning) =>
        warnings.push(`${warning.code} ${(warning.data as { path: string }).path}`),
    });
    await reported.dispose();

    expect(consoleWarn).not.toHaveBeenCalled();
    consoleWarn.mockRestore();
    expect(warnings).toEqual([
      `SKILLS_SKILL_SKIPPED ${join(source, 'skills', 'broken', 'SKILL.md')}`,
    ]);
  });
});

describe('skill paths and duplicate names', () => {
  it('reports each skill path and the other folders declaring its name', async () => {
    writeSkill(join(source, '.claude', 'skills'), 'alpha');
    const handle = await api.resolveSource(source, { cwd });
    const alpha = handle.skills.find((skill) => skill.name === 'alpha')!;
    const beta = handle.skills.find((skill) => skill.name === 'beta')!;
    expect(alpha).toMatchObject({ path: 'skills/alpha', duplicates: ['.claude/skills/alpha'] });
    expect(beta.path).toBe('skills/beta');
    expect(beta.duplicates).toBeUndefined();
    expect(handle.skills.filter((skill) => skill.name === 'alpha')).toHaveLength(1);

    // The first definition wins by default; `duplicates: 'error'` refuses it.
    const result = await api.installSkills(handle, { cwd, skills: ['alpha'], agents: ['cursor'] });
    expect(result.installed.map((t) => t.skill)).toEqual(['alpha']);
    await expectCode(
      api.installSkills(handle, { cwd, skills: ['alpha'], duplicates: 'error' }),
      'SKILLS_DUPLICATE_SKILL_NAME'
    );
    await expectCode(
      api.installSkills(handle, { cwd, config: { duplicates: 'error' } }),
      'SKILLS_DUPLICATE_SKILL_NAME'
    );
    // Selecting only unambiguous skills is fine in strict mode.
    await api.installSkills(handle, {
      cwd,
      skills: ['beta'],
      agents: ['cursor'],
      duplicates: 'error',
    });
    await handle.dispose();
  });

  unixOnly('ignores symlinked skill folders, so they are never duplicates', async () => {
    mkdirSync(join(source, '.claude', 'skills'), { recursive: true });
    symlinkSync(join(source, 'skills', 'alpha'), join(source, '.claude', 'skills', 'alpha'));
    const handle = await api.resolveSource(source, { cwd });
    expect(handle.skills.find((skill) => skill.name === 'alpha')?.duplicates).toBeUndefined();
    await handle.dispose();
  });

  it('refuses a requested name that matches several different skills', async () => {
    writeSkill(join(source, 'skills'), 'Foo Bar');
    writeSkill(join(source, 'skills'), 'foo_bar');
    await expectCode(
      api.installSkills(source, { cwd, skills: ['foo-bar'] }),
      'SKILLS_AMBIGUOUS_SKILL_SELECTOR'
    );
    const exact = await api.installSkills(source, {
      cwd,
      skills: ['foo_bar'],
      agents: ['cursor'],
    });
    expect(exact.installed.map((t) => t.skill)).toEqual(['foo_bar']);
  });
});

describe('symlinks', () => {
  unixOnly('rejects skills containing symlinks only when asked to', async () => {
    writeFileSync(join(source, 'skills', 'alpha', 'notes.md'), 'notes');
    symlinkSync('notes.md', join(source, 'skills', 'alpha', 'link.md'));

    await expectCode(
      api.installSkills(source, { cwd, skills: ['alpha'], symlinks: 'reject' }),
      'SKILLS_SKILL_CONTAINS_SYMLINKS'
    );
    expect(existsSync(join(cwd, '.agents'))).toBe(false);

    // Skills without symlinks install in strict mode; the default follows links.
    await api.installSkills(source, {
      cwd,
      skills: ['beta'],
      agents: ['cursor'],
      symlinks: 'reject',
    });
    await api.installSkills(source, { cwd, skills: ['alpha'], agents: ['cursor'] });
    expect(readFileSync(join(cwd, '.agents/skills/alpha/link.md'), 'utf-8')).toBe('notes');
  });
});

describe('universal target', () => {
  it('copies skills into .agents/skills without agent directories', async () => {
    const stage = join(root, 'stage');
    mkdirSync(stage);
    const result = await api.installSkills(source, {
      cwd: stage,
      skills: ['alpha'],
      agents: ['universal'],
      mode: 'copy',
      lockfile: false,
      telemetry: false,
    });
    expect(result.installed).toEqual([
      expect.objectContaining({
        agent: 'universal',
        mode: 'copy',
        path: join(stage, '.agents/skills/alpha'),
      }),
    ]);
    expect(lstatSync(join(stage, '.agents/skills/alpha')).isDirectory()).toBe(true);
    expect(existsSync(join(stage, 'skills-lock.json'))).toBe(false);
  });
});

describe('download sources', () => {
  it('reports skill paths relative to the downloaded root', async () => {
    const url = 'https://downloads.example.com/skills/direct-skill';
    const skillMd = '---\nname: direct-skill\ndescription: Direct skill\n---\n\n# Direct\n';
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input) =>
        String(input) === url
          ? new Response(skillMd, { headers: { 'content-length': String(skillMd.length) } })
          : new Response('not found', { status: 404 })
      );
    try {
      const handle = await api.resolveSource(url, { cwd });
      expect(handle.skills).toEqual([expect.objectContaining({ name: 'direct-skill', path: '.' })]);
      await handle.dispose();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('locks a direct download by its URL', async () => {
    const url = 'https://downloads.example.com/skills/locked-skill';
    const skillMd = '---\nname: locked-skill\ndescription: Locked skill\n---\n';
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input) =>
        String(input) === url ? new Response(skillMd) : new Response('not found', { status: 404 })
      );
    try {
      await api.installSkills(url, { cwd, agents: ['cursor'] });
      const lock = JSON.parse(readFileSync(join(cwd, 'skills-lock.json'), 'utf-8'));
      expect(lock.skills['locked-skill']).toMatchObject({
        source: url,
        sourceUrl: url,
        sourceType: 'download',
        skillPath: 'SKILL.md',
      });
    } finally {
      fetchSpy.mockRestore();
    }
  });
});

describe('git sources', { timeout: 30000 }, () => {
  it('reports the checked-out commit and honors a ref pinned to it', async () => {
    const repo = gitRepo(source);

    const latest = await api.resolveSource(repo.url, { cwd });
    expect(latest.source).toMatchObject({ type: 'git', commit: repo.sha });
    expect(latest.skills[0]?.path).toMatch(/^skills\//);
    await latest.dispose();

    const pinned = await api.resolveSource(repo.url, { cwd, ref: repo.sha });
    expect(pinned.source).toMatchObject({ ref: repo.sha, commit: repo.sha });
    await expectCode(
      api.installSkills(pinned, { cwd, ref: repo.sha }),
      'SKILLS_INVALID_OPTION_VALUE'
    );
    await pinned.dispose();

    const installed = await api.installSkills(repo.url, {
      cwd,
      ref: repo.sha,
      skills: ['alpha'],
      agents: ['cursor'],
    });
    expect(installed.source.commit).toBe(repo.sha);
  });

  it('classifies fetch failures and keeps the original error', async () => {
    const repo = gitRepo(source);
    await expectCode(
      api.resolveSource(repo.url, { cwd, ref: 'no-such-branch' }),
      'SKILLS_GIT_CLONE_FAILED'
    );

    const missing = pathToFileURL(join(root, 'missing-repo')).href;
    const error = await api.resolveSource(missing, { cwd }).catch((e: unknown) => e);
    // Git failures surface as the original diagnostic, not a wrapper.
    expect(api.isDiagnostic(error, 'SKILLS_GIT_CLONE_FAILED')).toBe(true);
  });

  it('accepts ref only for git sources', async () => {
    await expectCode(
      api.resolveSource(source, { cwd, ref: 'main' }),
      'SKILLS_INVALID_OPTION_VALUE'
    );
  });
});
