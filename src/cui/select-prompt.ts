import * as readline from 'readline';
import { stripVTControlCharacters } from 'node:util';
import { Writable } from 'stream';
import pc from 'picocolors';
import {
  approxStringWidth,
  countVisualRowsForLines,
  visualRowsForLine,
} from '../prompts/search-multiselect.ts';

const silentOutput = new Writable({
  write(_chunk, _encoding, callback) {
    callback();
  },
});

export interface CuiSelectOption<T> {
  label: string;
  value: T;
  description?: string;
  disabled?: boolean;
}

export interface CuiSelectConfig<T> {
  message: string;
  options: CuiSelectOption<T>[];
  initialIndex?: number;
  maxVisible?: number;
  hint?: string;
}

export interface CuiMultiSelectConfig<T> extends CuiSelectConfig<T> {
  initialSelected?: T[];
}

export type CuiMultiSelectResult<T> =
  { type: 'single'; value: T } | { type: 'selected'; values: T[] };

export interface VisibleWindow {
  start: number;
  end: number;
}

export function getVisibleWindow(
  total: number,
  selectedIndex: number,
  maxVisible: number
): VisibleWindow {
  const visible = Math.max(1, Math.min(total, maxVisible));
  const start = Math.max(0, Math.min(selectedIndex - Math.floor(visible / 2), total - visible));
  return { start, end: Math.min(total, start + visible) };
}

export function truncateToWidth(text: string, maxWidth: number): string {
  const plain = stripVTControlCharacters(text);
  if (maxWidth <= 0) return '';
  if (approxStringWidth(plain) <= maxWidth) return text;

  const ellipsis = '…';
  const target = Math.max(1, maxWidth - approxStringWidth(ellipsis));
  let width = 0;
  let result = '';
  for (const ch of plain) {
    const chWidth = approxStringWidth(ch);
    if (width + chWidth > target) break;
    result += ch;
    width += chWidth;
  }
  return `${result}${ellipsis}`;
}

function optionText<T>(option: CuiSelectOption<T>, columns: number): string {
  const description = option.description ? ` — ${option.description}` : '';
  return truncateToWidth(`${option.label}${description}`, Math.max(10, columns - 8));
}

export function buildSelectLines<T>(config: {
  message: string;
  options: CuiSelectOption<T>[];
  selectedIndex: number;
  maxVisible?: number;
  selectedValues?: Set<T>;
  columns?: number;
  hint?: string;
}): string[] {
  const {
    message,
    options,
    selectedIndex,
    maxVisible = 10,
    selectedValues,
    columns = process.stdout.columns || 80,
    hint,
  } = config;
  const lines: string[] = [];
  const { start, end } = getVisibleWindow(options.length, selectedIndex, maxVisible);
  const isMulti = selectedValues !== undefined;

  lines.push(`${pc.green('?')} ${pc.bold(message)}`);
  if (start > 0) lines.push(pc.dim(`  ↑ ${start} more`));

  for (let index = start; index < end; index++) {
    const option = options[index]!;
    const active = index === selectedIndex;
    const marker = isMulti ? (selectedValues.has(option.value) ? pc.green('[x]') : '[ ]') : '';
    const pointer = active ? pc.cyan('❯') : ' ';
    const label = option.disabled
      ? pc.dim(optionText(option, columns))
      : optionText(option, columns);
    const activeLabel = active && !option.disabled ? pc.cyan(pc.bold(label)) : label;
    lines.push(` ${pointer} ${marker ? `${marker} ` : ''}${activeLabel}`);
  }

  if (end < options.length) lines.push(pc.dim(`  ↓ ${options.length - end} more`));
  if (isMulti) lines.push(pc.dim(`  Selected: ${selectedValues.size}`));
  lines.push(
    pc.dim(
      `  ${hint ?? (isMulti ? '↑↓/j/k move, Space mark, Enter continue, Esc cancel' : '↑↓/j/k move, Enter select, Esc cancel')}`
    )
  );

  return lines;
}

export function countSelectRenderRows(lines: string[], columns?: number): number {
  return countVisualRowsForLines(lines, columns);
}

export { approxStringWidth, visualRowsForLine };

class PromptRenderer {
  private lastRenderHeight = 0;

  render(lines: string[]): void {
    this.clear();
    process.stdout.write(lines.join('\n') + '\n');
    this.lastRenderHeight = countSelectRenderRows(lines, process.stdout.columns);
  }

  clear(): void {
    if (this.lastRenderHeight <= 0) return;
    process.stdout.write(`\x1b[${this.lastRenderHeight}A`);
    for (let i = 0; i < this.lastRenderHeight; i++) {
      process.stdout.write('\x1b[2K\x1b[1B');
    }
    process.stdout.write(`\x1b[${this.lastRenderHeight}A`);
    this.lastRenderHeight = 0;
  }
}

function nextEnabledIndex<T>(
  options: CuiSelectOption<T>[],
  selectedIndex: number,
  direction: 1 | -1
): number {
  if (options.length === 0) return 0;
  let next = selectedIndex;
  for (let i = 0; i < options.length; i++) {
    next = (next + direction + options.length) % options.length;
    if (!options[next]?.disabled) return next;
  }
  return selectedIndex;
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

export async function cuiSelectPrompt<T>(config: CuiSelectConfig<T>): Promise<T> {
  const { options, initialIndex = 0, maxVisible = 10 } = config;
  if (options.length === 0) throw new Error('No options available');

  return new Promise<T>((resolve, reject) => {
    let selectedIndex = Math.min(Math.max(0, initialIndex), options.length - 1);
    if (options[selectedIndex]?.disabled)
      selectedIndex = nextEnabledIndex(options, selectedIndex, 1);
    const renderer = new PromptRenderer();

    const draw = () => {
      renderer.render(buildSelectLines({ ...config, selectedIndex, maxVisible }));
    };

    const cleanup = setupRawInput((_str, key) => {
      if (!key) return;
      if (key.name === 'escape' || (key.ctrl && key.name === 'c')) {
        renderer.clear();
        cleanup();
        reject(new Error('Cancelled'));
        return;
      }
      if (key.name === 'return') {
        const option = options[selectedIndex];
        if (!option || option.disabled) return;
        renderer.clear();
        cleanup();
        resolve(option.value);
        return;
      }
      if (key.name === 'up' || key.name === 'k') {
        selectedIndex = nextEnabledIndex(options, selectedIndex, -1);
        draw();
        return;
      }
      if (key.name === 'down' || key.name === 'j') {
        selectedIndex = nextEnabledIndex(options, selectedIndex, 1);
        draw();
      }
    });

    draw();
  });
}

export async function cuiMultiSelectPrompt<T>(
  config: CuiMultiSelectConfig<T>
): Promise<CuiMultiSelectResult<T>> {
  const { options, initialIndex = 0, maxVisible = 10, initialSelected = [] } = config;
  if (options.length === 0) throw new Error('No options available');

  return new Promise<CuiMultiSelectResult<T>>((resolve, reject) => {
    let selectedIndex = Math.min(Math.max(0, initialIndex), options.length - 1);
    if (options[selectedIndex]?.disabled)
      selectedIndex = nextEnabledIndex(options, selectedIndex, 1);
    const selectedValues = new Set<T>(initialSelected);
    const renderer = new PromptRenderer();

    const draw = () => {
      renderer.render(buildSelectLines({ ...config, selectedIndex, maxVisible, selectedValues }));
    };

    const cleanup = setupRawInput((_str, key) => {
      if (!key) return;
      if (key.name === 'escape' || (key.ctrl && key.name === 'c')) {
        renderer.clear();
        cleanup();
        reject(new Error('Cancelled'));
        return;
      }
      if (key.name === 'return') {
        const option = options[selectedIndex];
        if (!option || option.disabled) return;
        renderer.clear();
        cleanup();
        if (selectedValues.size > 0) {
          resolve({ type: 'selected', values: Array.from(selectedValues) });
        } else {
          resolve({ type: 'single', value: option.value });
        }
        return;
      }
      if (key.name === 'space') {
        const option = options[selectedIndex];
        if (option && !option.disabled) {
          if (selectedValues.has(option.value)) selectedValues.delete(option.value);
          else selectedValues.add(option.value);
        }
        draw();
        return;
      }
      if (key.name === 'c') {
        selectedValues.clear();
        draw();
        return;
      }
      if (key.name === 'up' || key.name === 'k') {
        selectedIndex = nextEnabledIndex(options, selectedIndex, -1);
        draw();
        return;
      }
      if (key.name === 'down' || key.name === 'j') {
        selectedIndex = nextEnabledIndex(options, selectedIndex, 1);
        draw();
      }
    });

    draw();
  });
}
