import { describe, expect, it } from 'vitest';
import { PassThrough } from 'node:stream';
import { select, multiselect, confirm } from '@clack/prompts';
import { configurePromptKeybindings } from './keybindings.ts';

const options = [
  { value: 'project', label: 'Project' },
  { value: 'global', label: 'Global' },
];

describe('prompt keybindings', () => {
  it.each([
    ['Ctrl+N', '\x0e', 'project', 'global'],
    ['Ctrl+P', '\x10', 'global', 'project'],
    ['down arrow', '\x1b[B', 'project', 'global'],
    ['up arrow', '\x1b[A', 'global', 'project'],
  ])('navigates Clack selects with %s', async (_label, key, initialValue, expected) => {
    const input = new PassThrough();
    const output = new PassThrough();
    const cleanup = configurePromptKeybindings(input);
    try {
      const result = select({
        message: 'Installation scope',
        options,
        initialValue,
        input,
        output,
      });
      input.write(key);
      input.write('\r');
      await expect(result).resolves.toBe(expected);
    } finally {
      cleanup();
      input.destroy();
      output.destroy();
    }
  });

  it('supports successive multiselect and confirmation prompts', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const cleanup = configurePromptKeybindings(input);
    try {
      const selected = multiselect({ message: 'Select skills', options, input, output });
      input.write('\x0e');
      input.write(' ');
      input.write('\x10');
      input.write(' ');
      input.write('\r');
      await expect(selected).resolves.toEqual(['global', 'project']);

      for (const key of ['\x0e', '\x10']) {
        const confirmed = confirm({ message: 'Proceed?', initialValue: true, input, output });
        input.write(key);
        input.write('\r');
        await expect(confirmed).resolves.toBe(false);
      }

      for (const [key, expected] of [
        ['n', false],
        ['y', true],
      ] as const) {
        const confirmed = confirm({ message: 'Proceed?', initialValue: !expected, input, output });
        input.write(key);
        await expect(confirmed).resolves.toBe(expected);
      }
    } finally {
      cleanup();
      input.destroy();
      output.destroy();
    }
  });
});
