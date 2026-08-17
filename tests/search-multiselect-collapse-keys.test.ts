import { describe, expect, it, vi } from 'vitest';
import { cancelSymbol, searchMultiselect } from '../src/prompts/search-multiselect.ts';

const groupedItems = [
  { value: 'ask-matt', label: 'ask-matt', group: 'Engineering' },
  { value: 'tdd', label: 'tdd', group: 'Engineering' },
  { value: 'kmp-module-setup', label: 'kmp-module-setup', group: 'Team Mobile' },
  { value: 'kmp-test-seams', label: 'kmp-test-seams', group: 'Team Mobile' },
];

const startPrompt = () =>
  searchMultiselect({
    message: 'Select skills',
    items: groupedItems,
    selectGroups: true,
    searchable: true,
  });

const type = (char: string) => process.stdin.emit('keypress', char, { name: char, sequence: char });

const press = (name: string) => process.stdin.emit('keypress', '', { name });

const framesSince = (write: ReturnType<typeof vi.spyOn>) =>
  write.mock.calls.map((call) => String(call[0])).join('\n');

describe('searchMultiselect ←/→ while a query is active', () => {
  it('makes ← a no-op that leaves no collapse behind once the query clears', async () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const prompt = startPrompt();

    // Filter down to one group, then try to collapse while filtering.
    type('k');
    write.mockClear();
    press('left');

    // A genuine no-op renders nothing at all. Before the fix this redrew the
    // frame after writing to the collapse set.
    expect(write).not.toHaveBeenCalled();

    // Clear the query. The group must come back expanded — the ← above must not
    // have recorded a collapse that only becomes visible now.
    write.mockClear();
    press('backspace');

    const frame = framesSince(write);
    expect(frame).toContain('kmp-module-setup');
    expect(frame).toContain('tdd');

    press('escape');
    await expect(prompt).resolves.toBe(cancelSymbol);
    write.mockRestore();
  });

  it('makes → a no-op while filtering', async () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const prompt = startPrompt();

    type('k');
    write.mockClear();
    press('right');

    expect(write).not.toHaveBeenCalled();

    press('escape');
    await expect(prompt).resolves.toBe(cancelSymbol);
    write.mockRestore();
  });

  it('still collapses and expands with ←/→ when no query is active', async () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const prompt = startPrompt();

    // Cursor starts on the first group heading.
    write.mockClear();
    press('left');
    expect(framesSince(write)).not.toContain('ask-matt');

    write.mockClear();
    press('right');
    expect(framesSince(write)).toContain('ask-matt');

    press('escape');
    await expect(prompt).resolves.toBe(cancelSymbol);
    write.mockRestore();
  });
});
