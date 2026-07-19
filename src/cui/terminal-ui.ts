import * as readline from 'readline';
import { Writable } from 'stream';
import pc from 'picocolors';

const silentOutput = new Writable({
  write(_chunk, _encoding, callback) {
    callback();
  },
});

export const colors = {
  cyan: pc.cyan,
  blue: pc.blue,
  gray: pc.gray,
  green: pc.green,
  red: pc.red,
  bold: pc.bold,
};

export function color(text: string, formatter: (value: string) => string): string {
  if (!process.stdout.isTTY || process.env.NO_COLOR) return text;
  return formatter(text);
}

export function renderBox(title: string, body: string): string {
  const terminalColumns =
    process.stdout.columns && process.stdout.columns > 0 ? process.stdout.columns : 80;
  const maxWidth = Math.max(20, terminalColumns - 2);
  const lines = body.split('\n');
  const titleText = ` ${truncateVisible(title, Math.max(1, maxWidth - 2))} `;
  const desiredWidth = Math.max(titleText.length, ...lines.map((line) => visibleLength(line)), 20);
  const width = Math.min(maxWidth, desiredWidth);
  const top = `╭${titleText}${'─'.repeat(Math.max(0, width - titleText.length))}╮`;
  const bottom = `╰${'─'.repeat(width)}╯`;
  const content = lines.map((line) => {
    const rendered = truncateVisible(line, width);
    const padding = Math.max(0, width - visibleLength(rendered));
    return `│${rendered}${' '.repeat(padding)}│`;
  });
  return [top, ...content, bottom].join('\n');
}

function stripAnsi(value: string): string {
  return value.replace(/\x1b\[[0-9;]*m/g, '');
}

function visibleLength(value: string): number {
  return stripAnsi(value).length;
}

function truncateVisible(value: string, maxWidth: number): string {
  if (visibleLength(value) <= maxWidth) return value;
  const plain = stripAnsi(value);
  if (maxWidth <= 1) return plain.slice(0, Math.max(0, maxWidth));
  return `${plain.slice(0, maxWidth - 1)}…`;
}

interface InputConfig {
  message: string;
  defaultValue?: string;
}

interface ConfirmConfig {
  message: string;
  defaultValue?: boolean;
}

function setupRawInput(onKeypress: (str: string, key: readline.Key) => void): () => void {
  const rl = readline.createInterface({
    input: process.stdin,
    output: silentOutput,
    terminal: false,
  });
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  process.stdin.resume();
  readline.emitKeypressEvents(process.stdin, rl);
  process.stdin.on('keypress', onKeypress);
  return () => {
    process.stdin.removeListener('keypress', onKeypress);
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    rl.close();
  };
}

export async function inputPrompt(config: InputConfig): Promise<string> {
  const { message, defaultValue = '' } = config;
  return new Promise<string>((resolve, reject) => {
    let value = '';
    const draw = () => {
      const display = value || (defaultValue ? pc.dim(`(${defaultValue})`) : '');
      process.stdout.write(
        `\r\x1b[2K${pc.green('?')} ${pc.bold(`${message} `)}${pc.cyan(display)}`
      );
    };
    const cleanup = setupRawInput((str, key) => {
      if (!key) return;
      if (key.name === 'escape' || (key.ctrl && key.name === 'c')) {
        process.stdout.write('\r\x1b[2K');
        cleanup();
        reject(new Error('Cancelled'));
        return;
      }
      if (key.name === 'return') {
        const finalValue = value || defaultValue;
        process.stdout.write(
          `\r\x1b[2K${pc.green('✔')} ${pc.bold(`${message} `)}${pc.cyan(finalValue)}\n`
        );
        cleanup();
        resolve(finalValue);
        return;
      }
      if (key.name === 'backspace') {
        value = value.slice(0, -1);
        draw();
        return;
      }
      if (str && !key.ctrl && !key.meta && str.length === 1 && str >= ' ') {
        value += str;
        draw();
      }
    });
    draw();
  });
}

export async function confirmPrompt(config: ConfirmConfig): Promise<boolean> {
  const { message, defaultValue = false } = config;
  return new Promise<boolean>((resolve, reject) => {
    let value = defaultValue;
    const draw = () => {
      const yes = value ? pc.cyan(pc.bold('Yes')) : pc.gray('Yes');
      const no = !value ? pc.cyan(pc.bold('No')) : pc.gray('No');
      process.stdout.write(
        `\r\x1b[2K${pc.green('?')} ${pc.bold(`${message} `)}${yes} ${pc.gray('/')} ${no}`
      );
    };
    const cleanup = setupRawInput((_str, key) => {
      if (!key) return;
      if (key.name === 'escape' || (key.ctrl && key.name === 'c')) {
        process.stdout.write('\r\x1b[2K');
        cleanup();
        reject(new Error('Cancelled'));
        return;
      }
      if (key.name === 'return') {
        process.stdout.write(
          `\r\x1b[2K${pc.green('✔')} ${pc.bold(`${message} `)}${value ? pc.green('Yes') : pc.red('No')}\n`
        );
        cleanup();
        resolve(value);
        return;
      }
      if (key.name === 'y') value = true;
      else if (key.name === 'n') value = false;
      else if (['left', 'right', 'tab', 'up', 'down'].includes(key.name ?? '')) value = !value;
      else return;
      draw();
    });
    draw();
  });
}
