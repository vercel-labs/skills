import { describe, expect, it, vi } from 'vitest';
import { stripVTControlCharacters } from 'node:util';
import { cancelSymbol, searchMultiselect } from '../src/prompts/search-multiselect.ts';

describe('searchMultiselect rendering', () => {
  it('redraws the prompt in one terminal write after navigation', async () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    const prompt = searchMultiselect({
      message: 'Select skills',
      items: [
        { value: 'one', label: 'one' },
        { value: 'two', label: 'two' },
      ],
    });

    write.mockClear();
    process.stdin.emit('keypress', '', { name: 'down' });

    expect(write).toHaveBeenCalledTimes(1);

    process.stdin.emit('keypress', '', { name: 'escape' });
    await expect(prompt).resolves.toBe(cancelSymbol);
    write.mockRestore();
  });

  it('renders Select All separately and updates it as skill selection changes', async () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    const prompt = searchMultiselect({
      message: 'Select skills',
      items: [
        { value: 'one', label: 'one' },
        { value: 'two', label: 'two' },
      ],
      selectAll: true,
      required: true,
    });

    const initial = stripVTControlCharacters(String(write.mock.calls.at(-1)?.[0]));
    expect(initial).toContain('Select All (0/2)');
    expect(initial).toMatch(/Select All \(0\/2\)\n│\s+─+/);

    process.stdin.emit('keypress', '', { name: 'space' });
    const allSelected = stripVTControlCharacters(String(write.mock.calls.at(-1)?.[0]));
    expect(allSelected).toContain('Select All (2/2)');

    process.stdin.emit('keypress', '', { name: 'down' });
    process.stdin.emit('keypress', '', { name: 'space' });
    const partiallySelected = stripVTControlCharacters(String(write.mock.calls.at(-1)?.[0]));
    expect(partiallySelected).toContain('Select All (1/2)');

    process.stdin.emit('keypress', '', { name: 'escape' });
    await expect(prompt).resolves.toBe(cancelSymbol);
    write.mockRestore();
  });

  it('keeps the full prompt inside a short terminal viewport', async () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const originalRows = Object.getOwnPropertyDescriptor(process.stdout, 'rows');
    const originalColumns = Object.getOwnPropertyDescriptor(process.stdout, 'columns');
    Object.defineProperty(process.stdout, 'rows', { configurable: true, value: 12 });
    Object.defineProperty(process.stdout, 'columns', { configurable: true, value: 80 });

    const prompt = searchMultiselect({
      message: 'Select skills',
      items: Array.from({ length: 20 }, (_, index) => ({
        value: `skill-${index + 1}`,
        label: `skill-${index + 1}`,
        group: 'Example Skills',
        detail: `Description for skill ${index + 1}`,
      })),
      selectAll: true,
      selectGroups: true,
      searchable: false,
      showDetail: true,
      showSelectedSummary: false,
      maxVisible: 20,
    });

    const initial = stripVTControlCharacters(String(write.mock.calls.at(-1)?.[0]));
    expect(initial).toContain('Select All (0/20)');
    expect(initial).toContain('↓');
    expect(initial).not.toContain('Description');
    expect(initial.trimEnd().split('\n')).toHaveLength(11);

    process.stdin.emit('keypress', '', { name: 'escape' });
    await expect(prompt).resolves.toBe(cancelSymbol);
    write.mockRestore();
    if (originalRows) {
      Object.defineProperty(process.stdout, 'rows', originalRows);
    } else {
      delete (process.stdout as { rows?: number }).rows;
    }
    if (originalColumns) {
      Object.defineProperty(process.stdout, 'columns', originalColumns);
    } else {
      delete (process.stdout as { columns?: number }).columns;
    }
  });
});
