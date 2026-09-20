import { describe, expect, it } from 'vitest';
import pc from 'picocolors';
import { buildSkillSummaryLines } from '../src/add.ts';

// The Installation Summary must advertise the paths that will actually be
// written. In copy mode each agent (or group of agents sharing a base dir)
// receives its own copy, so the summary header must show the per-group
// install destination — not the canonical ~/.agents/skills path, which is
// only written in symlink mode. See PR #1483 (warot-a's review comment).

const CWD = '/tmp/some-project';

describe('buildSkillSummaryLines', () => {
  describe('copy mode', () => {
    it('shows the agent-specific global destination for a single non-universal agent', () => {
      const lines = buildSkillSummaryLines({
        skillName: 'git-stage-message',
        targetAgents: ['antigravity-cli'],
        installMode: 'copy',
        global: true,
        cwd: CWD,
      });

      expect(lines).toEqual([
        pc.cyan('~/.gemini/antigravity-cli/skills/git-stage-message'),
        `  ${pc.dim('copy →')} Antigravity CLI`,
      ]);
    });

    it('groups agents by their resolved base dir, preserving selection order', () => {
      const lines = buildSkillSummaryLines({
        skillName: 'git-stage-message',
        targetAgents: ['codex', 'antigravity-cli'],
        installMode: 'copy',
        global: true,
        cwd: CWD,
      });

      // codex is universal → resolves to the canonical global dir;
      // antigravity-cli is not → resolves to its own globalSkillsDir.
      expect(lines).toEqual([
        pc.cyan('~/.agents/skills/git-stage-message'),
        `  ${pc.dim('copy →')} Codex`,
        pc.cyan('~/.gemini/antigravity-cli/skills/git-stage-message'),
        `  ${pc.dim('copy →')} Antigravity CLI`,
      ]);
    });

    it('merges agents that resolve to the same base dir onto one line', () => {
      // Project scope: both agents read from .agents/skills in the workspace.
      const lines = buildSkillSummaryLines({
        skillName: 'git-stage-message',
        targetAgents: ['codex', 'antigravity-cli'],
        installMode: 'copy',
        global: false,
        cwd: CWD,
      });

      expect(lines).toEqual([
        pc.cyan('./.agents/skills/git-stage-message'),
        `  ${pc.dim('copy →')} Codex, Antigravity CLI`,
      ]);
    });

    it('reports overwrites within the group that would overwrite', () => {
      const lines = buildSkillSummaryLines({
        skillName: 'git-stage-message',
        targetAgents: ['codex', 'antigravity-cli'],
        installMode: 'copy',
        global: true,
        cwd: CWD,
        isOverwrite: (agent) => agent === 'antigravity-cli',
      });

      expect(lines).toEqual([
        pc.cyan('~/.agents/skills/git-stage-message'),
        `  ${pc.dim('copy →')} Codex`,
        pc.cyan('~/.gemini/antigravity-cli/skills/git-stage-message'),
        `  ${pc.dim('copy →')} Antigravity CLI`,
        `  ${pc.yellow('overwrites:')} Antigravity CLI`,
      ]);
    });

    it('shows the file count once, after all groups', () => {
      const lines = buildSkillSummaryLines({
        skillName: 'git-stage-message',
        targetAgents: ['codex', 'antigravity-cli'],
        installMode: 'copy',
        global: true,
        cwd: CWD,
        fileCount: 3,
      });

      expect(lines).toContain(`  ${pc.dim('files:')} 3`);
      expect(lines[lines.length - 1]).toBe(`  ${pc.dim('files:')} 3`);
    });

    it('sanitizes the skill name into the displayed path', () => {
      const lines = buildSkillSummaryLines({
        skillName: '../Evil Name',
        targetAgents: ['antigravity-cli'],
        installMode: 'copy',
        global: true,
        cwd: CWD,
      });

      expect(lines[0]).toBe(pc.cyan('~/.gemini/antigravity-cli/skills/evil-name'));
    });
  });

  describe('symlink mode', () => {
    it('keeps the canonical path header and universal/symlink agent lines', () => {
      const lines = buildSkillSummaryLines({
        skillName: 'git-stage-message',
        targetAgents: ['codex', 'antigravity-cli'],
        installMode: 'symlink',
        global: true,
        cwd: CWD,
      });

      expect(lines).toEqual([
        pc.cyan('~/.agents/skills/git-stage-message'),
        `  ${pc.green('universal:')} Codex`,
        `  ${pc.dim('symlink →')} Antigravity CLI`,
      ]);
    });

    it('reports overwrites across all target agents', () => {
      const lines = buildSkillSummaryLines({
        skillName: 'git-stage-message',
        targetAgents: ['codex', 'antigravity-cli'],
        installMode: 'symlink',
        global: true,
        cwd: CWD,
        isOverwrite: () => true,
      });

      expect(lines).toEqual([
        pc.cyan('~/.agents/skills/git-stage-message'),
        `  ${pc.green('universal:')} Codex`,
        `  ${pc.dim('symlink →')} Antigravity CLI`,
        `  ${pc.yellow('overwrites:')} Codex, Antigravity CLI`,
      ]);
    });
  });

  describe('path shortening parity with install targets', () => {
    it('shortens home-prefixed destinations to ~', () => {
      const lines = buildSkillSummaryLines({
        skillName: 'my-skill',
        targetAgents: ['antigravity'],
        installMode: 'copy',
        global: true,
        cwd: CWD,
      });

      expect(lines[0]).toBe(pc.cyan('~/.gemini/config/skills/my-skill'));
    });
  });
});
