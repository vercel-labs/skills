const enabled = !process.env.NO_COLOR && process.env.TERM !== 'dumb';

function wrap(open: string, close: string) {
  return (value: unknown): string => {
    const text = String(value);
    return enabled ? `${open}${text}${close}` : text;
  };
}

const pc = {
  black: wrap('\x1b[30m', '\x1b[39m'),
  red: wrap('\x1b[31m', '\x1b[39m'),
  green: wrap('\x1b[32m', '\x1b[39m'),
  yellow: wrap('\x1b[33m', '\x1b[39m'),
  cyan: wrap('\x1b[36m', '\x1b[39m'),
  white: wrap('\x1b[97m', '\x1b[39m'),
  bold: wrap('\x1b[1m', '\x1b[22m'),
  dim: wrap('\x1b[2m', '\x1b[22m'),
  inverse: wrap('\x1b[7m', '\x1b[27m'),
  underline: wrap('\x1b[4m', '\x1b[24m'),
  strikethrough: wrap('\x1b[9m', '\x1b[29m'),
  bgRed: wrap('\x1b[41m', '\x1b[49m'),
  bgCyan: wrap('\x1b[46m', '\x1b[49m'),
};

export default pc;
