import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  wireStopHook,
  wireUserPromptHook,
  removeUserPromptHook,
  isHookSetupDone,
  repairHooks,
} from './hooks.ts';

// ─── helpers ───────────────────────────────────────────────────────────────

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function makeHome(): string {
  const dir = join(tmpdir(), `hooks-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

// ─── wireStopHook ──────────────────────────────────────────────────────────

describe('wireStopHook', () => {
  let home: string;

  beforeEach(() => {
    home = makeHome();
    process.env['SKILLS_HOOK_STOP_CMD'] = 'playlist-skills track stop';
    process.env['SKILLS_HOOK_FAIL_CMD'] = 'playlist-skills track stop --succeeded=false';
    delete process.env['SKILLS_HOOK_START_CMD'];
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
    delete process.env['SKILLS_HOOK_STOP_CMD'];
    delete process.env['SKILLS_HOOK_FAIL_CMD'];
  });

  it('returns false when SKILLS_HOOK_STOP_CMD is unset', async () => {
    delete process.env['SKILLS_HOOK_STOP_CMD'];
    const changed = await wireStopHook('claude-code', { home });
    expect(changed).toBe(false);
  });

  it('writes nested stop hook for claude-code', async () => {
    const changed = await wireStopHook('claude-code', { home });
    expect(changed).toBe(true);

    const settings = readJson(join(home, '.claude', 'settings.json'));
    const stopHooks = (settings['hooks'] as Record<string, unknown>)['Stop'] as unknown[];
    expect(stopHooks).toHaveLength(1);
    const inner = (stopHooks[0] as Record<string, unknown>)['hooks'] as unknown[];
    expect((inner[0] as Record<string, unknown>)['command']).toBe('playlist-skills track stop');
  });

  it('writes flat stop hook for cursor', async () => {
    const changed = await wireStopHook('cursor', { home });
    expect(changed).toBe(true);

    const settings = readJson(join(home, '.cursor', 'hooks.json'));
    expect((settings as Record<string, unknown>)['version']).toBe(1);
    const stopHooks = (settings['hooks'] as Record<string, unknown>)['stop'] as unknown[];
    expect((stopHooks[0] as Record<string, unknown>)['command']).toBe('playlist-skills track stop');
  });

  it('writes flat stop + fail hooks for github-copilot', async () => {
    const changed = await wireStopHook('github-copilot', { home });
    expect(changed).toBe(true);

    const settings = readJson(join(home, '.copilot', 'hooks', 'skills.json'));
    const hooks = settings['hooks'] as Record<string, unknown>;
    expect(hooks['agentStop'] as unknown[]).toHaveLength(1);
    expect(((hooks['agentStop'] as unknown[])[0] as Record<string, unknown>)['command']).toBe(
      'playlist-skills track stop'
    );
    expect(hooks['errorOccurred'] as unknown[]).toHaveLength(1);
    expect(((hooks['errorOccurred'] as unknown[])[0] as Record<string, unknown>)['command']).toBe(
      'playlist-skills track stop --succeeded=false'
    );
  });

  it('writes nested stop + StopFailure hooks for claude-code', async () => {
    const changed = await wireStopHook('claude-code', { home });
    expect(changed).toBe(true);

    const settings = readJson(join(home, '.claude', 'settings.json'));
    const hooks = settings['hooks'] as Record<string, unknown>;
    expect(hooks['Stop'] as unknown[]).toHaveLength(1);
    expect(((hooks['Stop'] as unknown[])[0] as Record<string, unknown>)['hooks']).toBeDefined();
    expect(hooks['StopFailure'] as unknown[]).toHaveLength(1);
    const failInner = ((hooks['StopFailure'] as unknown[])[0] as Record<string, unknown>)[
      'hooks'
    ] as unknown[];
    expect((failInner[0] as Record<string, unknown>)['command']).toBe(
      'playlist-skills track stop --succeeded=false'
    );
  });

  it('is idempotent — second call returns false and does not duplicate entries', async () => {
    await wireStopHook('claude-code', { home });
    const changed = await wireStopHook('claude-code', { home });
    expect(changed).toBe(false);

    const settings = readJson(join(home, '.claude', 'settings.json'));
    const stopHooks = (settings['hooks'] as Record<string, unknown>)['Stop'] as unknown[];
    expect(stopHooks).toHaveLength(1);
  });

  it('merges into an existing settings file without clobbering other keys', async () => {
    const claudeDir = join(home, '.claude');
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(
      join(claudeDir, 'settings.json'),
      JSON.stringify({ model: 'claude-opus-4-5', hooks: { PreToolUse: [] } })
    );

    await wireStopHook('claude-code', { home });

    const settings = readJson(join(claudeDir, 'settings.json'));
    expect(settings['model']).toBe('claude-opus-4-5');
    expect((settings['hooks'] as Record<string, unknown>)['PreToolUse']).toEqual([]);
    expect((settings['hooks'] as Record<string, unknown>)['Stop']).toHaveLength(1);
  });

  it('returns false for an agent without hook support (windsurf)', async () => {
    const changed = await wireStopHook('windsurf' as never, { home });
    expect(changed).toBe(false);
  });
});

// ─── wireUserPromptHook ────────────────────────────────────────────────────

describe('wireUserPromptHook', () => {
  let home: string;

  beforeEach(() => {
    home = makeHome();
    process.env['SKILLS_HOOK_START_CMD'] =
      'playlist-skills track start --skill-ref {{skill_ref}} --agent {{agent}} --match-prompt /{{skill_name}}';
    delete process.env['SKILLS_HOOK_STOP_CMD'];
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
    delete process.env['SKILLS_HOOK_START_CMD'];
  });

  it('returns false when SKILLS_HOOK_START_CMD is unset', async () => {
    delete process.env['SKILLS_HOOK_START_CMD'];
    const changed = await wireUserPromptHook({
      skillName: 'my-skill',
      skillRef: 'owner/repo/my-skill',
      agent: 'claude-code',
      home,
    });
    expect(changed).toBe(false);
  });

  it('returns false when SKILLS_HOOK_START_CMD does not contain {{skill_name}}', async () => {
    process.env['SKILLS_HOOK_START_CMD'] = 'my-tracker --agent {{agent}}';
    const changed = await wireUserPromptHook({
      skillName: 'my-skill',
      skillRef: 'owner/repo/my-skill',
      agent: 'claude-code',
      home,
    });
    expect(changed).toBe(false);
  });

  it('substitutes {{skill_ref}}, {{skill_name}}, {{agent}} tokens', async () => {
    await wireUserPromptHook({
      skillName: 'pr-review',
      skillRef: 'acme/skills/pr-review',
      agent: 'claude-code',
      home,
    });

    const settings = readJson(join(home, '.claude', 'settings.json'));
    const promptHooks = (settings['hooks'] as Record<string, unknown>)[
      'UserPromptSubmit'
    ] as unknown[];
    const inner = (promptHooks[0] as Record<string, unknown>)['hooks'] as unknown[];
    const cmd = (inner[0] as Record<string, unknown>)['command'] as string;

    expect(cmd).toContain('--skill-ref acme/skills/pr-review');
    expect(cmd).toContain('--agent claude-code');
    expect(cmd).toContain('--match-prompt /pr-review');
  });

  it('uses flat schema for cursor', async () => {
    await wireUserPromptHook({
      skillName: 'pr-review',
      skillRef: 'acme/skills/pr-review',
      agent: 'cursor',
      home,
    });

    const settings = readJson(join(home, '.cursor', 'hooks.json'));
    const promptHooks = (settings['hooks'] as Record<string, unknown>)[
      'beforeSubmitPrompt'
    ] as unknown[];
    expect(promptHooks).toHaveLength(1);
    expect((promptHooks[0] as Record<string, unknown>)['command']).toContain(
      '--skill-ref acme/skills/pr-review'
    );
  });

  it('replaces existing entry for same skillRef on reinstall', async () => {
    const opts = {
      skillName: 'pr-review',
      skillRef: 'acme/skills/pr-review',
      agent: 'claude-code' as const,
      home,
    };

    process.env['SKILLS_HOOK_START_CMD'] =
      'playlist-skills track start --skill-ref {{skill_ref}} --agent {{agent}} --match-prompt /{{skill_name}}';
    await wireUserPromptHook(opts);

    process.env['SKILLS_HOOK_START_CMD'] =
      'playlist-skills track start --skill-ref {{skill_ref}} --agent {{agent}} --match-prompt /{{skill_name}} --extra-flag';
    await wireUserPromptHook(opts);

    const settings = readJson(join(home, '.claude', 'settings.json'));
    const promptHooks = (settings['hooks'] as Record<string, unknown>)[
      'UserPromptSubmit'
    ] as unknown[];
    expect(promptHooks).toHaveLength(1);
    const inner = (promptHooks[0] as Record<string, unknown>)['hooks'] as unknown[];
    expect((inner[0] as Record<string, unknown>)['command']).toContain('--extra-flag');
  });

  it('keeps entries for different skillRefs when adding a second skill', async () => {
    process.env['SKILLS_HOOK_START_CMD'] =
      'playlist-skills track start --skill-ref {{skill_ref}} --agent {{agent}} --match-prompt /{{skill_name}}';

    await wireUserPromptHook({
      skillName: 'skill-a',
      skillRef: 'acme/skills/skill-a',
      agent: 'claude-code',
      home,
    });
    await wireUserPromptHook({
      skillName: 'skill-b',
      skillRef: 'acme/skills/skill-b',
      agent: 'claude-code',
      home,
    });

    const settings = readJson(join(home, '.claude', 'settings.json'));
    const promptHooks = (settings['hooks'] as Record<string, unknown>)[
      'UserPromptSubmit'
    ] as unknown[];
    expect(promptHooks).toHaveLength(2);
  });
});

// ─── removeUserPromptHook ──────────────────────────────────────────────────

describe('removeUserPromptHook', () => {
  let home: string;

  beforeEach(() => {
    home = makeHome();
    process.env['SKILLS_HOOK_START_CMD'] =
      'playlist-skills track start --skill-ref {{skill_ref}} --agent {{agent}} --match-prompt /{{skill_name}}';
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
    delete process.env['SKILLS_HOOK_START_CMD'];
  });

  it('removes the correct entry and leaves others intact', async () => {
    await wireUserPromptHook({
      skillName: 'skill-a',
      skillRef: 'acme/skills/skill-a',
      agent: 'claude-code',
      home,
    });
    await wireUserPromptHook({
      skillName: 'skill-b',
      skillRef: 'acme/skills/skill-b',
      agent: 'claude-code',
      home,
    });

    const removed = await removeUserPromptHook({
      skillRef: 'acme/skills/skill-a',
      agent: 'claude-code',
      home,
    });
    expect(removed).toBe(true);

    const settings = readJson(join(home, '.claude', 'settings.json'));
    const promptHooks = (settings['hooks'] as Record<string, unknown>)[
      'UserPromptSubmit'
    ] as unknown[];
    expect(promptHooks).toHaveLength(1);
    const inner = (promptHooks[0] as Record<string, unknown>)['hooks'] as unknown[];
    expect((inner[0] as Record<string, unknown>)['command']).toContain('acme/skills/skill-b');
  });

  it('returns false when skillRef is not present', async () => {
    await wireUserPromptHook({
      skillName: 'skill-a',
      skillRef: 'acme/skills/skill-a',
      agent: 'claude-code',
      home,
    });

    const removed = await removeUserPromptHook({
      skillRef: 'acme/skills/nonexistent',
      agent: 'claude-code',
      home,
    });
    expect(removed).toBe(false);
  });

  it('returns false when hooks file does not exist', async () => {
    const removed = await removeUserPromptHook({
      skillRef: 'acme/skills/any',
      agent: 'claude-code',
      home,
    });
    expect(removed).toBe(false);
  });

  it('removes flat-schema entry for cursor', async () => {
    await wireUserPromptHook({
      skillName: 'my-skill',
      skillRef: 'acme/skills/my-skill',
      agent: 'cursor',
      home,
    });
    const removed = await removeUserPromptHook({
      skillRef: 'acme/skills/my-skill',
      agent: 'cursor',
      home,
    });
    expect(removed).toBe(true);

    const settings = readJson(join(home, '.cursor', 'hooks.json'));
    const promptHooks = (settings['hooks'] as Record<string, unknown>)[
      'beforeSubmitPrompt'
    ] as unknown[];
    expect(promptHooks).toHaveLength(0);
  });
});

// ─── repairHooks ──────────────────────────────────────────────────────────

describe('repairHooks', () => {
  let home: string;
  let xdgStateDir: string;

  function writeGlobalLock(skills: Record<string, unknown>): void {
    const lockDir = join(xdgStateDir, 'skills');
    mkdirSync(lockDir, { recursive: true });
    writeFileSync(
      join(lockDir, '.skill-lock.json'),
      JSON.stringify({ version: 3, skills }),
      'utf-8'
    );
  }

  beforeEach(() => {
    home = makeHome();
    xdgStateDir = makeHome();
    process.env['XDG_STATE_HOME'] = xdgStateDir;
    process.env['SKILLS_HOOK_START_CMD'] =
      'playlist-skills track start --skill-ref {{skill_ref}} --agent {{agent}} --match-prompt /{{skill_name}}';
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
    rmSync(xdgStateDir, { recursive: true, force: true });
    delete process.env['XDG_STATE_HOME'];
    delete process.env['SKILLS_HOOK_START_CMD'];
  });

  it('returns zero counts when no skills are installed and no agent config dirs exist', async () => {
    writeGlobalLock({});
    const result = await repairHooks({ home });
    expect(result).toEqual({ wired: 0, removed: 0, agentsRepaired: [] });
  });

  it('skips agents whose config dir does not exist', async () => {
    writeGlobalLock({
      'my-skill': {
        source: 'acme/skills',
        sourceType: 'github',
        sourceUrl: 'https://github.com/acme/skills',
        skillFolderHash: 'abc123',
        installedAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
        skillRef: 'acme/skills/my-skill',
      },
    });
    // Deliberately do NOT create .claude or any other agent config dir
    const result = await repairHooks({ home });
    expect(result.wired).toBe(0);
    expect(result.removed).toBe(0);
    expect(result.agentsRepaired).toHaveLength(0);
  });

  it('wires a missing hook for a globally installed skill', async () => {
    writeGlobalLock({
      'my-skill': {
        source: 'acme/skills',
        sourceType: 'github',
        sourceUrl: 'https://github.com/acme/skills',
        skillFolderHash: 'abc123',
        installedAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
        skillRef: 'acme/skills/my-skill',
      },
    });
    mkdirSync(join(home, '.claude'), { recursive: true });

    const result = await repairHooks({ home });

    expect(result.wired).toBeGreaterThanOrEqual(1);
    expect(result.agentsRepaired).toContain('Claude Code');

    const settings = readJson(join(home, '.claude', 'settings.json'));
    const promptHooks = (settings['hooks'] as Record<string, unknown>)[
      'UserPromptSubmit'
    ] as unknown[];
    expect(promptHooks).toHaveLength(1);
    const inner = (promptHooks[0] as Record<string, unknown>)['hooks'] as unknown[];
    expect((inner[0] as Record<string, unknown>)['command']).toContain(
      '--skill-ref acme/skills/my-skill'
    );
  });

  it('removes an orphaned hook whose skillRef is no longer in any lock', async () => {
    mkdirSync(join(home, '.claude'), { recursive: true });

    const orphanCmd =
      'playlist-skills track start --skill-ref acme/skills/ghost-skill --agent claude-code --match-prompt /ghost-skill';
    const settingsPath = join(home, '.claude', 'settings.json');
    writeFileSync(
      settingsPath,
      JSON.stringify({
        hooks: {
          UserPromptSubmit: [{ hooks: [{ type: 'command', command: orphanCmd, timeout: 5 }] }],
        },
      }),
      'utf-8'
    );

    writeGlobalLock({});

    const result = await repairHooks({ home });

    expect(result.removed).toBe(1);
    expect(result.agentsRepaired).toContain('Claude Code');

    const settings = readJson(settingsPath);
    const promptHooks = (settings['hooks'] as Record<string, unknown>)[
      'UserPromptSubmit'
    ] as unknown[];
    expect(promptHooks).toHaveLength(0);
  });

  it('is idempotent — calling repair twice does not duplicate hook entries', async () => {
    writeGlobalLock({
      'my-skill': {
        source: 'acme/skills',
        sourceType: 'github',
        sourceUrl: 'https://github.com/acme/skills',
        skillFolderHash: 'abc123',
        installedAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
        skillRef: 'acme/skills/my-skill',
      },
    });
    mkdirSync(join(home, '.claude'), { recursive: true });

    const first = await repairHooks({ home });
    const second = await repairHooks({ home });

    expect(first.wired).toBe(1);
    expect(second.wired).toBe(0);
    expect(second.removed).toBe(0);

    const settings = readJson(join(home, '.claude', 'settings.json'));
    const promptHooks = (settings['hooks'] as Record<string, unknown>)[
      'UserPromptSubmit'
    ] as unknown[];
    expect(promptHooks).toHaveLength(1);
  });

  it('rebuilds hookRefs in the global lock after repair', async () => {
    writeGlobalLock({
      'my-skill': {
        source: 'acme/skills',
        sourceType: 'github',
        sourceUrl: 'https://github.com/acme/skills',
        skillFolderHash: 'abc123',
        installedAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
        skillRef: 'acme/skills/my-skill',
      },
    });
    mkdirSync(join(home, '.claude'), { recursive: true });

    await repairHooks({ home });

    const lockPath = join(xdgStateDir, 'skills', '.skill-lock.json');
    const lock = JSON.parse(readFileSync(lockPath, 'utf-8'));
    expect(lock.hookRefs?.['acme/skills/my-skill']).toEqual({
      globalInstall: true,
      projectPaths: [],
    });
  });

  it('wires missing and removes orphaned in a single run', async () => {
    mkdirSync(join(home, '.claude'), { recursive: true });

    const orphanCmd =
      'playlist-skills track start --skill-ref acme/skills/old-skill --agent claude-code --match-prompt /old-skill';
    const settingsPath = join(home, '.claude', 'settings.json');
    writeFileSync(
      settingsPath,
      JSON.stringify({
        hooks: {
          UserPromptSubmit: [{ hooks: [{ type: 'command', command: orphanCmd, timeout: 5 }] }],
        },
      }),
      'utf-8'
    );

    writeGlobalLock({
      'new-skill': {
        source: 'acme/skills',
        sourceType: 'github',
        sourceUrl: 'https://github.com/acme/skills',
        skillFolderHash: 'def456',
        installedAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
        skillRef: 'acme/skills/new-skill',
      },
    });

    const result = await repairHooks({ home });

    expect(result.wired).toBe(1);
    expect(result.removed).toBe(1);
    expect(result.agentsRepaired).toContain('Claude Code');

    const settings = readJson(settingsPath);
    const promptHooks = (settings['hooks'] as Record<string, unknown>)[
      'UserPromptSubmit'
    ] as unknown[];
    expect(promptHooks).toHaveLength(1);
    const inner = (promptHooks[0] as Record<string, unknown>)['hooks'] as unknown[];
    const cmd = (inner[0] as Record<string, unknown>)['command'] as string;
    expect(cmd).toContain('--skill-ref acme/skills/new-skill');
    expect(cmd).not.toContain('old-skill');
  });
});

// ─── isHookSetupDone ───────────────────────────────────────────────────────

describe('isHookSetupDone', () => {
  let home: string;

  beforeEach(() => {
    home = makeHome();
    process.env['SKILLS_HOOK_STOP_CMD'] = 'playlist-skills track stop';
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
    delete process.env['SKILLS_HOOK_STOP_CMD'];
  });

  it('returns false when no hooks files exist', () => {
    expect(isHookSetupDone(home)).toBe(false);
  });

  it('returns true after wireStopHook has been called', async () => {
    await wireStopHook('claude-code', { home });
    expect(isHookSetupDone(home)).toBe(true);
  });

  it('returns false when SKILLS_HOOK_STOP_CMD is unset', async () => {
    await wireStopHook('claude-code', { home });
    delete process.env['SKILLS_HOOK_STOP_CMD'];
    expect(isHookSetupDone(home)).toBe(false);
  });
});
