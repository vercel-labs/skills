// Shared ANSI palette for the CLI commands. Escape codes are emitted only when
// they can actually be interpreted: stdout is a TTY (or FORCE_COLOR is set) and
// NO_COLOR is unset — see https://no-color.org. Piped output stays plain text
// so `skills list | less` never renders escape codes as garbage. Semantics
// mirror the picocolors dependency.
const supportsColor =
  !process.env.NO_COLOR &&
  (!!process.env.FORCE_COLOR || (process.stdout.isTTY === true && process.env.TERM !== 'dumb'));

export const RESET = supportsColor ? '\x1b[0m' : '';
export const BOLD = supportsColor ? '\x1b[1m' : '';
// 256-color grays - visible on both light and dark backgrounds
export const DIM = supportsColor ? '\x1b[38;5;102m' : ''; // darker gray for secondary text
export const TEXT = supportsColor ? '\x1b[38;5;145m' : ''; // lighter gray for primary text
export const CYAN = supportsColor ? '\x1b[36m' : '';
export const YELLOW = supportsColor ? '\x1b[33m' : '';

// 256-color middle grays - visible on both light and dark backgrounds
export const GRAYS = [
  '\x1b[38;5;250m', // lighter gray
  '\x1b[38;5;248m',
  '\x1b[38;5;245m', // mid gray
  '\x1b[38;5;243m',
  '\x1b[38;5;240m',
  '\x1b[38;5;238m', // darker gray
].map((code) => (supportsColor ? code : ''));
