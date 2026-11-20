import { createColors } from 'picocolors';

/**
 * The single place that decides whether the CLI emits terminal escape codes.
 *
 * - `NO_COLOR` / `--no-color` disable color (https://no-color.org).
 * - `FORCE_COLOR` / `--color` / `CI` enable it.
 * - Otherwise stdout must be a TTY with `TERM != dumb`.
 *
 * This is picocolors' rule minus its "always on for win32" shortcut, which
 * would leak escapes into pipes on Windows. Import `pc` from here instead of
 * `picocolors` so every command follows it.
 *
 * Cursor/line control is separate: it only makes sense on a real terminal, so
 * it stays off in pipes even when color is forced.
 *
 * Do not write raw `\x1b[` literals elsewhere; add them here instead
 * (enforced by color.test.ts).
 */
const env = process.env;
const argv = process.argv;
const isTTY = process.stdout.isTTY === true;

export const colorEnabled =
  !(env.NO_COLOR || argv.includes('--no-color')) &&
  !!(env.FORCE_COLOR || argv.includes('--color') || env.CI || (isTTY && env.TERM !== 'dumb'));

export const pc = createColors(colorEnabled);

const sgr = (code: string): string => (colorEnabled ? `\x1b[${code}m` : '');

export const RESET = sgr('0');
export const BOLD = sgr('1');
// 256-color grays - visible on both light and dark backgrounds
export const DIM = sgr('38;5;102'); // darker gray for secondary text
export const TEXT = sgr('38;5;145'); // lighter gray for primary text
export const CYAN = sgr('36');
export const YELLOW = sgr('33');

// 256-color middle grays (lighter → darker) for the logo gradient
export const GRAYS = [250, 248, 245, 243, 240, 238].map((n) => sgr(`38;5;${n}`));

/** Returns the cursor to column 0 and erases the line; empty when not a TTY. */
export const CLEAR_LINE = isTTY ? '\r\x1b[K' : '';
