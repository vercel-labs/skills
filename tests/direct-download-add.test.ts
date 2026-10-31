import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { gzipSync } from 'node:zlib';

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

vi.mock('../src/source-parser.ts', async (importActual) => {
  const actual = await importActual<typeof import('../src/source-parser.ts')>();
  return {
    ...actual,
    isRepoPrivate: vi.fn().mockResolvedValue(false),
  };
});

import { runAdd } from '../src/add.ts';
import { track } from '../src/telemetry.ts';

const DISCOVERY_SCHEMA_V2 = 'https://schemas.agentskills.io/discovery/0.2.0/schema.json';

function createTarGz(files: Record<string, string>): Uint8Array {
  const chunks: Buffer[] = [];

  for (const [name, contents] of Object.entries(files)) {
    const body = Buffer.from(contents);
    const header = Buffer.alloc(512);
    header.write(name, 0, 100, 'utf8');
    header.write('0000644\0', 100, 8, 'ascii');
    header.write('0000000\0', 108, 8, 'ascii');
    header.write('0000000\0', 116, 8, 'ascii');
    header.write(body.length.toString(8).padStart(11, '0') + '\0', 124, 12, 'ascii');
    header.write('00000000000\0', 136, 12, 'ascii');
    header.fill(' ', 148, 156);
    header[156] = '0'.charCodeAt(0);
    header.write('ustar\0', 257, 6, 'ascii');
    header.write('00', 263, 2, 'ascii');

    let checksum = 0;
    for (const byte of header) checksum += byte;
    header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii');

    chunks.push(header, body);
    const padding = (512 - (body.length % 512)) % 512;
    if (padding) chunks.push(Buffer.alloc(padding));
  }

  chunks.push(Buffer.alloc(1024));
  return new Uint8Array(gzipSync(Buffer.concat(chunks)));
}

describe('direct download add', () => {
  let project: string;
  let originalCwd: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    project = await mkdtemp(join(tmpdir(), 'direct-download-add-'));
    originalCwd = process.cwd();
    process.chdir(project);
    vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit called');
    }) as never);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    vi.restoreAllMocks();
    await rm(project, { recursive: true, force: true });
  });

  it('installs a signed direct URL without persisting it for updates', async () => {
    const directUrl = 'https://downloads.example.com/artifacts/direct-skill?x-amz-signature=secret';
    const skillMd = '---\nname: direct-skill\ndescription: Direct skill\n---\n\n# Direct skill\n';

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url) === directUrl) {
        return new Response(skillMd, {
          status: 200,
          headers: { 'content-length': String(Buffer.byteLength(skillMd)) },
        });
      }
      return new Response('not found', { status: 404 });
    });

    await runAdd([directUrl], {
      yes: true,
      agent: ['codex'],
      global: false,
      copy: true,
    });

    await expect(
      readFile(join(project, '.agents', 'skills', 'direct-skill', 'SKILL.md'), 'utf-8')
    ).resolves.toContain('# Direct skill');
    expect(existsSync(join(project, 'skills-lock.json'))).toBe(false);
  });

  it('reports the canonical discovery url separately from its archive artifact', async () => {
    const installUrl = 'https://registry.example.com/publishers/acme/skills/archive-skill';
    const indexUrl = `${installUrl}/.well-known/agent-skills/index.json`;
    const artifactUrl = 'https://cdn.example.net/artifacts/archive-skill.tar.gz?version=1.2.5';
    const skillMd =
      '---\nname: archive-skill\ndescription: Archive skill\n---\n\n# Archive skill\n';
    const archive = createTarGz({ 'SKILL.md': skillMd });
    const digest = `sha256:${createHash('sha256').update(archive).digest('hex')}`;

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const href = String(url);
      if (href === indexUrl) {
        return Response.json({
          $schema: DISCOVERY_SCHEMA_V2,
          skills: [
            {
              name: 'archive-skill',
              type: 'archive',
              description: 'Archive skill',
              url: artifactUrl,
              digest,
            },
          ],
        });
      }
      if (href === artifactUrl) {
        return new Response(archive, {
          status: 200,
          headers: { 'content-type': 'application/gzip' },
        });
      }
      return new Response('not found', { status: 404 });
    });

    await runAdd([installUrl], {
      yes: true,
      agent: ['codex'],
      global: false,
      copy: true,
    });

    expect(track).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'install',
        source: 'registry.example.com',
        installUrl,
        skillFiles: JSON.stringify({ 'archive-skill': artifactUrl }),
        sourceType: 'well-known',
      })
    );
  });
});
