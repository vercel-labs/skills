import { mkdirSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getPresentAgents } from './agents.ts';

describe('getPresentAgents', () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'get-present-agents-'));
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it('returns an empty array when no agent config roots exist', () => {
    expect(getPresentAgents(cwd)).toEqual([]);
  });

  it('includes Claude Code when .claude/ exists', () => {
    mkdirSync(join(cwd, '.claude'), { recursive: true });

    const present = getPresentAgents(cwd);

    expect(present).toContain('claude-code');
  });

  it('includes universal agents when .agents/ exists', () => {
    mkdirSync(join(cwd, '.agents'), { recursive: true });

    const present = getPresentAgents(cwd);

    // At least one universal agent should be present. claude-code is
    // non-universal (skillsDir: '.claude/skills') so it must NOT be in
    // the result here.
    expect(present.length).toBeGreaterThan(0);
    expect(present).toContain('codex');
    expect(present).not.toContain('claude-code');
  });

  it('combines Claude Code and universal agents when both directories exist', () => {
    mkdirSync(join(cwd, '.claude'), { recursive: true });
    mkdirSync(join(cwd, '.agents'), { recursive: true });

    const present = getPresentAgents(cwd);

    expect(present).toContain('claude-code');
    expect(present.length).toBeGreaterThan(1);
  });

  it('does not include non-universal agents whose config root is absent', () => {
    mkdirSync(join(cwd, '.claude'), { recursive: true });

    const present = getPresentAgents(cwd);

    // kiro-cli uses .kiro/ as its config root -- it must NOT be returned
    // because we did not create .kiro/.
    expect(present).not.toContain('kiro-cli');
    expect(present).not.toContain('windsurf');
  });

  it('excludes Eve from the result', () => {
    mkdirSync(join(cwd, '.agents'), { recursive: true });

    const present = getPresentAgents(cwd);

    expect(present).not.toContain('eve');
  });

  it('treats a deeper config root presence as sufficient (e.g. .claude/skills)', () => {
    mkdirSync(join(cwd, '.claude', 'skills'), { recursive: true });

    const present = getPresentAgents(cwd);

    expect(present).toContain('claude-code');
  });

  it('does not falsely detect OpenClaw when cwd has a generic top-level skills/ folder', () => {
    // OpenClaw's skillsDir is 'skills' (not dot-prefixed). A project may
    // have a top-level skills/ folder for unrelated reasons (docs,
    // samples, etc.). Including OpenClaw here would cause the spawned
    // `add` to write into that path -- with rm-rf semantics in
    // installSkillForAgent. We must skip OpenClaw.
    mkdirSync(join(cwd, 'skills'), { recursive: true });

    const present = getPresentAgents(cwd);

    expect(present).not.toContain('openclaw');
  });

  it('does not falsely detect AstrBot when cwd has a generic top-level data/ folder', () => {
    // AstrBot's skillsDir is 'data/skills' (not dot-prefixed). A project
    // may have a top-level data/ folder for fixtures, raw inputs, etc.
    // We must skip AstrBot unless cwd/data/skills is the actual
    // configuration, which this heuristic cannot distinguish.
    mkdirSync(join(cwd, 'data'), { recursive: true });

    const present = getPresentAgents(cwd);

    expect(present).not.toContain('astrbot');
  });

  it('includes multiple non-universal agents when their config roots coexist', () => {
    // Claude Code (.claude/skills) and Kiro CLI (.kiro/skills) both have
    // dot-prefixed first components and must both be detected when
    // their config roots are present.
    mkdirSync(join(cwd, '.claude'), { recursive: true });
    mkdirSync(join(cwd, '.kiro'), { recursive: true });

    const present = getPresentAgents(cwd);

    expect(present).toContain('claude-code');
    expect(present).toContain('kiro-cli');
  });
});
