import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { readParamState, writeParamState } from '../src/templates/state.ts';

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'skills-params-test-'));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe('readParamState', () => {
  it('returns null when file does not exist', async () => {
    const result = await readParamState(tempDir);
    expect(result).toBeNull();
  });

  it('returns null for invalid JSON', async () => {
    await writeFile(join(tempDir, '.params.json'), 'not json');
    const result = await readParamState(tempDir);
    expect(result).toBeNull();
  });

  it('reads valid params', async () => {
    const params = { dir: 'src', debug: true, count: 3 };
    await writeFile(join(tempDir, '.params.json'), JSON.stringify({ params }));
    const result = await readParamState(tempDir);
    expect(result).toEqual(params);
  });
});

describe('writeParamState', () => {
  it('writes and reads back params', async () => {
    const params = { component_dir: 'app/ui', use_ts: true, retries: 5 };
    await writeParamState(tempDir, params);
    const result = await readParamState(tempDir);
    expect(result).toEqual(params);
  });
});

describe('parseAddOptions --configure and --param', () => {
  it('parses --configure flag', async () => {
    const { parseAddOptions } = await import('../src/add.ts');
    const { options } = parseAddOptions(['vercel-labs/skills', '--configure']);
    expect(options.configure).toBe(true);
  });

  it('parses --param key=value', async () => {
    const { parseAddOptions } = await import('../src/add.ts');
    const { options } = parseAddOptions([
      'vercel-labs/skills',
      '--param',
      'dir=src/ui',
      '--param',
      'framework=react',
    ]);
    expect(options.param).toEqual({ dir: 'src/ui', framework: 'react' });
  });

  it('parses mixed --configure and --param', async () => {
    const { parseAddOptions } = await import('../src/add.ts');
    const { options } = parseAddOptions([
      'vercel-labs/skills',
      '--configure',
      '--param',
      'dir=src',
    ]);
    expect(options.configure).toBe(true);
    expect(options.param).toEqual({ dir: 'src' });
  });
});
