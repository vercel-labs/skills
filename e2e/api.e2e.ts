import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { describe, expect, inject, it } from 'vitest';
import { Sandbox, entries, isSymlink, readSkill, type JsonListEntry } from './sandbox.ts';

/**
 * The programmatic API as a consumer sees it: `import ... from 'skills'` from the
 * installed tarball, run against live sources. Each call runs in its own child
 * process with the sandbox HOME (see Sandbox.api). Unit coverage of the options
 * lives in tests/api.test.ts; this suite checks the packaged entry, real fetches,
 * and that API and CLI agree on disk layout and lock files.
 */
const GITHUB = 'vercel-labs/agent-skills';
const ONE = 'web-design-guidelines';
const TWO = 'vercel-react-best-practices';
const CLONED = 'anthropics/skills'; // not on the blob allowlist: always a git clone
const CLONED_SKILL = 'pdf';
const WELL_KNOWN = 'https://vercel.com';
const WELL_KNOWN_SKILL = 'deploy-to-vercel';

const repoRoot = resolve(import.meta.dirname, '..');
const repoPkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as {
  version: string;
};

describe('programmatic API', () => {
  it('exposes the version and the supported agents', async () => {
    const sandbox = await Sandbox.create('api-meta');
    const { value } = await sandbox.api<{ version: string; ids: string[]; claude: unknown }>(`
      const agents = api.getSupportedAgents();
      return {
        version: api.version,
        ids: agents.map((a) => a.id),
        claude: agents.find((a) => a.id === 'claude-code'),
      };
    `);
    if (!process.env.SKILLS_E2E_PACKAGE) expect(value.version).toBe(repoPkg.version);
    else expect(value.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(value.ids).toEqual(expect.arrayContaining(['claude-code', 'codex', 'universal']));
    expect(value.claude).toMatchObject({
      name: 'Claude Code',
      projectSkillsDir: '.claude/skills',
      universal: false,
    });
  });

  it('detects agents from the sandbox HOME and project only', async () => {
    const sandbox = await Sandbox.create('api-detect');
    const empty = await sandbox.api<string[]>(
      `return (await api.detectAgents({ cwd: project })).agents.map((a) => a.id);`
    );
    expect(empty.value).not.toContain('claude-code');

    await mkdir(sandbox.homePath('.claude'));
    const found = await sandbox.api<string[]>(
      `return (await api.detectAgents({ cwd: project })).agents.map((a) => a.id);`
    );
    expect(found.value).toContain('claude-code');
  });

  it('resolves, installs, lists, and removes a GitHub source without printing', async () => {
    const sandbox = await Sandbox.create('api-github');
    const run = await sandbox.api<{
      source: { type: string; url: string };
      names: string[];
      progress: string[];
      installed: { skill: string; agent: string; scope: string; mode: string; path: string }[];
      failed: unknown[];
      frozen: boolean;
      listed: { name: string; scope: string; agents: string[]; source?: string }[];
    }>(`
      const progress = [];
      const source = await api.resolveSource(${JSON.stringify(GITHUB)}, { cwd: project });
      try {
        const result = await api.installSkills(source, {
          cwd: project,
          skills: [${JSON.stringify(ONE)}, ${JSON.stringify(TWO)}],
          agents: ['claude-code', 'codex'],
          onProgress: (event) => progress.push(event.type),
        });
        const { skills: listed } = await api.listSkills({ cwd: project, scope: 'project' });
        return {
          source: source.source,
          names: source.skills.map((s) => s.name),
          progress,
          installed: result.installed,
          failed: result.failed,
          frozen: Object.isFrozen(result) && Object.isFrozen(result.installed),
          listed,
        };
      } finally {
        await source.dispose();
      }
    `);

    // API calls never print: nothing reaches the terminal.
    expect(run.stdout).toBe('');
    expect(run.stderr).toBe('');

    const { value } = run;
    expect(value.source).toMatchObject({ type: 'github' });
    expect(value.source.url).toContain('github.com/vercel-labs/agent-skills');
    expect(value.names).toEqual(expect.arrayContaining([ONE, TWO]));
    expect(value.progress).toEqual(['install:start', 'install:done']);
    expect(value.failed).toEqual([]);
    expect(value.frozen).toBe(true);
    expect(value.installed.map((t) => `${t.skill}:${t.agent}`).sort()).toEqual(
      [`${ONE}:claude-code`, `${ONE}:codex`, `${TWO}:claude-code`, `${TWO}:codex`].sort()
    );
    for (const target of value.installed) {
      expect(target).toMatchObject({ scope: 'project', mode: 'symlink' });
    }

    // Same layout and lock file as `skills add`.
    for (const name of [ONE, TWO]) {
      expect(readSkill(sandbox.path('.agents', 'skills', name)).name).toBe(name);
      expect(isSymlink(sandbox.path('.claude', 'skills', name))).toBe(true);
      expect(sandbox.projectLock().skills[name]).toMatchObject({
        source: GITHUB,
        sourceType: 'github',
      });
    }
    expect(value.listed.map((s) => s.name).sort()).toEqual([ONE, TWO].sort());
    for (const skill of value.listed) {
      expect(skill).toMatchObject({ scope: 'project', source: GITHUB });
      expect(skill.agents).toContain('claude-code');
    }

    // The CLI reads what the API wrote.
    const cliList = await sandbox.skillsJson<JsonListEntry[]>(['ls']);
    expect(cliList.map((s) => s.name).sort()).toEqual([ONE, TWO].sort());

    const removed = await sandbox.api<{ removed: string[]; notFound: string[]; failed: unknown[] }>(
      `return await api.removeSkills([${JSON.stringify(ONE)}, 'not-installed'], { cwd: project });`
    );
    expect(removed.stdout).toBe('');
    expect(removed.value).toEqual({ removed: [ONE], notFound: ['not-installed'], failed: [] });
    expect(existsSync(sandbox.path('.agents', 'skills', ONE))).toBe(false);
    expect(existsSync(sandbox.path('.claude', 'skills', ONE))).toBe(false);
    expect(sandbox.projectLock().skills[ONE]).toBeUndefined();
    expect(sandbox.projectLock().skills[TWO]).toBeDefined();
  });

  it('manages skills the CLI installed', async () => {
    const sandbox = await Sandbox.create('api-interop');
    await sandbox.skills(['add', GITHUB, '--skill', ONE, '-a', 'claude-code', '-y']);

    const { value } = await sandbox.api<{ listed: string[]; removed: string[] }>(`
      const { skills } = await api.listSkills({ cwd: project });
      const { removed } = await api.removeSkills(['*'], { cwd: project });
      return { listed: skills.map((s) => s.name + '@' + s.source), removed };
    `);
    expect(value.listed).toEqual([`${ONE}@${GITHUB}`]);
    expect(value.removed).toEqual([ONE]);
    expect(await sandbox.skillsJson(['ls'])).toEqual([]);
  });

  it('pins a git clone to a ref and reports the commit', async () => {
    const sandbox = await Sandbox.create('api-ref');
    const { value } = await sandbox.api<{
      ok: { type: string; ref?: string; commit?: string; skills: string[] };
      missingRef: string | null;
    }>(`
      const source = await api.resolveSource(${JSON.stringify(CLONED)}, { cwd: project, ref: 'main' });
      const ok = { ...source.source, skills: source.skills.map((s) => s.name) };
      await source.dispose();
      const missingRef = await codeOf(
        api.resolveSource(${JSON.stringify(CLONED)}, { cwd: project, ref: 'no-such-branch-e2e' })
      );
      return { ok, missingRef };
    `);
    expect(value.ok).toMatchObject({ type: 'github', ref: 'main' });
    expect(value.ok.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(value.ok.skills).toContain(CLONED_SKILL);
    expect(value.missingRef).toBe('SKILLS_GIT_CLONE_FAILED');
  });

  it('installs globally into HOME and records the global lock', async () => {
    const sandbox = await Sandbox.create('api-global');
    const { value } = await sandbox.api<{ paths: string[]; failed: unknown[] }>(`
      const result = await api.installSkills(${JSON.stringify(GITHUB)}, {
        cwd: project,
        scope: 'global',
        skills: [${JSON.stringify(ONE)}],
        agents: ['claude-code'],
      });
      return { paths: result.installed.map((t) => t.path), failed: result.failed };
    `);
    expect(value.failed).toEqual([]);
    expect(readSkill(sandbox.homePath('.claude', 'skills', ONE)).name).toBe(ONE);
    expect(entries(sandbox.project)).toEqual([]);
    expect(sandbox.globalLock().skills[ONE]).toMatchObject({
      source: GITHUB,
      sourceType: 'github',
    });
    expect(sandbox.globalLock().skills[ONE]!.skillFolderHash).toMatch(/^[0-9a-f]{40}$/);

    const cliList = await sandbox.skillsJson<JsonListEntry[]>(['ls', '-g']);
    expect(cliList.map((s) => s.name)).toEqual([ONE]);
  });

  it('copies a well-known skill into a plain directory without a lock file', async () => {
    const sandbox = await Sandbox.create('api-plain');
    const { value } = await sandbox.api<{
      type: string;
      installed: { agent: string; mode: string }[];
      failed: unknown[];
    }>(`
      const result = await api.installSkills(${JSON.stringify(WELL_KNOWN)}, {
        cwd: project,
        skills: [${JSON.stringify(WELL_KNOWN_SKILL)}],
        agents: ['universal'],
        mode: 'copy',
        lockfile: false,
        telemetry: false,
      });
      return { type: result.source.type, installed: result.installed, failed: result.failed };
    `);
    expect(value.type).toBe('well-known');
    expect(value.failed).toEqual([]);
    expect(value.installed).toMatchObject([{ agent: 'universal', mode: 'copy' }]);

    const dir = sandbox.path('.agents', 'skills', WELL_KNOWN_SKILL);
    expect(lstatSync(dir).isDirectory()).toBe(true);
    expect(readSkill(dir).name).toBe(WELL_KNOWN_SKILL);
    expect(entries(sandbox.project)).toEqual(['.agents']);
  });

  it('throws diagnostics that consumers can match by code', async () => {
    const sandbox = await Sandbox.create('api-errors');
    const { value } = await sandbox.api<Record<string, string | null>>(`
      const source = await api.resolveSource(${JSON.stringify(GITHUB)}, { cwd: project });
      const codes = {
        unknownAgent: await codeOf(api.installSkills(source, { cwd: project, agents: ['nope'] })),
        unknownSkill: await codeOf(
          api.installSkills(source, { cwd: project, skills: ['nope'], agents: ['codex'] })
        ),
        notAllowed: null,
      };
      const result = await api.installSkills(source, {
        cwd: project,
        skills: [${JSON.stringify(ONE)}],
        agents: ['claude-code', 'codex'],
        config: { agents: { include: ['codex'] } },
      });
      codes.notAllowed = result.failed.map((f) => f.agent + ':' + f.code).join(',');
      await source.dispose();
      codes.disposed = await codeOf(api.installSkills(source, { cwd: project, agents: ['codex'] }));
      codes.localPath = await codeOf(api.resolveSource('./missing-dir', { cwd: project }));
      codes.missingRepo = await codeOf(
        api.resolveSource('vercel-labs/skills-e2e-repo-that-does-not-exist', { cwd: project })
      );
      return codes;
    `);
    expect(value).toEqual({
      unknownAgent: 'SKILLS_INVALID_AGENTS',
      unknownSkill: 'SKILLS_NO_MATCHING_SKILLS',
      notAllowed: 'claude-code:SKILLS_AGENT_NOT_ALLOWED',
      disposed: 'SKILLS_SOURCE_DISPOSED',
      localPath: 'SKILLS_LOCAL_PATH_NOT_FOUND',
      missingRepo: 'SKILLS_GIT_AUTH_FAILED',
    });
    // The allowed agent still got the skill.
    expect(readSkill(sandbox.path('.agents', 'skills', ONE)).name).toBe(ONE);
    expect(existsSync(sandbox.path('.claude', 'skills', ONE))).toBe(false);
  });

  it('ships type declarations that a TypeScript consumer can use', async () => {
    // Type-check a consumer file in the install prefix, resolving `skills` through
    // the exports map with Node's own resolution rules.
    const dir = join(inject('installDir'), 'ts-consumer');
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, 'package.json'),
      JSON.stringify({ private: true, type: 'module' }) + '\n'
    );
    await writeFile(
      join(dir, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          module: 'nodenext',
          moduleResolution: 'nodenext',
          target: 'es2022',
          strict: true,
          noEmit: true,
          types: [],
          // The consumer's own lib check, not ours: dependencies' .d.ts are checked too.
          skipLibCheck: false,
        },
        files: ['consumer.ts'],
      })
    );
    await writeFile(
      join(dir, 'consumer.ts'),
      [
        "import { installSkills, isDiagnostic, listSkills, resolveSource, version } from 'skills';",
        "import type { InstallResult, SkillsConfig, SkillSource } from 'skills';",
        '',
        "const config: SkillsConfig = { scope: 'project', agents: { include: ['codex'] } };",
        'export async function run(cwd: string): Promise<string> {',
        "  const source: SkillSource = await resolveSource('owner/repo', { cwd, ref: 'main' });",
        '  try {',
        '    const result: InstallResult = await installSkills(source, { cwd, config });',
        '    const { skills } = await listSkills({ cwd });',
        '    return `${version} ${result.installed.length} ${skills.length}`;',
        '  } catch (error) {',
        "    if (isDiagnostic(error, 'SKILLS_GIT_AUTH_FAILED')) return error.message;",
        '    throw error;',
        '  } finally {',
        '    await source.dispose();',
        '  }',
        '}',
        '',
        '// @ts-expect-error unknown diagnostic codes are rejected',
        "isDiagnostic(new Error(), 'SKILLS_NOT_A_REAL_CODE');",
        '',
      ].join('\n')
    );
    const tsc = join(repoRoot, 'node_modules', 'typescript', 'bin', 'tsc');
    try {
      execFileSync(process.execPath, [tsc, '-p', dir], { encoding: 'utf8' });
    } catch (error) {
      const { stdout, stderr } = error as { stdout?: string; stderr?: string };
      throw new Error(`tsc failed on the API consumer:\n${stdout ?? ''}${stderr ?? ''}`);
    }
  });
});
