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
});
