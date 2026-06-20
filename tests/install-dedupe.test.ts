import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runCli } from '../src/test-utils.ts';

/**
 * Regression test for duplicated destination paths in the copy-mode install
 * summary (vercel-labs/skills#1368).
 *
 * When several universal agents are targeted, they all resolve to the same
 * `.agents/skills` directory. The install must not copy the skill there once
 * per agent — the success summary should list the destination path exactly
 * once.
 */
describe('install deduplicates agents sharing one directory', () => {
  let sourceDir: string;
  let projectDir: string;

  beforeEach(async () => {
    sourceDir = await mkdtemp(join(tmpdir(), 'dedupe-src-'));
    projectDir = await mkdtemp(join(tmpdir(), 'dedupe-proj-'));
    const skillDir = join(sourceDir, 'demo-skill');
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, 'SKILL.md'),
      '---\nname: demo-skill\ndescription: demo\n---\n# Demo\n',
      'utf-8'
    );
  });

  afterEach(async () => {
    await rm(sourceDir, { recursive: true, force: true });
    await rm(projectDir, { recursive: true, force: true });
  });

  it('lists the destination path once when targeting multiple universal agents', () => {
    // codex, amp and antigravity are all universal agents → one shared dir → copy mode.
    const result = runCli(
      ['add', sourceDir, '-y', '-a', 'codex', '-a', 'amp', '-a', 'antigravity'],
      projectDir
    );

    expect(result.exitCode).toBe(0);

    const destinationLines = result.stdout
      .split('\n')
      .filter((line) => line.includes('→') && line.includes('demo-skill'));

    expect(destinationLines).toHaveLength(1);
  });
});
