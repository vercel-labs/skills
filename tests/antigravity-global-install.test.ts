/**
 * Antigravity uses .agents/skills inside a workspace, but outside one it reads
 * global skills only from ~/.gemini/config/skills. A global install must put the
 * skill there, in copy mode (Antigravity alone) and in symlink mode (Antigravity
 * beside other agents), and must leave agents that read ~/.agents/skills alone.
 */
import { afterAll, afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join, resolve, dirname } from 'path';
import { runCli } from '../src/test-utils.ts';
import { readsCanonicalGlobally } from '../src/agents.ts';
import type { AgentType } from '../src/types.ts';
import * as prompts from '@clack/prompts';
import { searchMultiselect } from '../src/prompts/search-multiselect.ts';
import { runAdd } from '../src/add.ts';
import { wellKnownProvider } from '../src/providers/index.ts';

// In-process `add` runs below get their own home (fixed before src/agents.ts reads it),
// detected agents and prompt answers.
const host = await vi.hoisted(async () => {
  const { mkdtempSync } = await import('fs');
  const { join } = await import('path');
  const { tmpdir } = await vi.importActual<typeof import('os')>('os');
  const root = mkdtempSync(join(tmpdir(), 'skills-antigravity-prompt-'));
  return {
    root,
    home: join(root, 'home'),
    detected: [] as string[],
    scope: true,
  };
});
vi.mock('os', async (importOriginal) => ({
  ...(await importOriginal<typeof import('os')>()),
  homedir: () => host.home,
}));
vi.mock('../src/agents.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/agents.ts')>()),
  detectInstalledAgents: async () => host.detected,
}));
vi.mock('../src/detect-agent.ts', () => ({
  detectAgent: async () => ({ isAgent: false, agent: { name: 'none' } }),
  getAgentType: () => null,
}));
vi.mock('../src/telemetry.ts', () => ({
  track: vi.fn(),
  setVersion: vi.fn(),
  fetchAuditData: vi.fn().mockResolvedValue(null),
}));
vi.mock('../src/prompts/search-multiselect.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/prompts/search-multiselect.ts')>()),
  // The user keeps the locked agents and ticks Antigravity whenever it is offered.
  searchMultiselect: vi.fn(
    async (opts: {
      items: { value: string }[];
      lockedSection?: { items: { value: string }[] };
    }) => [
      ...(opts.lockedSection?.items ?? []).map((item) => item.value),
      ...opts.items.map((item) => item.value).filter((value) => value === 'antigravity'),
    ]
  ),
}));
vi.mock('@clack/prompts', () => {
  const noop = () => {};
  return {
    intro: noop,
    outro: noop,
    note: noop,
    cancel: noop,
    log: { info: noop, message: noop, warn: noop, error: noop, step: noop, success: noop },
    spinner: () => ({ start: noop, stop: noop, message: noop }),
    isCancel: (value: unknown) => typeof value === 'symbol',
    select: vi.fn(async ({ message }: { message: string }) =>
      message === 'Installation scope' ? host.scope : 'symlink'
    ),
    // Confirms the install and declines everything else, such as installing to Eve.
    confirm: vi.fn(
      async ({ message }: { message: string }) => message === 'Proceed with installation?'
    ),
  };
});

function makeSkill(root: string): string {
  const dir = join(root, 'source', 'probe-skill');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), '---\nname: probe-skill\ndescription: Probe\n---\nBody\n');
  return dir;
}

/**
 * Runs a global `add -y`. With agentArgs it passes `-a`; without, the CLI picks
 * the agents it detects from the folders in homeDirs.
 */
function install(agentArgs: string[], homeDirs: string[] = []) {
  const root = mkdtempSync(join(tmpdir(), 'skills-antigravity-'));
  const home = join(root, 'home');
  mkdirSync(home, { recursive: true });
  for (const dir of homeDirs) mkdirSync(join(home, dir), { recursive: true });
  const agentFlag = agentArgs.length > 0 ? ['-a', ...agentArgs] : [];
  const result = runCli(['add', makeSkill(root), '-g', '-y', ...agentFlag], root, {
    HOME: home,
  });
  return { root, home, result };
}

describe('Antigravity global install', () => {
  it('does not read the canonical directory globally', () => {
    expect(readsCanonicalGlobally('antigravity')).toBe(false);
    expect(readsCanonicalGlobally('antigravity-cli')).toBe(false);
    expect(readsCanonicalGlobally('codex')).toBe(true);
    expect(readsCanonicalGlobally('github-copilot')).toBe(true);
  });

  it('copies into ~/.gemini/config/skills when installed alone', () => {
    const { root, home, result } = install(['antigravity-cli']);
    try {
      expect(result.exitCode).toBe(0);
      const target = join(home, '.gemini', 'config', 'skills', 'probe-skill');
      expect(existsSync(join(target, 'SKILL.md'))).toBe(true);
      expect(lstatSync(target).isSymbolicLink()).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('links ~/.gemini/config/skills to the canonical copy beside other agents', () => {
    const { root, home, result } = install(['antigravity', 'codex', 'claude-code']);
    try {
      expect(result.exitCode).toBe(0);
      const canonical = join(home, '.agents', 'skills', 'probe-skill');
      const link = join(home, '.gemini', 'config', 'skills', 'probe-skill');
      expect(existsSync(join(canonical, 'SKILL.md'))).toBe(true);
      expect(lstatSync(link).isSymbolicLink()).toBe(true);
      expect(resolve(dirname(link), readlinkSync(link))).toBe(canonical);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('installs both Antigravity agents into their shared directory beside a universal agent', () => {
    const { root, home, result } = install(['codex', 'antigravity', 'antigravity-cli']);
    try {
      expect(result.exitCode).toBe(0);
      expect(existsSync(join(home, '.agents', 'skills', 'probe-skill', 'SKILL.md'))).toBe(true);
      expect(existsSync(join(home, '.gemini', 'config', 'skills', 'probe-skill', 'SKILL.md'))).toBe(
        true
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('does not install for Antigravity when it was neither requested nor detected', () => {
    const { root, home } = install([], ['.claude']);
    try {
      expect(existsSync(join(home, '.agents', 'skills', 'probe-skill', 'SKILL.md'))).toBe(true);
      expect(existsSync(join(home, '.claude', 'skills', 'probe-skill'))).toBe(true);
      expect(existsSync(join(home, '.gemini', 'config', 'skills'))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('installs for Antigravity when it is detected', () => {
    const { root, home } = install([], ['.claude', '.gemini/antigravity']);
    try {
      const link = join(home, '.gemini', 'config', 'skills', 'probe-skill');
      expect(existsSync(join(link, 'SKILL.md'))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('keeps a universal agent that reads ~/.agents/skills in the canonical directory', () => {
    const { root, home, result } = install(['github-copilot']);
    try {
      expect(result.exitCode).toBe(0);
      expect(existsSync(join(home, '.agents', 'skills', 'probe-skill', 'SKILL.md'))).toBe(true);
      expect(existsSync(join(home, '.copilot', 'skills', 'probe-skill'))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('interactive add without a scope flag', () => {
  const project = join(host.root, 'project');
  let originalCwd: string;

  beforeEach(() => {
    mkdirSync(host.home, { recursive: true });
    mkdirSync(project, { recursive: true });
    vi.stubEnv('XDG_STATE_HOME', '');
    originalCwd = process.cwd();
    process.chdir(project);
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code})`);
    }) as never);
    vi.mocked(prompts.select).mockClear();
    vi.mocked(searchMultiselect).mockClear();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    rmSync(host.home, { recursive: true, force: true });
    rmSync(project, { recursive: true, force: true });
  });

  afterAll(() => rmSync(host.root, { recursive: true, force: true }));

  async function addInteractively(
    detected: AgentType[],
    scope: boolean,
    source = makeSkill(host.root)
  ) {
    host.detected = detected;
    host.scope = scope;
    await runAdd([source], {});

    const scopePrompt = vi.mocked(prompts.select).mock;
    const agentPrompt = vi.mocked(searchMultiselect).mock;
    expect(scopePrompt.calls.map(([opts]) => opts.message)).toContain('Installation scope');
    expect(agentPrompt.calls).toHaveLength(1);
    return {
      offered: agentPrompt.calls[0]![0].items.map((item) => item.value),
      scopeAskedFirst: scopePrompt.invocationCallOrder[0]! < agentPrompt.invocationCallOrder[0]!,
    };
  }

  // The second case declines the detected Eve and falls back to the agent prompt.
  it.each<AgentType[]>([
    ['claude-code', 'codex'],
    ['eve', 'claude-code'],
  ])('lets a global install pick Antigravity (detected %s, %s)', async (...detected) => {
    const { offered, scopeAskedFirst } = await addInteractively(detected, true);

    expect(offered).toContain('antigravity');
    expect(existsSync(join(host.home, '.agents', 'skills', 'probe-skill', 'SKILL.md'))).toBe(true);
    expect(
      existsSync(join(host.home, '.gemini', 'config', 'skills', 'probe-skill', 'SKILL.md'))
    ).toBe(true);
    expect(scopeAskedFirst).toBe(true);
  });

  it('lets a global install from a well-known source pick Antigravity', async () => {
    const content = '---\nname: probe-skill\ndescription: Probe\n---\nBody\n';
    vi.spyOn(wellKnownProvider, 'fetchAllSkills').mockResolvedValue([
      {
        name: 'probe-skill',
        installName: 'probe-skill',
        description: 'Probe',
        content,
        sourceUrl: 'https://skills.example.com/.well-known/agent-skills/probe-skill/SKILL.md',
        files: new Map([['SKILL.md', content]]),
        indexEntry: { name: 'probe-skill', description: 'Probe', files: ['SKILL.md'] },
      },
    ]);

    const { offered, scopeAskedFirst } = await addInteractively(
      ['claude-code', 'codex'],
      true,
      'https://skills.example.com'
    );

    expect(offered).toContain('antigravity');
    expect(
      existsSync(join(host.home, '.gemini', 'config', 'skills', 'probe-skill', 'SKILL.md'))
    ).toBe(true);
    expect(scopeAskedFirst).toBe(true);
  });

  it('keeps the project agent prompt when Project is chosen', async () => {
    const { offered, scopeAskedFirst } = await addInteractively(['claude-code', 'codex'], false);

    expect(scopeAskedFirst).toBe(true);
    expect(offered).not.toContain('antigravity');
    expect(existsSync(join(project, '.agents', 'skills', 'probe-skill', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(host.home, '.gemini'))).toBe(false);
  });
});
