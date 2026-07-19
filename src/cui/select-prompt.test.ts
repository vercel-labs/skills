import { describe, expect, it } from 'vitest';
import {
  buildSelectLines,
  countSelectRenderRows,
  getVisibleWindow,
  truncateToWidth,
} from './select-prompt.ts';

describe('CUI select prompt helpers', () => {
  it('keeps visible windows bounded around the cursor', () => {
    expect(getVisibleWindow(20, 0, 5)).toEqual({ start: 0, end: 5 });
    expect(getVisibleWindow(20, 10, 5)).toEqual({ start: 8, end: 13 });
    expect(getVisibleWindow(20, 19, 5)).toEqual({ start: 15, end: 20 });
  });

  it('counts wrapped physical rows for clearing', () => {
    const lines = buildSelectLines({
      message: 'Pick one',
      selectedIndex: 0,
      columns: 30,
      options: [
        {
          label: 'a'.repeat(80),
          value: 'long',
          description: 'b'.repeat(80),
        },
      ],
    });

    expect(countSelectRenderRows(lines, 30)).toBeGreaterThan(lines.length);
  });

  it('renders multi-select state with selected count', () => {
    const lines = buildSelectLines({
      message: 'Pick many',
      selectedIndex: 1,
      selectedValues: new Set(['two']),
      options: [
        { label: 'One', value: 'one' },
        { label: 'Two', value: 'two' },
      ],
    });

    expect(lines.join('\n')).toContain('[x]');
    expect(lines.join('\n')).toContain('Selected: 1');
  });

  it('truncates long text with an ellipsis', () => {
    expect(truncateToWidth('abcdefghij', 6)).toBe('abcde…');
  });
});
