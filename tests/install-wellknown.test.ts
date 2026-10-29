import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { restoreWellKnownGroup } from '../src/install.ts';
import type { LocalSkillLockEntry } from '../src/local-lock.ts';
import { getUniversalAgents } from '../src/agents.ts';
import { wellKnownProvider, type WellKnownSkill } from '../src/providers/index.ts';

function fixture(installName: string): WellKnownSkill {
  return {
    name: installName,
    installName,
    description: `${installName} description`,
    content: `---\nname: ${installName}\ndescription: d\n---\n# ${installName}\n`,
    sourceUrl: `https://example.com/${installName}/SKILL.md`,
    providerId: 'well-known',
    sourceIdentifier: 'example.com',
    files: new Map([
      ['SKILL.md', `---\nname: ${installName}\ndescription: d\n---\n# ${installName}\n`],
    ]),
    indexEntry: {
      name: installName,
      type: 'skill-md',
      description: 'd',
      url: `https://example.com/${installName}/SKILL.md`,
      digest: `sha256:${installName}`,
    } as WellKnownSkill['indexEntry'],
  };
}

function locked(...names: string[]): Record<string, LocalSkillLockEntry> {
  return Object.fromEntries(
    names.map((name) => [
      name,
      { source: 'example.com', sourceType: 'well-known', computedHash: 'old' },
    ])
  );
}

describe('restoreWellKnownGroup', () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), 'skills-wellknown-restore-'));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(cwd, { recursive: true, force: true });
  });

  it('restores published skills and reports a missing one without exiting', async () => {
    vi.spyOn(wellKnownProvider, 'fetchAllSkills').mockResolvedValue([
      fixture('alpha'),
      fixture('beta'),
    ]);

    const result = await restoreWellKnownGroup(
      'https://example.com',
      locked('alpha', 'removed-skill'),
      getUniversalAgents().slice(0, 2),
      cwd
    );

    expect(result.lockUpdates).toEqual({
      alpha: expect.objectContaining({
        computedHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        wellKnownDigest: 'sha256:alpha',
      }),
    });
    expect(result.missing).toEqual(['removed-skill']);
    expect(result.error).toBeUndefined();
    expect(existsSync(join(cwd, '.agents', 'skills', 'alpha', 'SKILL.md'))).toBe(true);

    const installed = await readFile(join(cwd, '.agents', 'skills', 'alpha', 'SKILL.md'), 'utf-8');
    expect(installed).toContain('# alpha');
    expect(existsSync(join(cwd, '.agents', 'skills', 'removed-skill'))).toBe(false);
  });

  it('reports a source that has no reachable index as an error', async () => {
    vi.spyOn(wellKnownProvider, 'fetchAllSkills').mockResolvedValue([]);

    const result = await restoreWellKnownGroup(
      'https://example.com',
      locked('alpha'),
      getUniversalAgents().slice(0, 1),
      cwd
    );

    expect(result.lockUpdates).toEqual({});
    expect(result.missing).toEqual(['alpha']);
  });
});
