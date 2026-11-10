import pc from 'picocolors';

/**
 * The single place that decides whether the CLI emits terminal escape codes.
 *
 * Color follows picocolors (already used by `add`, `remove`, `sync` and clack),
 * so every command agrees: `NO_COLOR` / `--no-color` disable it; `FORCE_COLOR` /
 * `--color` / `CI` enable it; otherwise stdout must be a TTY with `TERM != dumb`.
 *
 * Cursor/line control is separate: it only makes sense on a real terminal, so
 * it stays off in pipes even when color is forced.
 *
 * Do not write raw `\x1b[` literals elsewhere; add them here instead
 * (enforced by color.test.ts).
 */
export const colorEnabled = pc.isColorSupported;
const isTTY = process.stdout.isTTY === true;

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
