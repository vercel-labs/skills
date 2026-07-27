import { describe, expect, it, vi } from 'vitest';
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
});
