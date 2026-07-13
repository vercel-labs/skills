import * as readline from 'readline';

// A small fzf-style interactive search prompt shared by `find` (skills) and
// `bundle search`. The caller supplies how to search and how to render a row;
// this module owns the terminal handling (raw keypresses, live re-render,
// debounced queries) and returns the selected item (or null if cancelled).

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[38;5;102m';
const TEXT = '\x1b[38;5;145m';

// ANSI escape codes for terminal control
const HIDE_CURSOR = '\x1b[?25l';
const SHOW_CURSOR = '\x1b[?25h';
const CLEAR_DOWN = '\x1b[J';
const MOVE_UP = (n: number) => `\x1b[${n}A`;
const MOVE_TO_COL = (n: number) => `\x1b[${n}G`;

const ANSI_SGR = /\x1b\[[0-9;]*m/g;

/** Printable width of a string, ignoring ANSI SGR (color/style) codes. */
function visibleWidth(s: string): number {
  return s.replace(ANSI_SGR, '').length;
}

/**
 * Truncate a string to `width` printable columns (ANSI-aware), appending an
 * ellipsis when clipped. The redraw math counts logical lines, so any line that
 * wraps would desync `MOVE_UP` and leave ghost rows — keeping every line within
 * the terminal width prevents that.
 */
export function truncateToWidth(s: string, width: number): string {
  if (width <= 0) return '';
  if (visibleWidth(s) <= width) return s;

  let out = '';
  let visible = 0;
  let i = 0;
  while (i < s.length && visible < width - 1) {
    if (s[i] === '\x1b') {
      const m = /^\x1b\[[0-9;]*m/.exec(s.slice(i));
      if (m) {
        out += m[0];
        i += m[0].length;
        continue;
      }
    }
    out += s[i];
    visible++;
    i++;
  }
  return `${out}…${RESET}`;
}

export interface InteractiveSearchOptions<T> {
  /** Text shown before the query input, e.g. "Search skills:". */
  label: string;
  /** Run the search for the current query. Called debounced. Should not throw. */
  search: (query: string) => Promise<T[]>;
  /**
   * Render one result's text (everything after the selection arrow). `selected`
   * lets the row highlight itself (e.g. bold the name).
   */
  renderRow: (item: T, selected: boolean) => string;
  /**
   * Minimum query length before searching. `0` searches immediately with an
   * empty query — i.e. browse the full list and filter as you type.
   */
  minChars?: number;
  /** Hint shown while the query is shorter than `minChars` (only when minChars > 0). */
  belowMinHint?: string;
  /** Message shown when a search returns no rows. */
  emptyMessage?: string;
  /** Max rows rendered at once. */
  maxVisible?: number;
}

export async function interactiveSearch<T>(opts: InteractiveSearchOptions<T>): Promise<T | null> {
  const {
    label,
    search,
    renderRow,
    minChars = 2,
    belowMinHint = `Start typing to search (min ${minChars} chars)`,
    emptyMessage = 'No results found',
    maxVisible = 8,
  } = opts;

  // VT escape codes only work when the terminal has ANSI/VT processing enabled.
  // On Windows without VT mode, escape sequences print as literal text, causing
  // each render to append new lines instead of overwriting the previous frame.
  const vtSupported = process.stdout.isTTY && (process.stdout.getColorDepth?.() ?? 1) > 1;

  let results: T[] = [];
  let selectedIndex = 0;
  let query = '';
  let loading = false;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let lastRenderedLines = 0;

  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }
  readline.emitKeypressEvents(process.stdin);
  process.stdin.resume();
  if (vtSupported) {
    process.stdout.write(HIDE_CURSOR);
  }

  function render(): void {
    if (vtSupported && lastRenderedLines > 0) {
      process.stdout.write(MOVE_UP(lastRenderedLines) + MOVE_TO_COL(1));
    }
    if (vtSupported) {
      process.stdout.write(CLEAR_DOWN);
    }

    const lines: string[] = [];

    const cursor = `${BOLD}_${RESET}`;
    lines.push(`${TEXT}${label}${RESET} ${query}${cursor}`);
    lines.push('');

    if (query.length < minChars) {
      lines.push(`${DIM}${belowMinHint}${RESET}`);
    } else if (results.length === 0 && loading) {
      lines.push(`${DIM}Searching...${RESET}`);
    } else if (results.length === 0) {
      lines.push(`${DIM}${emptyMessage}${RESET}`);
    } else {
      const visible = results.slice(0, maxVisible);
      for (let i = 0; i < visible.length; i++) {
        const item = visible[i]!;
        const isSelected = i === selectedIndex;
        const arrow = isSelected ? `${BOLD}>${RESET}` : ' ';
        const loadingIndicator = loading && i === 0 ? ` ${DIM}...${RESET}` : '';
        lines.push(`  ${arrow} ${renderRow(item, isSelected)}${loadingIndicator}`);
      }
    }

    lines.push('');
    lines.push(`${DIM}up/down navigate | enter select | esc cancel${RESET}`);

    // Clip each line to the terminal width so nothing wraps — otherwise a
    // wrapped line would make the next MOVE_UP undercount and leave ghost rows.
    const maxWidth = (process.stdout.columns ?? 80) - 1;
    for (const line of lines) {
      process.stdout.write(truncateToWidth(line, maxWidth) + '\n');
    }
    lastRenderedLines = vtSupported ? lines.length : 0;
  }

  function triggerSearch(q: string): void {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    loading = false;

    if (q.length < minChars) {
      results = [];
      selectedIndex = 0;
      render();
      return;
    }

    loading = true;
    render();

    // Adaptive debounce: shorter queries wait longer (user is likely still typing).
    const debounceMs = Math.max(150, 350 - q.length * 50);
    debounceTimer = setTimeout(async () => {
      try {
        results = await search(q);
        selectedIndex = 0;
      } catch {
        results = [];
      } finally {
        loading = false;
        debounceTimer = null;
        render();
      }
    }, debounceMs);
  }

  // Browse mode (minChars === 0): populate the full list immediately.
  if (minChars === 0) {
    triggerSearch('');
  }
  render();

  return new Promise((resolve) => {
    function cleanup(): void {
      process.stdin.removeListener('keypress', handleKeypress);
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }
      if (vtSupported) {
        process.stdout.write(SHOW_CURSOR);
      }
      // Pause stdin to fully release it for child processes.
      process.stdin.pause();
    }

    function handleKeypress(_ch: string | undefined, key: readline.Key): void {
      if (!key) return;

      if (key.name === 'escape' || (key.ctrl && key.name === 'c')) {
        cleanup();
        resolve(null);
        return;
      }

      if (key.name === 'return') {
        cleanup();
        resolve(results[selectedIndex] || null);
        return;
      }

      if (key.name === 'up') {
        selectedIndex = Math.max(0, selectedIndex - 1);
        render();
        return;
      }

      if (key.name === 'down') {
        selectedIndex = Math.min(Math.max(0, results.length - 1), selectedIndex + 1);
        render();
        return;
      }

      if (key.name === 'backspace') {
        if (query.length > 0) {
          query = query.slice(0, -1);
          triggerSearch(query);
        }
        return;
      }

      // Regular character input
      if (key.sequence && !key.ctrl && !key.meta && key.sequence.length === 1) {
        const char = key.sequence;
        if (char >= ' ' && char <= '~') {
          query += char;
          triggerSearch(query);
        }
      }
    }

    process.stdin.on('keypress', handleKeypress);
  });
}
