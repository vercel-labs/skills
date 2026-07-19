import { stripVTControlCharacters } from 'node:util';
import { describe, expect, it } from 'vitest';
import { renderBox } from './terminal-ui.ts';

describe('terminal UI helpers', () => {
  it('bounds box output to terminal width to avoid wrapped header redraw noise', () => {
    const originalColumns = process.stdout.columns;
    process.stdout.columns = 40;

    try {
      const box = renderBox('A very long title that should truncate', 'x'.repeat(120));
      for (const line of box.split('\n')) {
        expect(stripVTControlCharacters(line).length).toBeLessThanOrEqual(40);
      }
      expect(box).toContain('…');
    } finally {
      process.stdout.columns = originalColumns;
    }
  });
});
