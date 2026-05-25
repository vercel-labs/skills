import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadPolicy } from '../src/policy.ts';

describe('loadPolicy schema validation', () => {
  let fakeHome: string;
  let cwd: string;
  let originalHome: string | undefined;
  let originalEnv: string | undefined;

  beforeEach(async () => {
    fakeHome = await mkdtemp(join(tmpdir(), 'pol-home-'));
    cwd = await mkdtemp(join(tmpdir(), 'pol-cwd-'));
    originalHome = process.env.HOME;
    originalEnv = process.env.SKILLS_POLICY;
    process.env.HOME = fakeHome;
    delete process.env.SKILLS_POLICY;
  });

  afterEach(async () => {
    if (originalHome !== undefined) process.env.HOME = originalHome;
    else delete process.env.HOME;
    if (originalEnv !== undefined) process.env.SKILLS_POLICY = originalEnv;
    else delete process.env.SKILLS_POLICY;
    await rm(fakeHome, { recursive: true, force: true });
    await rm(cwd, { recursive: true, force: true });
  });

  it('returns null when no policy file exists', () => {
    const { policy, sourcePath } = loadPolicy(cwd);
    expect(policy).toBeNull();
    expect(sourcePath).toBeNull();
  });

  it('rejects .well-known: proxy_only at load time', async () => {
    await writeFile(
      join(cwd, '.skills-policy.json'),
      JSON.stringify({ version: 1, providers: { '.well-known': 'proxy_only' } })
    );
    expect(() => loadPolicy(cwd)).toThrow(/cannot be "proxy_only"/);
  });

  it('rejects mirror with empty providers list', async () => {
    await writeFile(
      join(cwd, '.skills-policy.json'),
      JSON.stringify({
        version: 1,
        mirror: { url: 'https://mirror.corp', providers: [] },
      })
    );
    expect(() => loadPolicy(cwd)).toThrow(/mirror.providers must be a non-empty array/);
  });

  it('rejects mirror.providers containing .well-known', async () => {
    await writeFile(
      join(cwd, '.skills-policy.json'),
      JSON.stringify({
        version: 1,
        mirror: { url: 'https://mirror.corp', providers: ['.well-known'] },
      })
    );
    expect(() => loadPolicy(cwd)).toThrow(/mirror.providers cannot include ".well-known"/);
  });

  it('accepts a valid mirror configuration', async () => {
    await writeFile(
      join(cwd, '.skills-policy.json'),
      JSON.stringify({
        version: 1,
        providers: { github: 'proxy_only' },
        mirror: { url: 'https://artifactory.corp/agent-skills', providers: ['github', 'gitlab'] },
      })
    );
    const { policy } = loadPolicy(cwd);
    expect(policy?.mirror?.url).toBe('https://artifactory.corp/agent-skills');
    expect(policy?.mirror?.providers).toEqual(['github', 'gitlab']);
  });

  it('respects lookup precedence: $SKILLS_POLICY > cwd > home', async () => {
    await mkdir(join(fakeHome, '.agents'), { recursive: true });
    await writeFile(
      join(fakeHome, '.agents', 'skills-policy.json'),
      JSON.stringify({ version: 1, default: 'allow' })
    );
    await writeFile(
      join(cwd, '.skills-policy.json'),
      JSON.stringify({ version: 1, default: 'deny' })
    );
    expect(loadPolicy(cwd).policy?.default).toBe('deny');

    const envPath = join(cwd, 'env-policy.json');
    await writeFile(envPath, JSON.stringify({ version: 1, providers: { github: 'deny' } }));
    process.env.SKILLS_POLICY = envPath;
    const loaded = loadPolicy(cwd);
    expect(loaded.policy?.providers?.github).toBe('deny');
    expect(loaded.policy?.default).toBeUndefined();
  });
});
