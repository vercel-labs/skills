/**
 * Antigravity uses .agents/skills inside a workspace, but outside one it reads
 * global skills only from ~/.gemini/config/skills. A global install must put the
 * skill there, in copy mode (Antigravity alone) and in symlink mode (Antigravity
 * beside other agents), and must leave agents that read ~/.agents/skills alone.
 */
import { describe, it, expect } from 'vitest';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join, resolve, dirname } from 'path';
import { runCli } from '../src/test-utils.ts';
import { readsCanonicalGlobally } from '../src/agents.ts';

function makeSkill(root: string): string {
  const dir = join(root, 'source', 'probe-skill');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), '---\nname: probe-skill\ndescription: Probe\n---\nBody\n');
  return dir;
}

function install(agentArgs: string[]) {
  const root = mkdtempSync(join(tmpdir(), 'skills-antigravity-'));
  const home = join(root, 'home');
  mkdirSync(home, { recursive: true });
  const result = runCli(['add', makeSkill(root), '-g', '-y', '-a', ...agentArgs], root, {
    HOME: home,
  });
  return { root, home, result };
}

describe('Antigravity global install', () => {
  it('does not read the canonical directory globally', () => {
    expect(readsCanonicalGlobally('antigravity')).toBe(false);
    expect(readsCanonicalGlobally('antigravity-cli')).toBe(false);
    expect(readsCanonicalGlobally('codex')).toBe(true);
    expect(readsCanonicalGlobally('github-copilot')).toBe(true);
  });

  it('copies into ~/.gemini/config/skills when installed alone', () => {
    const { root, home, result } = install(['antigravity-cli']);
    try {
      expect(result.exitCode).toBe(0);
      const target = join(home, '.gemini', 'config', 'skills', 'probe-skill');
      expect(existsSync(join(target, 'SKILL.md'))).toBe(true);
      expect(lstatSync(target).isSymbolicLink()).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('links ~/.gemini/config/skills to the canonical copy beside other agents', () => {
    const { root, home, result } = install(['antigravity', 'codex', 'claude-code']);
    try {
      expect(result.exitCode).toBe(0);
      const canonical = join(home, '.agents', 'skills', 'probe-skill');
      const link = join(home, '.gemini', 'config', 'skills', 'probe-skill');
      expect(existsSync(join(canonical, 'SKILL.md'))).toBe(true);
      expect(lstatSync(link).isSymbolicLink()).toBe(true);
      expect(resolve(dirname(link), readlinkSync(link))).toBe(canonical);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('keeps a universal agent that reads ~/.agents/skills in the canonical directory', () => {
    const { root, home, result } = install(['github-copilot']);
    try {
      expect(result.exitCode).toBe(0);
      expect(existsSync(join(home, '.agents', 'skills', 'probe-skill', 'SKILL.md'))).toBe(true);
      expect(existsSync(join(home, '.copilot', 'skills', 'probe-skill'))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
