import { describe, it, expect } from 'vitest';
import { normalizeArgs } from './arg-normalize.ts';

describe('normalizeArgs', () => {
  it('expands equals syntax while preserving values that contain =', () => {
    expect(
      normalizeArgs(['add', 'repo', '--skill=foo', '-a=claude', '--meta={"k":"a=b"}', '-y'])
    ).toEqual(['add', 'repo', '--skill', 'foo', '-a', 'claude', '--meta', '{"k":"a=b"}', '-y']);
  });

  it('leaves flags without a value and positional args untouched', () => {
    expect(normalizeArgs(['--global', 'vercel-labs/agent-skills', '-y'])).toEqual([
      '--global',
      'vercel-labs/agent-skills',
      '-y',
    ]);
  });

  it('splits only on the first =', () => {
    expect(normalizeArgs(['--filter=a=b'])).toEqual(['--filter', 'a=b']);
  });

  it('handles empty value after =', () => {
    expect(normalizeArgs(['--skill='])).toEqual(['--skill', '']);
  });

  it('leaves boolean flags with an explicit value as-is (known trade-off)', () => {
    // `--global=true` becomes two tokens; the trailing value surfaces as a
    // positional arg. Documented deliberately — the entry point cannot tell
    // value flags from boolean flags without a flag-type table.
    expect(normalizeArgs(['add', 'x', '--global=true'])).toEqual(['add', 'x', '--global', 'true']);
  });
});
