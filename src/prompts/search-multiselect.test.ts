import { afterEach, describe, expect, it, vi } from 'vitest';
import { searchMultiselect } from './search-multiselect.ts';

afterEach(() => vi.restoreAllMocks());

describe('searchMultiselect keyboard navigation', () => {
  it.each([true, false])(
    'supports Ctrl+P/Ctrl+N with searchable=%s and clamps at list boundaries',
    async (searchable) => {
      vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
      const prompt = searchMultiselect({
        message: 'Select skills',
        items: ['one', 'two', 'three'].map((value) => ({ value, label: value })),
        searchable,
      });

      try {
        process.stdin.emit('keypress', '\x10', { name: 'p', ctrl: true });
        process.stdin.emit('keypress', ' ', { name: 'space' });
        for (let i = 0; i < 3; i++) {
          process.stdin.emit('keypress', '\x0e', { name: 'n', ctrl: true });
        }
        process.stdin.emit('keypress', ' ', { name: 'space' });
        process.stdin.emit('keypress', '\x10', { name: 'p', ctrl: true });
        process.stdin.emit('keypress', ' ', { name: 'space' });
        process.stdin.emit('keypress', '\r', { name: 'return' });

        await expect(prompt).resolves.toEqual(['one', 'three', 'two']);
      } finally {
        process.stdin.emit('keypress', '', { name: 'escape' });
        await prompt;
      }
    }
  );

  it('keeps plain p and n available for filtering', async () => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const prompt = searchMultiselect({
      message: 'Select skills',
      items: ['other', 'pn-skill'].map((value) => ({ value, label: value })),
    });

    try {
      for (const name of ['p', 'n']) {
        process.stdin.emit('keypress', name, { name, sequence: name });
      }
      process.stdin.emit('keypress', ' ', { name: 'space' });
      process.stdin.emit('keypress', '\r', { name: 'return' });

      await expect(prompt).resolves.toEqual(['pn-skill']);
    } finally {
      process.stdin.emit('keypress', '', { name: 'escape' });
      await prompt;
    }
  });
});
