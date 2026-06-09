import { describe, expect, it } from 'vitest';
import pc from 'picocolors';
import {
  approxStringWidth,
  countVisualRowsForLines,
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
});
