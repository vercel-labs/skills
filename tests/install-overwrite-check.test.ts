import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { runCli } from '../src/test-utils.ts';

describe('add summary: overwrites', () => {
  let root: string;
  let home: string;
  let project: string;
  let source: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'skills-overwrite-check-'));
    home = join(root, 'home');
    project = join(root, 'project');
    source = join(root, 'source');
    mkdirSync(home, { recursive: true });
    mkdirSync(project, { recursive: true });
    mkdirSync(join(source, 'demo'), { recursive: true });
    writeFileSync(
      join(source, 'demo', 'SKILL.md'),
      '---\nname: demo\ndescription: Demo skill\n---\n\n# Demo\n'
    );
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const add = (...args: string[]) =>
    runCli(['add', source, '-y', ...args], project, { HOME: home, AI_AGENT: '' });

  it('warns before a global reinstall for an agent that reads ~/.agents/skills', () => {
    const first = add('-g', '--agent', 'cursor');
    expect(first.exitCode).toBe(0);
    expect(existsSync(join(home, '.agents', 'skills', 'demo', 'SKILL.md'))).toBe(true);
    expect(first.stdout).not.toContain('overwrites:');

    const second = add('-g', '--agent', 'cursor');

    expect(second.exitCode).toBe(0);
    expect(second.stdout).toMatch(/overwrites:\s+Cursor/);
  });

  it('still warns for an agent with its own global skills dir', () => {
    add('-g', '--agent', 'claude-code');

    const second = add('-g', '--agent', 'claude-code');

    expect(second.stdout).toMatch(/overwrites:\s+Claude Code/);
  });

  it('still warns for a project reinstall', () => {
    add('--agent', 'cursor');

    const second = add('--agent', 'cursor');

    expect(second.stdout).toMatch(/overwrites:\s+Cursor/);
  });
});
