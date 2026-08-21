import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, mkdir, symlink, writeFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return {
    ...actual,
    execFileSync: vi.fn(() => {
      throw new Error('ant not installed');
    }),
  };
});

import { execFileSync } from 'child_process';
import {
  resolveAnthropicAuth,
  collectSkillFiles,
  uploadSkillToManagedAgents,
  createManagedSkillLookup,
  knownManagedIds,
  summarizeManagedUploads,
  PENDING_INSTALL_HASH,
  type AnthropicAuth,
} from '../src/managed-agents.ts';
import { agents, getWildcardAgents, isApiUploadAgent } from '../src/agents.ts';
import { parseAddOptions } from '../src/add.ts';
import { buildManagedAgentsArgs } from '../src/update.ts';

const API_KEY_AUTH: AnthropicAuth = {
  headers: { 'x-api-key': 'sk-ant-test' },
  source: 'ANTHROPIC_API_KEY',
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function apiErrorResponse(status: number, message: string): Response {
  return jsonResponse(status, { type: 'error', error: { type: 'api_error', message } });
}

/** Write an ant CLI config dir with one profile's credentials and point the env at it. */
async function withAntConfig(
  profile: string,
  credentials: Record<string, unknown>,
  fn: () => Promise<void>
): Promise<void> {
  const configDir = await mkdtemp(join(tmpdir(), 'ant-config-'));
  try {
    await mkdir(join(configDir, 'credentials'), { recursive: true });
    await writeFile(join(configDir, 'active_config'), `${profile}\n`);
    await writeFile(join(configDir, 'credentials', `${profile}.json`), JSON.stringify(credentials));
    vi.stubEnv('ANTHROPIC_CONFIG_DIR', configDir);
    await fn();
  } finally {
    await rm(configDir, { recursive: true, force: true });
  }
}

describe('claude-managed-agents agent registry entry', () => {
  it('is an api-upload agent: never auto-detected, excluded from the wildcard', async () => {
    expect(isApiUploadAgent('claude-managed-agents')).toBe(true);
    expect(await agents['claude-managed-agents'].detectInstalled()).toBe(false);
    expect(getWildcardAgents()).not.toContain('claude-managed-agents');
    expect(getWildcardAgents()).toContain('claude-code');
  });
});

describe('resolveAnthropicAuth', () => {
  beforeEach(() => {
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    vi.stubEnv('ANTHROPIC_AUTH_TOKEN', '');
    vi.stubEnv('ANTHROPIC_CONFIG_DIR', '/nonexistent-config-dir');
    vi.stubEnv('ANTHROPIC_PROFILE', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.mocked(execFileSync).mockImplementation(() => {
      throw new Error('ant not installed');
    });
  });

  it('prefers ANTHROPIC_API_KEY and maps it to x-api-key', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-abc');
    const auth = await resolveAnthropicAuth();
    expect(auth).toEqual({ headers: { 'x-api-key': 'sk-ant-abc' }, source: 'ANTHROPIC_API_KEY' });
  });

  it('uses ANTHROPIC_AUTH_TOKEN as a bearer token', async () => {
    vi.stubEnv('ANTHROPIC_AUTH_TOKEN', 'tok-123');
    const auth = await resolveAnthropicAuth();
    expect(auth?.headers.Authorization).toBe('Bearer tok-123');
    expect(auth?.source).toBe('ANTHROPIC_AUTH_TOKEN');
  });

  it('uses the ant CLI credentials when available', async () => {
    vi.mocked(execFileSync).mockReturnValue(
      JSON.stringify({
        type: 'oauth_token',
        access_token: 'oauth-token-xyz',
        workspace_id: 'wrkspc_123',
      })
    );

    const auth = await resolveAnthropicAuth();
    expect(auth?.headers.Authorization).toBe('Bearer oauth-token-xyz');
    expect(auth?.headers['anthropic-workspace-id']).toBe('wrkspc_123');
    expect(auth?.headers['anthropic-beta']).toBe('oauth-2025-04-20');
    expect(auth?.source).toBe('ant CLI');
  });

  it('falls back to reading the credentials file when ant is unavailable', async () => {
    const now = Math.floor(Date.now() / 1000);
    await withAntConfig(
      'work',
      {
        type: 'oauth_token',
        access_token: 'file-token',
        expires_at: now + 3600,
        workspace_id: 'wrkspc_456',
      },
      async () => {
        const auth = await resolveAnthropicAuth();
        expect(auth?.headers.Authorization).toBe('Bearer file-token');
        expect(auth?.headers['anthropic-workspace-id']).toBe('wrkspc_456');
        expect(auth?.source).toBe('ant credentials file');
      }
    );
  });

  it('rejects expired credentials from the file fallback', async () => {
    const now = Math.floor(Date.now() / 1000);
    await withAntConfig(
      'default',
      { type: 'oauth_token', access_token: 'stale-token', expires_at: now - 10 },
      async () => expect(await resolveAnthropicAuth()).toBeNull()
    );
  });

  it('returns null when no credential source is available', async () => {
    expect(await resolveAnthropicAuth()).toBeNull();
  });
});

describe('collectSkillFiles', () => {
  it('collects files recursively and applies install exclusions', async () => {
    const skillDir = await mkdtemp(join(tmpdir(), 'skill-'));
    try {
      await writeFile(join(skillDir, 'SKILL.md'), '# skill');
      await writeFile(join(skillDir, 'metadata.json'), '{}');
      await mkdir(join(skillDir, 'scripts'));
      await writeFile(join(skillDir, 'scripts', 'run.py'), 'print(1)');
      await mkdir(join(skillDir, '.git'));
      await writeFile(join(skillDir, '.git', 'HEAD'), 'ref');

      const files = await collectSkillFiles(skillDir);
      const paths = files.map((f) => f.path).sort();
      expect(paths).toEqual(['SKILL.md', 'scripts/run.py']);
    } finally {
      await rm(skillDir, { recursive: true, force: true });
    }
  });

  it('follows in-tree symlinks but skips ones that escape the skill directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'skill-'));
    const skillDir = join(root, 'skill');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await mkdir(skillDir);
      await writeFile(join(skillDir, 'SKILL.md'), '# skill');
      await writeFile(join(skillDir, 'shared.md'), 'shared');
      await writeFile(join(root, 'secret.txt'), 'do not upload');
      await symlink('shared.md', join(skillDir, 'alias.md'));
      await symlink(join(root, 'secret.txt'), join(skillDir, 'leak.txt'));
      await symlink(root, join(skillDir, 'escape-dir'));

      const files = await collectSkillFiles(skillDir);
      const paths = files.map((f) => f.path).sort();
      expect(paths).toEqual(['SKILL.md', 'alias.md', 'shared.md']);
      expect(files.some((f) => String(f.contents).includes('do not upload'))).toBe(false);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('leak.txt'));
    } finally {
      warn.mockRestore();
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('uploadSkillToManagedAgents', () => {
  const fetchMock = vi.fn<typeof fetch>();

  const EMPTY_LIST = () => jsonResponse(200, { data: [], next_page: null });
  const skillJson = (id: string, displayName: string) => ({
    type: 'skill',
    id,
    display_name: displayName,
    latest_version_id: `skver_${id}`,
    source: { type: 'custom' },
  });
  const versionJson = (skillId: string, versionId: string) => ({
    type: 'skill_version',
    id: versionId,
    skill_id: skillId,
    name: 'my-skill',
  });

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('rejects skills without a root SKILL.md', async () => {
    await expect(
      uploadSkillToManagedAgents(
        { name: 'my-skill', files: [{ path: 'docs/README.md', contents: 'x' }] },
        API_KEY_AUTH
      )
    ).rejects.toThrow('missing a SKILL.md');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('normalizes a lowercase skill.md from case-insensitive filesystems', async () => {
    fetchMock
      .mockResolvedValueOnce(EMPTY_LIST())
      .mockResolvedValueOnce(jsonResponse(200, skillJson('skill_01A', 'my-skill')));

    await uploadSkillToManagedAgents(
      { name: 'my-skill', files: [{ path: 'skill.md', contents: '# hi' }] },
      API_KEY_AUTH
    );

    const form = fetchMock.mock.calls[1]![1]?.body as FormData;
    const files = form.getAll('files[]') as File[];
    expect(files.map((f) => f.name)).toEqual(['my-skill/SKILL.md']);
  });

  it('creates a skill with a multipart form of dir-prefixed files', async () => {
    fetchMock
      .mockResolvedValueOnce(EMPTY_LIST())
      .mockResolvedValueOnce(jsonResponse(200, skillJson('skill_01A', 'My Skill')));

    const result = await uploadSkillToManagedAgents(
      {
        name: 'My Skill',
        files: [
          { path: 'SKILL.md', contents: '# hi' },
          { path: 'scripts/run.py', contents: 'print(1)' },
        ],
      },
      API_KEY_AUTH
    );

    expect(result).toEqual({ skillId: 'skill_01A', action: 'created' });

    expect(fetchMock).toHaveBeenCalledTimes(2);

    // No recorded id: look the skill up by display name first...
    const [listUrl, listInit] = fetchMock.mock.calls[0]!;
    expect(String(listUrl)).toBe('https://api.anthropic.com/v1/skills?source=custom&limit=1000');
    expect(listInit?.method ?? 'GET').toBe('GET');

    // ...then create it, since nothing matched.
    const [url, init] = fetchMock.mock.calls[1]!;
    expect(String(url)).toBe('https://api.anthropic.com/v1/skills');
    expect(init?.method).toBe('POST');

    const headers = init?.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('sk-ant-test');
    expect(headers['anthropic-version']).toBe('2023-06-01');
    // The Skills API is GA: no beta header unless the credential needs one.
    expect(headers['anthropic-beta']).toBeUndefined();

    const form = init?.body as FormData;
    expect(form.get('display_name')).toBe('My Skill');
    const files = form.getAll('files[]') as File[];
    // Directory name is the sanitized skill name
    expect(files.map((f) => f.name).sort()).toEqual([
      'my-skill/SKILL.md',
      'my-skill/scripts/run.py',
    ]);
  });

  it('sends every header the credential requires', async () => {
    fetchMock
      .mockResolvedValueOnce(EMPTY_LIST())
      .mockResolvedValueOnce(jsonResponse(200, skillJson('skill_01A', 'my-skill')));

    await uploadSkillToManagedAgents(
      { name: 'my-skill', files: [{ path: 'SKILL.md', contents: '#' }] },
      {
        headers: { Authorization: 'Bearer t', 'anthropic-beta': 'oauth-2025-04-20' },
        source: 'ant CLI',
      }
    );

    for (const [, init] of fetchMock.mock.calls) {
      const headers = init?.headers as Record<string, string>;
      expect(headers['anthropic-beta']).toBe('oauth-2025-04-20');
    }
  });

  it('uploads a new version when a skill with the display name already exists', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(200, { data: [skillJson('skill_00Z', 'Other')], next_page: 'page_2' })
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          data: [skillJson('skill_01A', 'My Skill'), skillJson('skill_00Y', 'My Skill')],
          next_page: null,
        })
      )
      .mockResolvedValueOnce(jsonResponse(200, versionJson('skill_01A', 'skver_456')));

    const result = await uploadSkillToManagedAgents(
      { name: 'My Skill', files: [{ path: 'SKILL.md', contents: '#' }] },
      API_KEY_AUTH
    );

    // The newest (first-listed) match wins.
    expect(result).toEqual({ skillId: 'skill_01A', action: 'updated' });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(String(fetchMock.mock.calls[1]![0])).toBe(
      'https://api.anthropic.com/v1/skills?source=custom&limit=1000&page=page_2'
    );
    const [versionUrl, versionInit] = fetchMock.mock.calls[2]!;
    expect(String(versionUrl)).toBe('https://api.anthropic.com/v1/skills/skill_01A/versions');
    expect(versionInit?.method).toBe('POST');

    // Version uploads carry no display_name
    const versionForm = versionInit?.body as FormData;
    expect(versionForm.get('display_name')).toBeNull();
  });

  it('creates a new skill when the display-name match rejects the upload (400)', async () => {
    // e.g. an unrelated skill that shares the display name but has a
    // different `name` slug in its SKILL.md.
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(200, { data: [skillJson('skill_00Y', 'My Skill')], next_page: null })
      )
      .mockResolvedValueOnce(
        apiErrorResponse(
          400,
          "Skill name 'my-skill' in SKILL.md must be consistent across all versions"
        )
      )
      .mockResolvedValueOnce(jsonResponse(200, skillJson('skill_02B', 'My Skill')));

    const result = await uploadSkillToManagedAgents(
      { name: 'My Skill', files: [{ path: 'SKILL.md', contents: '#' }] },
      API_KEY_AUTH
    );

    expect(result).toEqual({ skillId: 'skill_02B', action: 'created' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(String(fetchMock.mock.calls[2]![0])).toBe('https://api.anthropic.com/v1/skills');
    expect(fetchMock.mock.calls[2]![1]?.method).toBe('POST');
  });

  it('throws on other API failures', async () => {
    fetchMock.mockResolvedValueOnce(apiErrorResponse(401, 'invalid x-api-key'));

    await expect(
      uploadSkillToManagedAgents(
        { name: 'my-skill', files: [{ path: 'SKILL.md', contents: '#' }] },
        API_KEY_AUTH
      )
    ).rejects.toThrow('invalid x-api-key (HTTP 401)');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('honors ANTHROPIC_BASE_URL', async () => {
    vi.stubEnv('ANTHROPIC_BASE_URL', 'https://api.staging.example/');
    fetchMock
      .mockResolvedValueOnce(EMPTY_LIST())
      .mockResolvedValueOnce(jsonResponse(200, skillJson('skill_01A', 'my-skill')));

    await uploadSkillToManagedAgents(
      { name: 'my-skill', files: [{ path: 'SKILL.md', contents: '#' }] },
      API_KEY_AUTH
    );

    expect(String(fetchMock.mock.calls[0]![0])).toBe(
      'https://api.staging.example/v1/skills?source=custom&limit=1000'
    );
    expect(String(fetchMock.mock.calls[1]![0])).toBe('https://api.staging.example/v1/skills');
  });

  // With a known skill id (recorded in the lock by a previous upload).
  const SKILL = { name: 'My Skill', files: [{ path: 'SKILL.md', contents: '#' }] };

  it('uploads a new version directly to the known skill', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, versionJson('skill_01A', 'skver_789')));

    const result = await uploadSkillToManagedAgents(SKILL, API_KEY_AUTH, {
      knownSkillId: 'skill_01A',
    });

    expect(result).toEqual({ skillId: 'skill_01A', action: 'updated' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]![0])).toBe(
      'https://api.anthropic.com/v1/skills/skill_01A/versions'
    );
  });

  it('falls back to lookup-then-create when the known id is gone (404)', async () => {
    fetchMock
      .mockResolvedValueOnce(apiErrorResponse(404, 'Skill not found: skill_gone'))
      .mockResolvedValueOnce(EMPTY_LIST())
      .mockResolvedValueOnce(jsonResponse(200, skillJson('skill_02B', 'My Skill')));

    const result = await uploadSkillToManagedAgents(SKILL, API_KEY_AUTH, {
      knownSkillId: 'skill_gone',
    });

    expect(result).toEqual({ skillId: 'skill_02B', action: 'created' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(String(fetchMock.mock.calls[2]![0])).toBe('https://api.anthropic.com/v1/skills');
  });

  it('falls back when the known id is malformed (400)', async () => {
    fetchMock
      .mockResolvedValueOnce(apiErrorResponse(400, 'Invalid skill_id format: nope'))
      .mockResolvedValueOnce(
        jsonResponse(200, { data: [skillJson('skill_01A', 'My Skill')], next_page: null })
      )
      .mockResolvedValueOnce(jsonResponse(200, versionJson('skill_01A', 'skver_9')));

    const result = await uploadSkillToManagedAgents(SKILL, API_KEY_AUTH, { knownSkillId: 'nope' });

    // The display-name match self-heals the lock's stale id.
    expect(result).toEqual({ skillId: 'skill_01A', action: 'updated' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('does not re-try the known id when the display-name lookup returns it', async () => {
    fetchMock
      .mockResolvedValueOnce(apiErrorResponse(400, 'must be consistent'))
      .mockResolvedValueOnce(
        jsonResponse(200, { data: [skillJson('skill_01A', 'My Skill')], next_page: null })
      )
      .mockResolvedValueOnce(jsonResponse(200, skillJson('skill_02B', 'My Skill')));

    const result = await uploadSkillToManagedAgents(SKILL, API_KEY_AUTH, {
      knownSkillId: 'skill_01A',
    });

    expect(result.action).toBe('created');
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(String(fetchMock.mock.calls[2]![0])).toBe('https://api.anthropic.com/v1/skills');
  });

  it('lists the workspace once per shared lookup, not once per skill', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(200, { data: [skillJson('skill_01A', 'alpha')], next_page: null })
      )
      .mockResolvedValueOnce(jsonResponse(200, versionJson('skill_01A', 'skver_2')))
      .mockResolvedValueOnce(jsonResponse(200, skillJson('skill_02B', 'beta')));

    const lookup = createManagedSkillLookup(API_KEY_AUTH);
    const file = [{ path: 'SKILL.md', contents: '#' }];
    const a = await uploadSkillToManagedAgents({ name: 'alpha', files: file }, API_KEY_AUTH, {
      lookup,
    });
    const b = await uploadSkillToManagedAgents({ name: 'beta', files: file }, API_KEY_AUTH, {
      lookup,
    });

    expect(a).toEqual({ skillId: 'skill_01A', action: 'updated' });
    expect(b).toEqual({ skillId: 'skill_02B', action: 'created' });
    const listCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes('/v1/skills?'));
    expect(listCalls).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('propagates non-recoverable errors from the fast path without falling back', async () => {
    fetchMock.mockResolvedValueOnce(apiErrorResponse(403, 'forbidden'));

    await expect(
      uploadSkillToManagedAgents(SKILL, API_KEY_AUTH, { knownSkillId: 'skill_01A' })
    ).rejects.toThrow('forbidden (HTTP 403)');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('parseAddOptions --managed-agents', () => {
  it('parses the additive flag', () => {
    const { options, errors } = parseAddOptions(['owner/repo', '--managed-agents', '-y']);
    expect(errors).toEqual([]);
    expect(options.managedAgents).toBe(true);
    expect(options.yes).toBe(true);
  });
});

describe('buildManagedAgentsArgs', () => {
  let dir: string;
  let prevCwd: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'skills-update-'));
    prevCwd = process.cwd();
    process.chdir(dir);
  });

  afterEach(async () => {
    process.chdir(prevCwd);
    await rm(dir, { recursive: true, force: true });
  });

  it('returns nothing for entries without a managed skill id', async () => {
    expect(await buildManagedAgentsArgs({}, 'my-skill', false)).toEqual([]);
  });

  it('targets the API-upload agent (softly) for upload-only skills', async () => {
    expect(
      await buildManagedAgentsArgs({ managedSkillId: 'skill_01A' }, 'my-skill', false)
    ).toEqual(['--agent', 'claude-managed-agents', '--managed-agents']);
  });

  it('uses the additive flag when the skill is also installed on the filesystem', async () => {
    await mkdir(join(dir, '.claude', 'skills', 'my-skill'), { recursive: true });
    await writeFile(join(dir, '.claude', 'skills', 'my-skill', 'SKILL.md'), '# my-skill');
    expect(
      await buildManagedAgentsArgs({ managedSkillId: 'skill_01A' }, 'my-skill', false)
    ).toEqual(['--managed-agents']);
  });

  it('recognizes Eve subagent installs as filesystem installs', async () => {
    await mkdir(join(dir, 'agent', 'subagents', 'researcher', 'skills', 'my-skill'), {
      recursive: true,
    });
    await writeFile(
      join(dir, 'agent', 'subagents', 'researcher', 'skills', 'my-skill', 'SKILL.md'),
      '# my-skill'
    );
    expect(
      await buildManagedAgentsArgs(
        { managedSkillId: 'skill_01A', subagents: ['researcher'] },
        'my-skill',
        false
      )
    ).toEqual(['--managed-agents']);
  });
});

describe('managed upload bookkeeping', () => {
  const LOCK = {
    'my-skill': { source: 'owner/repo-a', managedSkillId: 'skill_OLD' },
    'fs-only': { source: 'owner/repo-a' },
  };

  it('reads recorded ids for the same source only', () => {
    expect(knownManagedIds(LOCK, 'owner/repo-a')).toEqual(new Map([['my-skill', 'skill_OLD']]));
    // A same-named skill from another source must not inherit the upload.
    expect(knownManagedIds(LOCK, 'owner/repo-b').size).toBe(0);
  });

  const UPLOADED = [{ skill: 'my-skill', success: true, skillId: 'skill_NEW' }];

  it('records a fresh upload id, else the one already recorded for this source', () => {
    const known = knownManagedIds(LOCK, 'owner/repo-a');
    const fresh = summarizeManagedUploads(UPLOADED, known, { upload: true, fs: true });
    expect(fresh.lockEntry('my-skill', true)?.managedSkillId).toBe('skill_NEW');

    const untouched = summarizeManagedUploads([], known, { upload: false, fs: true });
    expect(untouched.lockEntry('my-skill', true)?.managedSkillId).toBe('skill_OLD');
  });

  it('writes no entry when nothing landed, and a pending hash when only part did', () => {
    const none = new Map<string, string>();
    // Upload requested (or credential-skipped) but nothing reached the API.
    const fsOnlyLanded = summarizeManagedUploads([], none, { upload: true, fs: true });
    expect(fsOnlyLanded.lockEntry('my-skill', false)).toBeNull();
    expect(fsOnlyLanded.lockEntry('my-skill', true)?.hash('abc')).toBe(PENDING_INSTALL_HASH);

    const fsOnly = summarizeManagedUploads([], none, { upload: false, fs: true });
    expect(fsOnly.lockEntry('my-skill', true)?.hash('abc')).toBe('abc');

    const uploadOnly = summarizeManagedUploads(UPLOADED, none, { upload: true, fs: false });
    expect(uploadOnly.uploads).toBe(1);
    expect(uploadOnly.lockEntry('my-skill', false)?.hash('abc')).toBe('abc');

    // Both requested, copy failed, upload landed: entry exists but stays pending.
    const half = summarizeManagedUploads(UPLOADED, none, { upload: true, fs: true });
    expect(half.lockEntry('my-skill', false)?.hash('abc')).toBe(PENDING_INSTALL_HASH);
  });
});
