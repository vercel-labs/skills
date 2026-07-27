import { describe, expect, it } from 'vitest';
import pc from 'picocolors';
import {
  approxStringWidth,
  buildSearchEntries,
  countVisualRowsForLines,
  formatDetailLines,
  toggleSearchEntry,
  visualRowsForLine,
} from '../src/prompts/search-multiselect.ts';

describe('searchMultiselect visual row counting', () => {
  it('counts ASCII width as one column per character', () => {
    expect(approxStringWidth('abc')).toBe(3);
    expect(approxStringWidth('a'.repeat(160))).toBe(160);
  });

  it('treats common CJK as double-width', () => {
    expect(approxStringWidth('中')).toBe(2);
    expect(approxStringWidth('中文')).toBe(4);
  });

  it('computes wrap rows for long ASCII lines', () => {
    const line = 'x'.repeat(160);
    expect(visualRowsForLine(line, 80)).toBe(2);
    expect(visualRowsForLine(line, 40)).toBe(4);
  });

  it('strips ANSI before measuring so colors do not affect wrap', () => {
    const line = pc.bold('z'.repeat(100));
    expect(visualRowsForLine(line, 80)).toBe(2);
  });

  it('sums logical lines using explicit column width', () => {
    const lines = ['short', 'x'.repeat(160)];
    expect(countVisualRowsForLines(lines, 80)).toBe(1 + 2);
  });

  it('matches prior behavior when each line fits in one row', () => {
    const lines = ['a', 'b', 'c'];
    expect(countVisualRowsForLines(lines, 120)).toBe(3);
  });

  it('reserves a fixed number of detail lines for short descriptions', () => {
    expect(formatDetailLines('One concise description.', 40, 2)).toEqual([
      'One concise description.',
      '',
    ]);
  });

  it('wraps and truncates long descriptions inside the reserved detail pane', () => {
    const lines = formatDetailLines('One two three four five six seven eight nine', 16, 2);

    expect(lines).toHaveLength(2);
    expect(lines[1]).toMatch(/…$/);
    expect(lines.every((line) => approxStringWidth(line) <= 16)).toBe(true);
  });

  it('makes group headings navigable and keeps their member skills together', () => {
    const entries = buildSearchEntries(
      [
        { value: 'review', label: 'code-review', group: 'Mattpocock Skills' },
        { value: 'design', label: 'codebase-design', group: 'Mattpocock Skills' },
        { value: 'qa', label: 'qa', group: 'General' },
      ],
      true
    );

    expect(entries).toEqual([
      {
        type: 'group',
        group: 'Mattpocock Skills',
        collapsed: false,
        items: [
          { value: 'review', label: 'code-review', group: 'Mattpocock Skills' },
          { value: 'design', label: 'codebase-design', group: 'Mattpocock Skills' },
        ],
      },
      { type: 'item', item: { value: 'review', label: 'code-review', group: 'Mattpocock Skills' } },
      {
        type: 'item',
        item: { value: 'design', label: 'codebase-design', group: 'Mattpocock Skills' },
      },
      {
        type: 'group',
        group: 'General',
        collapsed: false,
        items: [{ value: 'qa', label: 'qa', group: 'General' }],
      },
      { type: 'item', item: { value: 'qa', label: 'qa', group: 'General' } },
    ]);
  });

  it('keeps collapsed groups visible while hiding their child skills', () => {
    const entries = buildSearchEntries(
      [
        { value: 'review', label: 'code-review', group: 'Mattpocock Skills' },
        { value: 'design', label: 'codebase-design', group: 'Mattpocock Skills' },
        { value: 'qa', label: 'qa', group: 'General' },
      ],
      true,
      new Set(['Mattpocock Skills'])
    );

    expect(entries).toHaveLength(3);
    expect(entries[0]).toMatchObject({
      type: 'group',
      group: 'Mattpocock Skills',
      collapsed: true,
    });
    expect(entries[1]).toMatchObject({ type: 'group', group: 'General', collapsed: false });
    expect(entries[2]).toMatchObject({ type: 'item', item: { value: 'qa' } });
  });

  it('selects every skill from a group heading, then clears them on the next toggle', () => {
    const entries = buildSearchEntries(
      [
        { value: 'review', label: 'code-review', group: 'Mattpocock Skills' },
        { value: 'design', label: 'codebase-design', group: 'Mattpocock Skills' },
      ],
      true
    );
    const selected = new Set<string>();

    toggleSearchEntry(selected, entries[0]);
    expect(selected).toEqual(new Set(['review', 'design']));

    toggleSearchEntry(selected, entries[0]);
    expect(selected).toEqual(new Set());
  });
});
