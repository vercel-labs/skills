import { describe, it, expect } from 'vitest';
import { parseRemoveOptions } from './remove.ts';

describe('parseRemoveOptions', () => {
  it('parses positional skill names', () => {
    const result = parseRemoveOptions(['skill-one', 'skill-two', '-y']);
    expect(result.skills).toEqual(['skill-one', 'skill-two']);
    expect(result.options.yes).toBe(true);
  });

  it('parses -s/--skill names (documented remove flag)', () => {
    const result = parseRemoveOptions(['--skill', 'skill-one', 'skill-two', '-g']);
    expect(result.skills).toEqual(['skill-one', 'skill-two']);
    expect(result.options.global).toBe(true);
  });

  it('does not treat --skill as an unknown token that drops the following name', () => {
    // Regression: --skill was previously ignored, so
    // `remove --skill foo --all` still collected `foo` as a positional name
    // while --all wiped every skill.
    const result = parseRemoveOptions(['--skill', 'agent-thread-visualizer', '--all', '-y']);
    expect(result.skills).toEqual(['agent-thread-visualizer']);
    expect(result.options.all).toBe(true);
    expect(result.options.yes).toBe(true);
  });

  it('sets yes when --all is used', () => {
    const result = parseRemoveOptions(['--all']);
    expect(result.options.all).toBe(true);
    expect(result.options.yes).toBe(true);
  });

  it('parses --skill=<name> and -s=<name> equals syntax', () => {
    const result1 = parseRemoveOptions(['--skill=skill-one', '-y']);
    expect(result1.skills).toEqual(['skill-one']);
    expect(result1.options.yes).toBe(true);

    const result2 = parseRemoveOptions(['-s=skill-one', '-s=skill-two', '-g']);
    expect(result2.skills).toEqual(['skill-one', 'skill-two']);
    expect(result2.options.global).toBe(true);

    const result3 = parseRemoveOptions(['--skill=skill-one,skill-two']);
    expect(result3.skills).toEqual(['skill-one', 'skill-two']);
  });

  it('parses --agent=<agents> and -a=<agents> equals syntax', () => {
    const result1 = parseRemoveOptions(['--skill=skill-one', '--agent=claude-code', '-y']);
    expect(result1.skills).toEqual(['skill-one']);
    expect(result1.options.agent).toEqual(['claude-code']);
    expect(result1.options.yes).toBe(true);

    const result2 = parseRemoveOptions(['skill-one', '-a=cursor,codex']);
    expect(result2.skills).toEqual(['skill-one']);
    expect(result2.options.agent).toEqual(['cursor', 'codex']);
  });
});
