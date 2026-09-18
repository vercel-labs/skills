import type { Key } from 'node:readline';
import type { Readable } from 'node:stream';

/** Normalize navigation before any prompt handles input, including Clack prompts. */
export function configurePromptKeybindings(input: Readable = process.stdin): () => void {
  const normalize = (_text: string | undefined, key: Key | undefined): void => {
    if (!key?.ctrl || (key.name !== 'n' && key.name !== 'p')) return;

    // Clack's aliases only match key names, so they cannot distinguish Ctrl+N
    // from plain n, which must remain available for search and yes/no answers.
    const down = key.name === 'n';
    key.name = down ? 'down' : 'up';
    key.sequence = down ? '\x1b[B' : '\x1b[A';
    key.ctrl = false;
  };

  input.prependListener('keypress', normalize);
  return () => input.removeListener('keypress', normalize);
}
