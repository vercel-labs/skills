import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { interactiveSearch, truncateToWidth } from './search-prompt.ts';

// The prompt reads process.stdin/stdout directly. We swap in a minimal fake TTY
// for the duration of each test and drive it by emitting `keypress` events
// directly (rather than feeding raw bytes), with fake timers so the debounced
// search fires deterministically.

interface Item {
  name: string;
}

let fakeStdin: EventEmitter & {
  isTTY: boolean;
  setRawMode: ReturnType<typeof vi.fn>;
  resume: ReturnType<typeof vi.fn>;
  pause: ReturnType<typeof vi.fn>;
};
let stdinDescriptor: PropertyDescriptor | undefined;
let stdoutDescriptor: PropertyDescriptor | undefined;

function key(name: string, extra: Record<string, unknown> = {}) {
  return { name, ctrl: false, meta: false, sequence: undefined, ...extra };
}

function char(c: string) {
  return { name: c, ctrl: false, meta: false, sequence: c };
}

function press(k: unknown): void {
  fakeStdin.emit('keypress', undefined, k);
}

beforeEach(() => {
  vi.useFakeTimers();

  fakeStdin = Object.assign(new EventEmitter(), {
    isTTY: true,
    setRawMode: vi.fn(),
    resume: vi.fn(),
    pause: vi.fn(),
  });
  // isTTY:false keeps vtSupported off so no cursor-control escapes are written.
  const fakeStdout = { isTTY: false, write: vi.fn() };

  stdinDescriptor = Object.getOwnPropertyDescriptor(process, 'stdin');
  stdoutDescriptor = Object.getOwnPropertyDescriptor(process, 'stdout');
  Object.defineProperty(process, 'stdin', { value: fakeStdin, configurable: true });
  Object.defineProperty(process, 'stdout', { value: fakeStdout, configurable: true });
});

afterEach(() => {
  if (stdinDescriptor) Object.defineProperty(process, 'stdin', stdinDescriptor);
  if (stdoutDescriptor) Object.defineProperty(process, 'stdout', stdoutDescriptor);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('interactiveSearch', () => {
  it('browse mode (minChars 0) searches immediately and returns the selected item', async () => {
    const items: Item[] = [{ name: 'a' }, { name: 'b' }, { name: 'c' }];
    const search = vi.fn(async () => items);

    const promise = interactiveSearch<Item>({
      label: 'x',
      minChars: 0,
      search,
      renderRow: (i) => i.name,
    });

    await vi.runAllTimersAsync(); // fire the browse debounce
    expect(search).toHaveBeenCalledWith('');

    press(key('down')); // move to index 1
    press(key('return'));

    await expect(promise).resolves.toEqual(items[1]);
  });

  it('minChars 2 does not search until the query is long enough', async () => {
    const search = vi.fn(async () => [{ name: 'hit' }]);

    const promise = interactiveSearch<Item>({
      label: 'x',
      minChars: 2,
      search,
      renderRow: (i) => i.name,
    });

    await vi.runAllTimersAsync();
    expect(search).not.toHaveBeenCalled(); // no browse-on-start

    press(char('a'));
    await vi.runAllTimersAsync();
    expect(search).not.toHaveBeenCalled(); // 1 char < minChars

    press(char('b'));
    await vi.runAllTimersAsync();
    expect(search).toHaveBeenCalledWith('ab');

    press(key('escape'));
    await expect(promise).resolves.toBeNull();
  });

  it('clamps up/down navigation and returns the highlighted item on enter', async () => {
    const items: Item[] = [{ name: '0' }, { name: '1' }, { name: '2' }];
    const promise = interactiveSearch<Item>({
      label: 'x',
      minChars: 0,
      search: async () => items,
      renderRow: (i) => i.name,
    });

    await vi.runAllTimersAsync();

    press(key('up')); // clamped at 0
    press(key('down'));
    press(key('down'));
    press(key('down'));
    press(key('down')); // clamped at last index (2)
    press(key('return'));

    await expect(promise).resolves.toEqual(items[2]);
  });

  it('resolves null on ctrl-c', async () => {
    const promise = interactiveSearch<Item>({
      label: 'x',
      minChars: 0,
      search: async () => [{ name: 'a' }],
      renderRow: (i) => i.name,
    });

    await vi.runAllTimersAsync();
    press(key('c', { ctrl: true }));

    await expect(promise).resolves.toBeNull();
  });

  it('resolves null when enter is pressed with no results', async () => {
    const promise = interactiveSearch<Item>({
      label: 'x',
      minChars: 0,
      search: async () => [],
      renderRow: (i) => i.name,
    });

    await vi.runAllTimersAsync();
    press(key('return'));

    await expect(promise).resolves.toBeNull();
  });

  it('does not desync when a result row is wider than the terminal', async () => {
    // A long row would wrap and break the redraw; renderRow output is clipped
    // to the terminal width so this stays a single visual line.
    const items: Item[] = [{ name: 'x'.repeat(500) }];
    const writes: string[] = [];
    (process.stdout as unknown as { write: (s: string) => void }).write = (s: string) => {
      writes.push(s);
    };
    (process.stdout as unknown as { columns: number }).columns = 80;

    const promise = interactiveSearch<Item>({
      label: 'x',
      minChars: 0,
      search: async () => items,
      renderRow: (i) => i.name,
    });
    await vi.runAllTimersAsync();
    press(key('return'));
    await promise;

    // Every written line stays within the terminal width (no wrapping).
    for (const w of writes) {
      for (const line of w.split('\n')) {
        expect(line.replace(/\x1b\[[0-9;]*m/g, '').length).toBeLessThan(80);
      }
    }
  });

  it('renders each result through renderRow', async () => {
    const items: Item[] = [{ name: 'alpha' }, { name: 'beta' }];
    const renderRow = vi.fn((i: Item) => i.name);

    const promise = interactiveSearch<Item>({
      label: 'x',
      minChars: 0,
      search: async () => items,
      renderRow,
    });

    await vi.runAllTimersAsync();
    press(key('return'));
    await promise;

    expect(renderRow.mock.calls.map((c) => c[0].name)).toEqual(
      expect.arrayContaining(['alpha', 'beta'])
    );
  });
});

describe('truncateToWidth', () => {
  const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');

  it('returns strings that already fit unchanged', () => {
    expect(truncateToWidth('hello', 10)).toBe('hello');
    expect(truncateToWidth('hello', 5)).toBe('hello');
  });

  it('clips long strings to the width with an ellipsis', () => {
    const out = truncateToWidth('abcdefghij', 5);
    expect(strip(out)).toBe('abcd…');
    expect(strip(out).length).toBe(5);
  });

  it('ignores ANSI codes when measuring width and preserves them', () => {
    const out = truncateToWidth('\x1b[36mabcdefghij\x1b[0m', 5);
    expect(strip(out)).toBe('abcd…');
    expect(out).toContain('\x1b[36m');
  });

  it('never exceeds the target printable width', () => {
    expect(strip(truncateToWidth('x'.repeat(200), 40)).length).toBeLessThanOrEqual(40);
  });
});
