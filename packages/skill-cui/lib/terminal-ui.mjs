import * as readline from 'node:readline';
import { stripVTControlCharacters } from 'node:util';
import { Writable } from 'node:stream';

const silentOutput = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
const CSI = '\x1b[';
const sgr = (code) => `${CSI}${code}m`;
const reset = sgr(0);
const color = (text, code) => (!process.stdout.isTTY || process.env.NO_COLOR ? text : `${code}${text}${reset}`);
const bold = (text) => color(text, sgr(1));
const dim = (text) => color(text, sgr(2));
const cyan = (text) => color(text, sgr(36));
const green = (text) => color(text, sgr(32));
const red = (text) => color(text, sgr(31));
const gray = (text) => color(text, sgr(90));
const blue = (text) => color(text, sgr(34));

export const colors = { bold, dim, cyan, green, red, gray, blue };

function visibleLength(text) {
  return stripVTControlCharacters(text).length;
}

function truncateVisible(value, maxWidth) {
  if (visibleLength(value) <= maxWidth) return value;
  const plain = stripVTControlCharacters(value);
  if (maxWidth <= 1) return plain.slice(0, Math.max(0, maxWidth));
  return `${plain.slice(0, maxWidth - 1)}…`;
}

export function renderBox(title, body) {
  const terminalColumns = process.stdout.columns && process.stdout.columns > 0 ? process.stdout.columns : 80;
  const maxWidth = Math.max(20, terminalColumns - 2);
  const lines = body.split('\n');
  const titleText = ` ${truncateVisible(title, Math.max(1, maxWidth - 2))} `;
  const desiredWidth = Math.max(titleText.length, ...lines.map(visibleLength), 20);
  const width = Math.min(maxWidth, desiredWidth);
  const top = `╭${titleText}${'─'.repeat(Math.max(0, width - titleText.length))}╮`;
  const bottom = `╰${'─'.repeat(width)}╯`;
  const content = lines.map((line) => {
    const rendered = truncateVisible(line, width);
    return `│${rendered}${' '.repeat(Math.max(0, width - visibleLength(rendered)))}│`;
  });
  return [top, ...content, bottom].join('\n');
}

function setupRawInput(onKeypress) {
  const rl = readline.createInterface({ input: process.stdin, output: silentOutput, terminal: false });
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

export async function inputPrompt({ message, defaultValue = '' }) {
  return new Promise((resolve, reject) => {
    let value = '';
    const draw = () => process.stdout.write(`\r\x1b[2K${green('?')} ${bold(`${message} `)}${cyan(value || (defaultValue ? dim(`(${defaultValue})`) : ''))}`);
    const cleanup = setupRawInput((str, key) => {
      if (!key) return;
      if (key.name === 'escape' || (key.ctrl && key.name === 'c')) {
        process.stdout.write('\r\x1b[2K'); cleanup(); reject(new Error('Cancelled')); return;
      }
      if (key.name === 'return') {
        const finalValue = value || defaultValue;
        process.stdout.write(`\r\x1b[2K${green('✔')} ${bold(`${message} `)}${cyan(finalValue)}\n`);
        cleanup(); resolve(finalValue); return;
      }
      if (key.name === 'backspace') { value = value.slice(0, -1); draw(); return; }
      if (str && !key.ctrl && !key.meta && str.length === 1 && str >= ' ') { value += str; draw(); }
    });
    draw();
  });
}

export async function confirmPrompt({ message, defaultValue = false }) {
  return new Promise((resolve, reject) => {
    let value = defaultValue;
    const draw = () => process.stdout.write(`\r\x1b[2K${green('?')} ${bold(`${message} `)}${value ? cyan(bold('Yes')) : gray('Yes')} ${gray('/')} ${!value ? cyan(bold('No')) : gray('No')}`);
    const cleanup = setupRawInput((_str, key) => {
      if (!key) return;
      if (key.name === 'escape' || (key.ctrl && key.name === 'c')) {
        process.stdout.write('\r\x1b[2K'); cleanup(); reject(new Error('Cancelled')); return;
      }
      if (key.name === 'return') {
        process.stdout.write(`\r\x1b[2K${green('✔')} ${bold(`${message} `)}${value ? green('Yes') : red('No')}\n`);
        cleanup(); resolve(value); return;
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

function getVisibleWindow(total, selectedIndex, maxVisible) {
  const visible = Math.max(1, Math.min(total, maxVisible));
  const start = Math.max(0, Math.min(selectedIndex - Math.floor(visible / 2), total - visible));
  return { start, end: Math.min(total, start + visible) };
}

class Renderer {
  lastLineCount = 0;
  render(lines) {
    this.clear();
    process.stdout.write(lines.join('\n') + '\n');
    this.lastLineCount = lines.length;
  }
  clear() {
    if (this.lastLineCount <= 0) return;
    process.stdout.write(`\x1b[${this.lastLineCount}A`);
    for (let i = 0; i < this.lastLineCount; i++) process.stdout.write('\x1b[2K\x1b[1B');
    process.stdout.write(`\x1b[${this.lastLineCount}A`);
    this.lastLineCount = 0;
  }
}

function buildSelectLines({ message, options, selectedIndex, maxVisible = 10 }) {
  const { start, end } = getVisibleWindow(options.length, selectedIndex, maxVisible);
  const lines = [`${green('?')} ${bold(message)}`];
  if (start > 0) lines.push(dim(`  ↑ ${start} more`));
  for (let index = start; index < end; index++) {
    const option = options[index];
    const active = index === selectedIndex;
    const desc = option.description ? dim(` — ${option.description}`) : '';
    const label = `${option.label}${desc}`;
    lines.push(` ${active ? cyan('❯') : ' '} ${active ? cyan(bold(label)) : label}`);
  }
  if (end < options.length) lines.push(dim(`  ↓ ${options.length - end} more`));
  lines.push(dim('  ↑↓/j/k move, Enter select, Esc cancel'));
  return lines;
}

function nextEnabledIndex(options, selectedIndex, direction) {
  if (options.length === 0) return 0;
  let next = selectedIndex;
  for (let i = 0; i < options.length; i++) {
    next = (next + direction + options.length) % options.length;
    if (!options[next]?.disabled) return next;
  }
  return selectedIndex;
}

export async function selectPrompt({ message, options, initialIndex = 0, maxVisible = 10 }) {
  if (options.length === 0) throw new Error('No options available');
  return new Promise((resolve, reject) => {
    let selectedIndex = Math.min(Math.max(0, initialIndex), options.length - 1);
    if (options[selectedIndex]?.disabled) selectedIndex = nextEnabledIndex(options, selectedIndex, 1);
    const renderer = new Renderer();
    const draw = () => renderer.render(buildSelectLines({ message, options, selectedIndex, maxVisible }));
    const cleanup = setupRawInput((_str, key) => {
      if (!key) return;
      if (key.name === 'escape' || (key.ctrl && key.name === 'c')) { renderer.clear(); cleanup(); reject(new Error('Cancelled')); return; }
      if (key.name === 'return') { const option = options[selectedIndex]; if (!option || option.disabled) return; renderer.clear(); cleanup(); resolve(option.value); return; }
      if (key.name === 'up' || key.name === 'k') { selectedIndex = nextEnabledIndex(options, selectedIndex, -1); draw(); return; }
      if (key.name === 'down' || key.name === 'j') { selectedIndex = nextEnabledIndex(options, selectedIndex, 1); draw(); }
    });
    draw();
  });
}
