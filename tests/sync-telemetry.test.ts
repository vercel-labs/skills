import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
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
    isCancel: () => false,
    log: { info: noop, message: noop, warn: noop, error: noop, step: noop, success: noop },
    spinner: () => ({ start: noop, stop: noop, message: noop }),
  };
});

vi.mock('../src/telemetry.ts', () => ({
  track: vi.fn(),
  setVersion: vi.fn(),
  fetchAuditData: vi.fn().mockResolvedValue(null),
}));

vi.mock('../src/detect-agent.ts', () => ({
  detectAgent: vi.fn().mockResolvedValue({ isAgent: false, agent: { name: 'none' } }),
  getAgentType: vi.fn(),
}));

import { runSync } from '../src/sync.ts';
import { track } from '../src/telemetry.ts';

async function writeJson(path: string, data: object): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, JSON.stringify(data));
}

async function writeSkill(dir: string, name: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: ${name}\n---\n`);
}

describe('experimental_sync telemetry', () => {
  let project: string;
  let originalCwd: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    project = await mkdtemp(join(tmpdir(), 'sync-telemetry-'));
    originalCwd = process.cwd();
    process.chdir(project);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await rm(project, { recursive: true, force: true });
  });

  it('reports the npm packages that shipped skills', async () => {
    await writeJson(join(project, 'package.json'), {
      dependencies: { '@acme/tools': '*', 'plain-lib': '*' },
    });
    const tools = join(project, 'node_modules', '@acme', 'tools');
    await writeJson(join(tools, 'package.json'), { name: '@acme/tools', version: '2.1.0' });
    await writeSkill(join(tools, 'skills', 'tool-a'), 'tool-a');
    await writeJson(join(project, 'node_modules', 'plain-lib', 'package.json'), {
      name: 'plain-lib',
      version: '1.0.0',
    });

    await runSync([], { yes: true, agent: ['claude-code'] });

    expect(track).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'experimental_sync', skillCount: '1' })
    );
    const event = vi.mocked(track).mock.calls[0]![0];
    expect('packages' in event && JSON.parse(event.packages!)).toEqual([
      {
        skill: 'tool-a',
        package: '@acme/tools',
        ecosystem: 'npm',
        registry: 'npm',
        version: '2.1.0',
      },
    ]);
  });

  it('does not report private packages such as linked workspace packages', async () => {
    await writeJson(join(project, 'package.json'), { dependencies: { '@acme/internal': '*' } });
    const internal = join(project, 'node_modules', '@acme', 'internal');
    await writeJson(join(internal, 'package.json'), {
      name: '@acme/internal',
      version: '0.0.0',
      private: true,
    });
    await writeSkill(join(internal, 'skills', 'internal-a'), 'internal-a');

    await runSync([], { yes: true, agent: ['claude-code'] });

    expect(vi.mocked(track).mock.calls[0]![0]).not.toHaveProperty('packages');
  });
});
