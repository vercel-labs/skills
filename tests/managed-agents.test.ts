import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'fs/promises';
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
  ManagedAgentsApiError,
  type AnthropicAuth,
} from '../src/managed-agents.ts';
import { agents, getWildcardAgents, isVirtualAgent } from '../src/agents.ts';

const API_KEY_AUTH: AnthropicAuth = {
  headers: { 'x-api-key': 'sk-ant-test' },
  betas: [],
  source: 'ANTHROPIC_API_KEY',
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('claude-managed-agents agent registry entry', () => {
  it('is registered as a virtual agent', () => {
    expect(agents['claude-managed-agents']).toBeDefined();
    expect(isVirtualAgent('claude-managed-agents')).toBe(true);
  });

  it('is never auto-detected', async () => {
    expect(await agents['claude-managed-agents'].detectInstalled()).toBe(false);
  });

  it('is excluded from wildcard agent expansion', () => {
    const wildcard = getWildcardAgents();
    expect(wildcard).not.toContain('claude-managed-agents');
    expect(wildcard).toContain('claude-code');
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
    expect(auth).toEqual({
      headers: { 'x-api-key': 'sk-ant-abc' },
      betas: [],
      source: 'ANTHROPIC_API_KEY',
    });
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
    expect(auth?.betas).toContain('oauth-2025-04-20');
    expect(auth?.source).toBe('ant CLI');
  });

  it('falls back to reading the credentials file when ant is unavailable', async () => {
    const configDir = await mkdtemp(join(tmpdir(), 'ant-config-'));
    try {
      await mkdir(join(configDir, 'credentials'), { recursive: true });
      await writeFile(join(configDir, 'active_config'), 'work\n');
      await writeFile(
        join(configDir, 'credentials', 'work.json'),
        JSON.stringify({
          type: 'oauth_token',
          access_token: 'file-token',
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          workspace_id: 'wrkspc_456',
        })
      );
      vi.stubEnv('ANTHROPIC_CONFIG_DIR', configDir);

      const auth = await resolveAnthropicAuth();
      expect(auth?.headers.Authorization).toBe('Bearer file-token');
      expect(auth?.headers['anthropic-workspace-id']).toBe('wrkspc_456');
      expect(auth?.source).toBe('ant credentials file');
    } finally {
      await rm(configDir, { recursive: true, force: true });
    }
  });

  it('rejects expired credentials from the file fallback', async () => {
    const configDir = await mkdtemp(join(tmpdir(), 'ant-config-'));
    try {
      await mkdir(join(configDir, 'credentials'), { recursive: true });
      await writeFile(join(configDir, 'active_config'), 'default');
      await writeFile(
        join(configDir, 'credentials', 'default.json'),
        JSON.stringify({
          type: 'oauth_token',
          access_token: 'stale-token',
          expires_at: Math.floor(Date.now() / 1000) - 10,
        })
      );
      vi.stubEnv('ANTHROPIC_CONFIG_DIR', configDir);

      expect(await resolveAnthropicAuth()).toBeNull();
    } finally {
      await rm(configDir, { recursive: true, force: true });
    }
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
});

describe('uploadSkillToManagedAgents', () => {
  const fetchMock = vi.fn<typeof fetch>();

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
        { name: 'my-skill', files: [{ path: 'docs/README.md', content: 'x' }] },
        API_KEY_AUTH
      )
    ).rejects.toThrow('missing a SKILL.md');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('creates a skill with a multipart form of dir-prefixed files', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { id: 'skill_01A', display_title: 'My Skill', latest_version: '123' })
    );

    const result = await uploadSkillToManagedAgents(
      {
        name: 'My Skill',
        files: [
          { path: 'SKILL.md', content: '# hi' },
          { path: 'scripts/run.py', content: 'print(1)' },
        ],
      },
      API_KEY_AUTH
    );

    expect(result).toEqual({ skillId: 'skill_01A', version: '123', action: 'created' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe('https://api.anthropic.com/v1/skills?beta=true');
    expect(init?.method).toBe('POST');

    const headers = init?.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('sk-ant-test');
    expect(headers['anthropic-version']).toBe('2023-06-01');
    expect(headers['anthropic-beta']).toBe('skills-2025-10-02');

    const form = init?.body as FormData;
    expect(form.get('display_title')).toBe('My Skill');
    const files = form.getAll('files[]') as File[];
    // Directory name is the sanitized skill name
    expect(files.map((f) => f.name).sort()).toEqual([
      'my-skill/SKILL.md',
      'my-skill/scripts/run.py',
    ]);
  });

  it('appends the skills beta to auth-required betas', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { id: 'skill_01A', display_title: null, latest_version: '1' })
    );

    await uploadSkillToManagedAgents(
      { name: 'my-skill', files: [{ path: 'SKILL.md', content: '#' }] },
      {
        headers: { Authorization: 'Bearer t' },
        betas: ['oauth-2025-04-20'],
        source: 'ant CLI',
      }
    );

    const headers = fetchMock.mock.calls[0]![1]?.headers as Record<string, string>;
    expect(headers['anthropic-beta']).toBe('oauth-2025-04-20,skills-2025-10-02');
  });

  it('uploads a new version when the display title already exists', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(400, {
          type: 'error',
          error: {
            type: 'invalid_request_error',
            message: 'Skill cannot reuse an existing display_title: My Skill',
          },
        })
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          data: [
            { id: 'skill_00Z', display_title: 'Other', latest_version: '1' },
            { id: 'skill_01A', display_title: 'My Skill', latest_version: '1' },
          ],
          has_more: false,
          last_id: 'skill_01A',
        })
      )
      .mockResolvedValueOnce(jsonResponse(200, { skill_id: 'skill_01A', version: '456' }));

    const result = await uploadSkillToManagedAgents(
      { name: 'My Skill', files: [{ path: 'SKILL.md', content: '#' }] },
      API_KEY_AUTH
    );

    expect(result).toEqual({ skillId: 'skill_01A', version: '456', action: 'updated' });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const listUrl = String(fetchMock.mock.calls[1]![0]);
    expect(listUrl).toContain('/v1/skills?');
    expect(listUrl).toContain('source=custom');
    const versionUrl = String(fetchMock.mock.calls[2]![0]);
    expect(versionUrl).toBe('https://api.anthropic.com/v1/skills/skill_01A/versions?beta=true');

    // Version uploads carry no display_title
    const versionForm = fetchMock.mock.calls[2]![1]?.body as FormData;
    expect(versionForm.get('display_title')).toBeNull();
  });

  it('throws a ManagedAgentsApiError on other API failures', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(401, {
        type: 'error',
        error: { type: 'authentication_error', message: 'invalid x-api-key' },
      })
    );

    await expect(
      uploadSkillToManagedAgents(
        { name: 'my-skill', files: [{ path: 'SKILL.md', content: '#' }] },
        API_KEY_AUTH
      )
    ).rejects.toThrow(ManagedAgentsApiError);
  });

  it('honors ANTHROPIC_BASE_URL', async () => {
    vi.stubEnv('ANTHROPIC_BASE_URL', 'https://api.staging.example/');
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { id: 'skill_01A', display_title: null, latest_version: '1' })
    );

    await uploadSkillToManagedAgents(
      { name: 'my-skill', files: [{ path: 'SKILL.md', content: '#' }] },
      API_KEY_AUTH
    );

    expect(String(fetchMock.mock.calls[0]![0])).toBe(
      'https://api.staging.example/v1/skills?beta=true'
    );
  });
});
