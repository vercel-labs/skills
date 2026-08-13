import { describe, expect, it, vi, type MockInstance } from 'vitest';
import { stripVTControlCharacters } from 'node:util';
import {
  cancelSymbol,
  countVisualRowsForLines,
  searchMultiselect,
} from '../src/prompts/search-multiselect.ts';

/**
 * rows/columns are read at render time, so stubbing the properties on
 * process.stdout is enough to simulate a terminal size. Returns a restore
 * function; call it in finally so parallel tests never leak dimensions.
 */
function stubDimension(name: 'rows' | 'columns', value: number): () => void {
  const original = Object.getOwnPropertyDescriptor(process.stdout, name);
  Object.defineProperty(process.stdout, name, { value, configurable: true });
  return () => {
    if (original) {
      Object.defineProperty(process.stdout, name, original);
    } else {
      delete (process.stdout as unknown as Record<string, unknown>)[name];
    }
  };
}

/** Strip the fused erase prefix and trailing newline from the latest write. */
function lastFrameLines(write: MockInstance): string[] {
  const raw = String(write.mock.calls.at(-1)?.[0] ?? '');
  return raw
    .replace(/^\x1b\[\d+A\x1b\[J/, '')
    .replace(/\n$/, '')
    .split('\n');
}

function keypress(name: string): void {
  process.stdin.emit('keypress', '', { name });
}

const groupedItems = Array.from({ length: 40 }, (_, i) => ({
  value: `skill-${i}`,
  label: `skill-${i}`,
  group: `Plugin ${Math.floor(i / 8)}`,
  detail: `Description for skill ${i}.`,
}));

const flatItems = Array.from({ length: 40 }, (_, i) => ({
  value: `item-${i}`,
  label: `item-${i}`,
}));

// Mirrors the grouped skill-selection prompt in add.ts, the repro in #925.
const groupedOptions = {
  message: 'Select skills',
  items: groupedItems,
  maxVisible: 20,
  searchable: false,
  showDetail: true,
  showSelectedSummary: false,
  selectGroups: true,
};

describe('searchMultiselect viewport sizing', () => {
  it('keeps the frame inside a short viewport while navigating', async () => {
    const restoreRows = stubDimension('rows', 15);
    const restoreColumns = stubDimension('columns', 80);
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    try {
      const prompt = searchMultiselect(groupedOptions);

      // The trailing newline consumes one extra row, so the frame itself must
      // stay within rows - 1 or the erase sequence cannot reach its first row.
      expect(countVisualRowsForLines(lastFrameLines(write), 80)).toBeLessThanOrEqual(14);

      for (let i = 0; i < 12; i++) keypress('down');
      expect(countVisualRowsForLines(lastFrameLines(write), 80)).toBeLessThanOrEqual(14);

      for (let i = 0; i < 12; i++) keypress('up');
      keypress('left');
      expect(countVisualRowsForLines(lastFrameLines(write), 80)).toBeLessThanOrEqual(14);
      keypress('right');
      expect(countVisualRowsForLines(lastFrameLines(write), 80)).toBeLessThanOrEqual(14);

      keypress('escape');
      await expect(prompt).resolves.toBe(cancelSymbol);
    } finally {
      write.mockRestore();
      restoreRows();
      restoreColumns();
    }
  });

  it('still redraws in one terminal write when the window is clamped', async () => {
    const restoreRows = stubDimension('rows', 15);
    const restoreColumns = stubDimension('columns', 80);
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    try {
      const prompt = searchMultiselect(groupedOptions);

      write.mockClear();
      keypress('down');
      expect(write).toHaveBeenCalledTimes(1);

      keypress('escape');
      await expect(prompt).resolves.toBe(cancelSymbol);
    } finally {
      write.mockRestore();
      restoreRows();
      restoreColumns();
    }
  });

  it('reports consistent hidden counts around the clamped window', async () => {
    const restoreRows = stubDimension('rows', 15);
    const restoreColumns = stubDimension('columns', 80);
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    try {
      const prompt = searchMultiselect({ message: 'Select items', items: flatItems });

      const countsFor = (lines: string[]): { visible: number; hidden: number } => {
        const plain = lines.map((line) => stripVTControlCharacters(line));
        const visible = plain.filter((line) => /[○●]/.test(line)).length;
        let hidden = 0;
        for (const line of plain) {
          const before = line.match(/↑ (\d+) more/);
          const after = line.match(/↓ (\d+) more/);
          if (before) hidden += Number(before[1]);
          if (after) hidden += Number(after[1]);
        }
        return { visible, hidden };
      };

      const initial = countsFor(lastFrameLines(write));
      expect(initial.visible).toBeGreaterThan(0);
      expect(initial.visible + initial.hidden).toBe(flatItems.length);

      for (let i = 0; i < 10; i++) keypress('down');
      const scrolled = countsFor(lastFrameLines(write));
      expect(scrolled.visible + scrolled.hidden).toBe(flatItems.length);

      keypress('escape');
      await expect(prompt).resolves.toBe(cancelSymbol);
    } finally {
      write.mockRestore();
      restoreRows();
      restoreColumns();
    }
  });

  it('keeps maxVisible as the window size on tall terminals', async () => {
    const restoreRows = stubDimension('rows', 60);
    const restoreColumns = stubDimension('columns', 80);
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    try {
      const prompt = searchMultiselect({
        message: 'Select items',
        items: flatItems.slice(0, 10),
        maxVisible: 8,
      });

      const plain = lastFrameLines(write).map((line) => stripVTControlCharacters(line));
      expect(plain.filter((line) => /[○●]/.test(line))).toHaveLength(8);
      expect(plain.some((line) => line.includes('↓ 2 more'))).toBe(true);

      keypress('escape');
      await expect(prompt).resolves.toBe(cancelSymbol);
    } finally {
      write.mockRestore();
      restoreRows();
      restoreColumns();
    }
  });

  it('drops the detail pane before overflowing a tiny viewport', async () => {
    const restoreRows = stubDimension('rows', 10);
    const restoreColumns = stubDimension('columns', 80);
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    try {
      const prompt = searchMultiselect(groupedOptions);

      const lines = lastFrameLines(write);
      const plain = lines.map((line) => stripVTControlCharacters(line));
      expect(plain.some((line) => line.includes('Description'))).toBe(false);
      expect(countVisualRowsForLines(lines, 80)).toBeLessThanOrEqual(9);

      keypress('escape');
      await expect(prompt).resolves.toBe(cancelSymbol);
    } finally {
      write.mockRestore();
      restoreRows();
      restoreColumns();
    }
  });

  it('clamps the erase distance after the viewport shrinks', async () => {
    const restoreColumns = stubDimension('columns', 80);
    let restoreRows = stubDimension('rows', 50);
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    try {
      const prompt = searchMultiselect({
        message: 'Select items',
        items: flatItems,
        maxVisible: 20,
      });

      // The tall frame was rendered at 50 rows; shrink the terminal before the
      // next redraw and the erase must not ask for more rows than the viewport.
      restoreRows();
      restoreRows = stubDimension('rows', 15);

      write.mockClear();
      keypress('down');
      const raw = String(write.mock.calls.at(-1)?.[0] ?? '');
      const cursorUp = raw.match(/^\x1b\[(\d+)A/);
      expect(cursorUp).not.toBeNull();
      expect(Number(cursorUp![1])).toBeLessThanOrEqual(14);

      keypress('escape');
      await expect(prompt).resolves.toBe(cancelSymbol);
    } finally {
      write.mockRestore();
      restoreRows();
      restoreColumns();
    }
  });
});
