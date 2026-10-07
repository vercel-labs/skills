import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

vi.mock('@clack/prompts', () => {
  const noop = () => {};
  return {
    intro: noop,
    outro: noop,
    note: noop,
    confirm: vi.fn().mockResolvedValue(true),
    cancel: noop,
    log: {
      info: noop,
      message: noop,
      warn: noop,
      error: noop,
      step: noop,
      success: noop,
    },
    spinner: () => ({ start: noop, stop: noop }),
  };
});

vi.mock('picocolors', () => {
  const identity = (value: string) => value;
  const colors = [
    'red',
    'green',
    'blue',
    'yellow',
    'cyan',
    'white',
    'black',
    'dim',
    'bold',
    'bgRed',
    'bgCyan',
    'bgBlack',
    'bgWhite',
    'underline',
    'inverse',
    'magenta',
    'gray',
    'reset',
  ];
  const colorMap: any = identity;
  for (const color of colors) colorMap[color] = identity;
  return { default: colorMap };
});

vi.mock('../src/telemetry.ts', () => ({
  track: vi.fn(),
  setVersion: vi.fn(),
  fetchAuditData: vi.fn().mockResolvedValue(null),
}));

vi.mock('../src/detect-agent.ts', () => ({
  detectAgent: vi.fn().mockResolvedValue({ isAgent: false, agent: { name: 'none' } }),
  getAgentType: vi.fn(),
  ensureUniversalAgents: vi.fn((agents: string[]) => agents),
}));

import { removeCommand } from '../src/remove.ts';
import { track } from '../src/telemetry.ts';

describe('remove telemetry source masking (#2278)', () => {
  let project: string;
  let originalCwd: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    project = await mkdtemp(join(tmpdir(), 'remove-telemetry-'));
    originalCwd = process.cwd();
    process.chdir(project);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await rm(project, { recursive: true, force: true });
  });

  it('reports a local lock entry\'s source as "local", never its absolute path, while a github entry keeps owner/repo', async () => {
    const absoluteLocalPath = join(project, 'my-local-skills', 'local-skill');

    await writeFile(
      join(project, 'skills-lock.json'),
      JSON.stringify(
        {
          version: 1,
          skills: {
            'local-skill': {
              source: absoluteLocalPath,
              sourceType: 'local',
              computedHash: 'localhash',
            },
            'gh-skill': {
              source: 'owner/repo',
              sourceType: 'github',
              computedHash: 'githash',
            },
          },
        },
        null,
        2
      )
    );

    await removeCommand(['local-skill', 'gh-skill'], { yes: true });

    expect(track).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'remove',
        source: 'local',
        sourceType: 'local',
        skills: 'local-skill',
      })
    );
    expect(track).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'remove',
        source: 'owner/repo',
        sourceType: 'github',
        skills: 'gh-skill',
      })
    );

    for (const call of vi.mocked(track).mock.calls) {
      const data = call[0] as { source?: string };
      expect(data.source).not.toBe(absoluteLocalPath);
    }
  });
});
