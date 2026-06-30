/**
 * Tests for checkAndPromptForDeletions: a repo reorganization (skills moved to
 * a new path) must NOT be reported as an upstream deletion, while genuinely
 * removed/renamed skills still are.
 */

import { describe, it, expect } from 'vitest';
import { checkAndPromptForDeletions } from '../src/update.ts';

const lockSkills: Record<string, { skillPath?: string }> = {
  // Moved: plugins/.../skills/<name> -> skills/<name>
  'ce-brainstorm': { skillPath: 'plugins/compound-engineering/skills/ce-brainstorm/SKILL.md' },
  'ce:plan': { skillPath: 'plugins/compound-engineering/skills/ce-plan/SKILL.md' },
  // Renamed upstream (ce-review -> ce-code-review): genuinely gone under this name
  'ce:review': { skillPath: 'plugins/compound-engineering/skills/ce-review/SKILL.md' },
  // Genuinely deleted upstream
  changelog: { skillPath: 'plugins/compound-engineering/skills/changelog/SKILL.md' },
  // Entry with no recorded path: never flagged
  legacy: {},
};

// Live tree after the repo moved skills to root-level skills/
const discoveredPaths = [
  'skills/ce-brainstorm/SKILL.md',
  'skills/ce-plan/SKILL.md',
  'skills/ce-code-review/SKILL.md',
  'skills/ce-compound/SKILL.md',
];

describe('checkAndPromptForDeletions', () => {
  it('does not flag relocated skills, only genuinely removed ones', async () => {
    const deleted = await checkAndPromptForDeletions(
      'everyinc/compound-engineering-plugin',
      Object.keys(lockSkills),
      lockSkills,
      true,
      { yes: true }, // non-interactive: detect without prompting/removing
      discoveredPaths
    );

    // ce-brainstorm and ce:plan moved -> not deleted.
    expect(deleted).not.toContain('ce-brainstorm');
    expect(deleted).not.toContain('ce:plan');
    // ce:review renamed (no ce-review folder upstream) and changelog removed.
    expect(deleted.sort()).toEqual(['ce:review', 'changelog']);
  });

  it('returns nothing when every locked path still exists', async () => {
    const deleted = await checkAndPromptForDeletions(
      'owner/repo',
      ['ce-brainstorm'],
      { 'ce-brainstorm': { skillPath: 'skills/ce-brainstorm/SKILL.md' } },
      true,
      { yes: true },
      ['skills/ce-brainstorm/SKILL.md']
    );
    expect(deleted).toEqual([]);
  });
});
