import { describe, it, expect } from 'vitest';
import { checkAgentCompatibility } from '../src/classifiers/compatibility.ts';
import { parseClassifiers } from '../src/classifiers/parser.ts';
import type { AgentType } from '../src/types.ts';

describe('checkAgentCompatibility', () => {
  it('returns no warnings when no classifiers', () => {
    const warnings = checkAgentCompatibility('my-skill', null, ['claude-code' as AgentType]);
    expect(warnings).toEqual([]);
  });

  it('returns no warnings when no Agent classifiers', () => {
    const classifiers = parseClassifiers({
      classifiers: ['Domain :: Frontend'],
    });
    const warnings = checkAgentCompatibility('my-skill', classifiers, ['claude-code' as AgentType]);
    expect(warnings).toEqual([]);
  });

  it('returns no warnings for Universal', () => {
    const classifiers = parseClassifiers({
      classifiers: ['Agent :: Universal'],
    });
    const warnings = checkAgentCompatibility('my-skill', classifiers, ['claude-code' as AgentType]);
    expect(warnings).toEqual([]);
  });

  it('returns no warnings when target agent matches', () => {
    const classifiers = parseClassifiers({
      classifiers: ['Agent :: Claude Code'],
    });
    const warnings = checkAgentCompatibility('my-skill', classifiers, ['claude-code' as AgentType]);
    expect(warnings).toEqual([]);
  });

  it('warns when target agent does not match', () => {
    const classifiers = parseClassifiers({
      classifiers: ['Agent :: Cursor'],
    });
    const warnings = checkAgentCompatibility('my-skill', classifiers, ['claude-code' as AgentType]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.targetAgent).toBe('Claude Code');
    expect(warnings[0]!.declaredAgents).toEqual(['Cursor']);
    expect(warnings[0]!.message).toContain('Cursor');
    expect(warnings[0]!.message).toContain('Claude Code');
  });

  it('warns for each incompatible target agent', () => {
    const classifiers = parseClassifiers({
      classifiers: ['Agent :: Cursor'],
    });
    const warnings = checkAgentCompatibility('my-skill', classifiers, [
      'claude-code' as AgentType,
      'cursor' as AgentType,
    ]);
    // Should warn about Claude Code but not Cursor
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.targetAgent).toBe('Claude Code');
  });

  it('handles multiple declared agents', () => {
    const classifiers = parseClassifiers({
      classifiers: ['Agent :: Claude Code', 'Agent :: Cursor'],
    });
    const warnings = checkAgentCompatibility('my-skill', classifiers, ['claude-code' as AgentType]);
    expect(warnings).toEqual([]);
  });
});
