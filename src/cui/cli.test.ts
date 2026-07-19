import { describe, expect, it } from 'vitest';
import { parseCuiOptions } from './cli.ts';

describe('parseCuiOptions', () => {
  it('extracts no-confirmation and leaves positional CUI arguments', () => {
    expect(parseCuiOptions(['--no-confirmation', 'Exit'])).toEqual({
      options: { skipConfirmation: true },
      rest: ['Exit'],
    });
  });

  it('keeps confirmation prompts enabled by default', () => {
    expect(parseCuiOptions(['List project skills'])).toEqual({
      options: { skipConfirmation: false },
      rest: ['List project skills'],
    });
  });
});
