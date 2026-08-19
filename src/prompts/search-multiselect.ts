import * as readline from 'readline';
import { stripVTControlCharacters } from 'node:util';
import { Writable } from 'stream';
import pc from 'picocolors';

// Silent writable stream to prevent readline from echoing input
const silentOutput = new Writable({
  write(_chunk, _encoding, callback) {
    callback();
  },
});

export interface SearchItem<T> {
  value: T;
  label: string;
  hint?: string;
  /** Optional group heading shown before this item. */
  group?: string;
  /** Optional detail rendered in a fixed pane for the highlighted item. */
  detail?: string;
}

export interface LockedSection<T> {
  title: string;
  items: SearchItem<T>[];
  hiddenCount?: number;
}

export interface SearchMultiselectOptions<T> {
  message: string;
  items: SearchItem<T>[];
  maxVisible?: number;
  initialSelected?: T[];
  /** If true, require at least one item to be selected before submitting */
  required?: boolean;
  /** Locked section shown above the searchable list - items are always selected and can't be toggled */
  lockedSection?: LockedSection<T>;
  /** Whether to render a search input and accept text input. Defaults to true. */
  searchable?: boolean;
  /** Whether to render a fixed-height detail pane for the highlighted item. */
  showDetail?: boolean;
  /** Number of rows reserved for the detail pane. Defaults to two. */
  detailLines?: number;
  /** Whether to display the selected-item summary. Defaults to true. */
  showSelectedSummary?: boolean;
  /** Whether group headings are selectable and toggle every item in the group. */
  selectGroups?: boolean;
  /** Whether to show a distinct Select All row above the selectable items. */
  selectAll?: boolean;
}

export type SearchEntry<T> =
  | { type: 'item'; item: SearchItem<T> }
  | { type: 'group'; group: string; items: SearchItem<T>[]; collapsed: boolean };

const S_STEP_ACTIVE = pc.green('◆');
const S_STEP_CANCEL = pc.red('■');
const S_STEP_SUBMIT = pc.green('◇');
const S_RADIO_ACTIVE = pc.green('●');
const S_RADIO_INACTIVE = pc.dim('○');
const S_CHECKBOX_LOCKED = pc.green('✓');
const S_BULLET = pc.green('•');
const S_BAR = pc.dim('│');
const S_BAR_H = pc.dim('─');

export const cancelSymbol = Symbol('cancel');

/**
 * Approximate terminal display width (cells) for a string with no ANSI sequences.
 * Matches common East Asian / emoji double-width behavior used by modern terminals.
 */
export function approxStringWidth(plain: string): number {
  let width = 0;
  for (const ch of plain) {
    const code = ch.codePointAt(0)!;
    if (code === 0) continue;
    const wide =
      (code >= 0x1100 && code <= 0x115f) ||
      (code >= 0x231a && code <= 0x231b) ||
      (code >= 0x2329 && code <= 0x232a) ||
      (code >= 0x23e9 && code <= 0x23ec) ||
      code === 0x23f0 ||
      code === 0x23f3 ||
      (code >= 0x25fd && code <= 0x25fe) ||
      (code >= 0x2614 && code <= 0x2615) ||
      (code >= 0x2648 && code <= 0x2653) ||
      (code >= 0x267f && code <= 0x267f) ||
      (code >= 0x2693 && code <= 0x2693) ||
      (code >= 0x26a1 && code <= 0x26a1) ||
      (code >= 0x26aa && code <= 0x26ab) ||
      (code >= 0x26bd && code <= 0x26be) ||
      (code >= 0x26c4 && code <= 0x26c5) ||
      (code >= 0x26ce && code <= 0x26ce) ||
      (code >= 0x26d4 && code <= 0x26d4) ||
      (code >= 0x26ea && code <= 0x26ea) ||
      (code >= 0x26f2 && code <= 0x26f3) ||
      (code >= 0x26f5 && code <= 0x26f5) ||
      (code >= 0x26fa && code <= 0x26fa) ||
      (code >= 0x26fd && code <= 0x26fd) ||
      (code >= 0x2705 && code <= 0x2705) ||
      (code >= 0x270a && code <= 0x270b) ||
      (code >= 0x2728 && code <= 0x2728) ||
      (code >= 0x274c && code <= 0x274c) ||
      (code >= 0x274e && code <= 0x274e) ||
      (code >= 0x2753 && code <= 0x2755) ||
      (code >= 0x2757 && code <= 0x2757) ||
      (code >= 0x2795 && code <= 0x2797) ||
      (code >= 0x27b0 && code <= 0x27b0) ||
      (code >= 0x27bf && code <= 0x27bf) ||
      (code >= 0x2b1b && code <= 0x2b1c) ||
      (code >= 0x2b50 && code <= 0x2b50) ||
      (code >= 0x2b55 && code <= 0x2b55) ||
      (code >= 0x2e80 && code <= 0xa4cf && code !== 0x303f) ||
      (code >= 0xa960 && code <= 0xa97c) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe10 && code <= 0xfe19) ||
      (code >= 0xfe30 && code <= 0xfe6f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6) ||
      (code >= 0x1f000 && code <= 0x1f9ff);
    width += wide ? 2 : 1;
  }
  return width;
}

/**
 * How many physical terminal rows one logical line occupies after soft-wrapping.
 */
export function visualRowsForLine(line: string, columns: number): number {
  const plain = stripVTControlCharacters(line);
  const cols = Math.max(1, columns);
  const w = approxStringWidth(plain);
  return Math.max(1, Math.ceil(w / cols));
}

/**
 * Total physical rows for a block of logical lines (used to erase/redraw TUI output).
 */
export function countVisualRowsForLines(lines: string[], columns: number | undefined): number {
  const cols =
    columns !== undefined && columns > 0
      ? columns
      : process.stdout.columns && process.stdout.columns > 0
        ? process.stdout.columns
        : 80;
  return lines.reduce((sum, line) => sum + visualRowsForLine(line, cols), 0);
}

function truncateToWidth(text: string, width: number): string {
  let truncated = '';
  for (const char of text) {
    if (approxStringWidth(truncated + char) > width) break;
    truncated += char;
  }
  return truncated;
}

/**
 * Wrap description text into a fixed number of terminal-width-safe lines.
 * Empty lines are appended so changing the highlighted item never changes the
 * prompt's logical height.
 */
export function formatDetailLines(
  detail: string | undefined,
  width: number,
  maxLines: number
): string[] {
  const safeWidth = Math.max(1, width);
  const normalized = detail?.replace(/\s+/g, ' ').trim() ?? '';
  const lines: string[] = [];
  let remaining = normalized;

  while (remaining && lines.length < maxLines) {
    if (approxStringWidth(remaining) <= safeWidth) {
      lines.push(remaining);
      remaining = '';
      break;
    }

    const candidate = truncateToWidth(remaining, safeWidth);
    const breakAt = candidate.lastIndexOf(' ');
    if (breakAt > 0) {
      lines.push(candidate.slice(0, breakAt).trimEnd());
      remaining = remaining.slice(breakAt).trimStart();
    } else {
      lines.push(candidate);
      remaining = remaining.slice(candidate.length).trimStart();
    }
  }

  if (remaining && lines.length > 0) {
    const last = lines.length - 1;
    lines[last] = `${truncateToWidth(lines[last]!, Math.max(0, safeWidth - 1)).trimEnd()}…`;
  }

  while (lines.length < maxLines) lines.push('');
  return lines;
}

/** Build the navigable rows for a prompt, including selectable group headings. */
export function buildSearchEntries<T>(
  items: SearchItem<T>[],
  selectGroups: boolean,
  collapsedGroups: ReadonlySet<string> = new Set()
): SearchEntry<T>[] {
  if (!selectGroups) return items.map((item) => ({ type: 'item', item }));

  const entries: SearchEntry<T>[] = [];
  let index = 0;

  while (index < items.length) {
    const item = items[index]!;
    if (!item.group) {
      entries.push({ type: 'item', item });
      index += 1;
      continue;
    }

    const groupItems: SearchItem<T>[] = [];
    while (index < items.length && items[index]!.group === item.group) {
      groupItems.push(items[index]!);
      index += 1;
    }

    const collapsed = collapsedGroups.has(item.group);
    entries.push({ type: 'group', group: item.group, items: groupItems, collapsed });
    if (!collapsed) {
      entries.push(...groupItems.map((groupItem) => ({ type: 'item' as const, item: groupItem })));
    }
  }

  return entries;
}

/** Toggle one item, or every item represented by a selectable group heading. */
export function toggleSearchEntry<T>(selected: Set<T>, entry: SearchEntry<T> | undefined): void {
  if (entry?.type === 'group') {
    const allSelected = entry.items.every((item) => selected.has(item.value));
    for (const item of entry.items) {
      if (allSelected) {
        selected.delete(item.value);
      } else {
        selected.add(item.value);
      }
    }
  } else if (entry?.type === 'item') {
    if (selected.has(entry.item.value)) {
      selected.delete(entry.item.value);
    } else {
      selected.add(entry.item.value);
    }
  }
}

export type SelectAllState = 'none' | 'partial' | 'all';

/** Return the aggregate selection state represented by a Select All row. */
export function getSelectAllState<T>(
  selected: ReadonlySet<T>,
  items: SearchItem<T>[]
): SelectAllState {
  const selectedCount = items.filter((item) => selected.has(item.value)).length;
  if (selectedCount === 0) return 'none';
  if (selectedCount === items.length) return 'all';
  return 'partial';
}

/** Select every item unless they are all selected, in which case clear them all. */
export function toggleAllItems<T>(selected: Set<T>, items: SearchItem<T>[]): void {
  const shouldClear = getSelectAllState(selected, items) === 'all';
  for (const item of items) {
    if (shouldClear) {
      selected.delete(item.value);
    } else {
      selected.add(item.value);
    }
  }
}

/**
 * Interactive search multiselect prompt.
 * Allows users to filter a long list by typing and select multiple items.
 * Optionally supports a "locked" section that displays always-selected items.
 */
export async function searchMultiselect<T>(
  options: SearchMultiselectOptions<T>
): Promise<T[] | symbol> {
  const {
    message,
    items,
    maxVisible = 8,
    initialSelected = [],
    required = false,
    lockedSection,
    searchable = true,
    showDetail = false,
    detailLines = 2,
    showSelectedSummary = true,
    selectGroups = false,
    selectAll = false,
  } = options;

  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: silentOutput,
      terminal: false,
    });

    // Enable raw mode for keypress detection
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    readline.emitKeypressEvents(process.stdin, rl);

    let query = '';
    let cursor = 0;
    const selected = new Set<T>(initialSelected);
    const collapsedGroups = new Set<string>();
    let lastRenderHeight = 0;

    // Locked items are always included in the result
    const lockedValues = lockedSection ? lockedSection.items.map((i) => i.value) : [];

    const filter = (item: SearchItem<T>, q: string): boolean => {
      if (!q) return true;
      const lowerQ = q.toLowerCase();
      return (
        item.label.toLowerCase().includes(lowerQ) ||
        String(item.value).toLowerCase().includes(lowerQ)
      );
    };

    const getFiltered = (): SearchItem<T>[] => {
      return items.filter((item) => filter(item, query));
    };

    const render = (state: 'active' | 'submit' | 'cancel' = 'active'): void => {
      const lines: string[] = [];
      const filtered = getFiltered();
      const entries = buildSearchEntries(filtered, selectGroups, collapsedGroups);
      const hasSelectAll = selectAll && items.length > 0;
      const entryCursor = cursor - (hasSelectAll ? 1 : 0);

      // Header
      const icon =
        state === 'active' ? S_STEP_ACTIVE : state === 'cancel' ? S_STEP_CANCEL : S_STEP_SUBMIT;
      lines.push(`${icon}  ${pc.bold(message)}`);

      if (state === 'active') {
        // Locked section (universal agents)
        if (lockedSection && lockedSection.items.length > 0) {
          lines.push(`${S_BAR}`);
          const lockedTitle = `${pc.bold(lockedSection.title)} ${pc.dim('── always included')}`;
          lines.push(`${S_BAR}  ${S_BAR_H}${S_BAR_H} ${lockedTitle} ${S_BAR_H.repeat(12)}`);
          for (const item of lockedSection.items) {
            lines.push(`${S_BAR}    ${S_BULLET} ${pc.bold(item.label)}`);
          }
          if (lockedSection.hiddenCount && lockedSection.hiddenCount > 0) {
            lines.push(`${S_BAR}    ${pc.dim(`…and ${lockedSection.hiddenCount} more`)}`);
          }
          lines.push(`${S_BAR}`);
          lines.push(
            `${S_BAR}  ${S_BAR_H}${S_BAR_H} ${pc.bold('Additional agents')} ${S_BAR_H.repeat(29)}`
          );
        }

        if (searchable) {
          const searchLine = `${S_BAR}  ${pc.dim('Search:')} ${query}${pc.inverse(' ')}`;
          lines.push(searchLine);
          lines.push(`${S_BAR}  ${pc.dim('↑↓ move, space select, enter confirm')}`);
          lines.push(`${S_BAR}`);
        }

        if (hasSelectAll) {
          const selectedCount = items.filter((item) => selected.has(item.value)).length;
          const selectAllState = getSelectAllState(selected, items);
          const radio =
            selectAllState === 'all'
              ? S_RADIO_ACTIVE
              : selectAllState === 'partial'
                ? pc.yellow('◐')
                : S_RADIO_INACTIVE;
          const isCursor = cursor === 0;
          const prefix = isCursor ? pc.cyan('❯') : ' ';
          const label = isCursor ? pc.underline(pc.bold('Select All')) : pc.bold('Select All');
          lines.push(
            `${S_BAR} ${prefix} ${radio} ${label} ${pc.dim(`(${selectedCount}/${items.length})`)}`
          );
          lines.push(`${S_BAR}   ${S_BAR_H.repeat(36)}`);
        }

        const columns =
          process.stdout.columns && process.stdout.columns > 0 ? process.stdout.columns : 80;

        const buildFooterLines = (
          includeDetail: boolean,
          includeSelectedSummary: boolean
        ): string[] => {
          const footerLines: string[] = [];

          if (includeDetail) {
            const entry = entries[entryCursor];
            const detail =
              hasSelectAll && cursor === 0
                ? `Select or clear all ${items.length} skills.`
                : entry?.type === 'group'
                  ? `Select all ${entry.items.length} skills in ${entry.group}.`
                  : entry?.item.detail;
            // Keep a small margin for the left rail and terminal wrapping behavior.
            const detailWidth = Math.max(1, columns - 5);
            footerLines.push(`${S_BAR}`);
            footerLines.push(`${S_BAR}  ${pc.dim('Description')}`);
            for (const line of formatDetailLines(detail, detailWidth, detailLines)) {
              footerLines.push(`${S_BAR}  ${pc.dim(line)}`);
            }
          }

          if (includeSelectedSummary) {
            // Selected summary (include locked items)
            footerLines.push(`${S_BAR}`);
            const allSelectedLabels = [
              ...(lockedSection ? lockedSection.items.map((i) => i.label) : []),
              ...items.filter((item) => selected.has(item.value)).map((item) => item.label),
            ];
            if (allSelectedLabels.length === 0) {
              footerLines.push(`${S_BAR}  ${pc.dim('Selected: (none)')}`);
            } else {
              const summary =
                allSelectedLabels.length <= 3
                  ? allSelectedLabels.join(', ')
                  : `${allSelectedLabels.slice(0, 3).join(', ')} +${allSelectedLabels.length - 3} more`;
              footerLines.push(`${S_BAR}  ${pc.green('Selected:')} ${summary}`);
            }
          }

          if (!searchable) {
            footerLines.push(`${S_BAR}`);
            footerLines.push(
              `${S_BAR}  ${pc.dim('↑↓ move, ←→ collapse/expand, space select, enter confirm')}`
            );
          }
          footerLines.push(`${pc.dim('└')}`);
          return footerLines;
        };

        const buildItemLines = (visibleLimit: number): string[] => {
          if (filtered.length === 0) {
            return [`${S_BAR}  ${pc.dim('No matches found')}`];
          }

          const itemLines: string[] = [];
          const visibleStart = Math.max(
            0,
            Math.min(entryCursor - Math.floor(visibleLimit / 2), entries.length - visibleLimit)
          );
          const visibleEnd = Math.min(entries.length, visibleStart + visibleLimit);
          const visibleEntries = entries.slice(visibleStart, visibleEnd);

          for (let i = 0; i < visibleEntries.length; i++) {
            const entry = visibleEntries[i]!;
            const actualIndex = visibleStart + i;
            const isCursor = actualIndex === entryCursor;

            if (entry.type === 'group') {
              const selectedCount = entry.items.filter((item) => selected.has(item.value)).length;
              const radio =
                selectedCount === entry.items.length
                  ? S_RADIO_ACTIVE
                  : selectedCount > 0
                    ? pc.yellow('◐')
                    : S_RADIO_INACTIVE;
              const label = isCursor ? pc.underline(pc.bold(entry.group)) : pc.bold(entry.group);
              const prefix = isCursor ? pc.cyan('❯') : ' ';
              const disclosure = pc.dim(entry.collapsed ? '▸' : '▾');
              itemLines.push(`${S_BAR} ${prefix} ${disclosure} ${radio} ${label}`);
              continue;
            }

            const item = entry.item;
            const isSelected = selected.has(item.value);
            const radio = isSelected ? S_RADIO_ACTIVE : S_RADIO_INACTIVE;
            const label = isCursor ? pc.underline(item.label) : item.label;
            const hint = item.hint ? pc.dim(` (${item.hint})`) : '';

            const prefix = isCursor ? pc.cyan('❯') : ' ';
            const groupItems =
              selectGroups && item.group ? filtered.filter((i) => i.group === item.group) : [];
            const isLastInGroup = groupItems.at(-1) === item;
            const tree = groupItems.length > 0 ? `${pc.dim(isLastInGroup ? '└─' : '├─')} ` : '';
            itemLines.push(`${S_BAR} ${prefix} ${tree}${radio} ${label}${hint}`);
          }

          const hiddenBefore = visibleStart;
          const hiddenAfter = entries.length - visibleEnd;
          if (hiddenBefore > 0 || hiddenAfter > 0) {
            const parts: string[] = [];
            if (hiddenBefore > 0) parts.push(`↑ ${hiddenBefore} more`);
            if (hiddenAfter > 0) parts.push(`↓ ${hiddenAfter} more`);
            itemLines.push(`${S_BAR}  ${pc.dim(parts.join('  '))}`);
          }

          return itemLines;
        };

        const terminalRows =
          process.stdout.rows && process.stdout.rows > 0 ? process.stdout.rows : undefined;
        const maxFrameRows = terminalRows ? Math.max(1, terminalRows - 1) : undefined;

        const fitFrame = (
          includeDetail: boolean,
          includeSelectedSummary: boolean
        ): { itemLines: string[]; footerLines: string[]; frameRows: number } => {
          const footerLines = buildFooterLines(includeDetail, includeSelectedSummary);
          let visibleLimit = Math.max(1, maxVisible);
          let itemLines = buildItemLines(visibleLimit);
          let frameRows = countVisualRowsForLines(
            [...lines, ...itemLines, ...footerLines],
            columns
          );

          while (maxFrameRows && frameRows > maxFrameRows && visibleLimit > 1) {
            visibleLimit -= 1;
            itemLines = buildItemLines(visibleLimit);
            frameRows = countVisualRowsForLines([...lines, ...itemLines, ...footerLines], columns);
          }

          return { itemLines, footerLines, frameRows };
        };

        let includeDetail = showDetail;
        let includeSelectedSummary = showSelectedSummary;
        let fitted = fitFrame(includeDetail, includeSelectedSummary);

        // On very short terminals, preserve controls and selectable rows before
        // optional context panes. The detail returns automatically when space grows.
        if (maxFrameRows && fitted.frameRows > maxFrameRows && includeDetail) {
          includeDetail = false;
          fitted = fitFrame(includeDetail, includeSelectedSummary);
        }
        if (maxFrameRows && fitted.frameRows > maxFrameRows && includeSelectedSummary) {
          includeSelectedSummary = false;
          fitted = fitFrame(includeDetail, includeSelectedSummary);
        }

        lines.push(...fitted.itemLines, ...fitted.footerLines);
      } else if (state === 'submit') {
        // Final state - show what was selected (including locked)
        const allSelectedLabels = [
          ...(lockedSection ? lockedSection.items.map((i) => i.label) : []),
          ...items.filter((item) => selected.has(item.value)).map((item) => item.label),
        ];
        lines.push(`${S_BAR}  ${pc.dim(allSelectedLabels.join(', '))}`);
      } else if (state === 'cancel') {
        lines.push(`${S_BAR}  ${pc.strikethrough(pc.dim('Cancelled'))}`);
      }

      // Write the clear sequence and next frame together. Clearing individual rows first
      // makes larger prompts visibly flash between redraws in some terminals.
      const clearPreviousFrame = lastRenderHeight > 0 ? `\x1b[${lastRenderHeight}A\x1b[J` : '';
      process.stdout.write(clearPreviousFrame + lines.join('\n') + '\n');
      // Use wrapped row count: logical lines can span multiple terminal rows when hints
      // or labels exceed column width. Using lines.length alone under-counts and fails to
      // clear the full previous frame, causing the prompt to re-print stale rows on redraw.
      lastRenderHeight = countVisualRowsForLines(lines, process.stdout.columns);
    };

    const cleanup = (): void => {
      process.stdin.removeListener('keypress', keypressHandler);
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }
      rl.close();
    };

    const submit = (): void => {
      // If required and no locked items, don't allow submitting with no selection
      if (required && selected.size === 0 && lockedValues.length === 0) {
        return;
      }
      render('submit');
      cleanup();
      // Include locked values in the result
      resolve([...lockedValues, ...Array.from(selected)]);
    };

    const cancel = (): void => {
      render('cancel');
      cleanup();
      resolve(cancelSymbol);
    };

    // Handle keypresses
    const keypressHandler = (_str: string, key: readline.Key): void => {
      if (!key) return;

      const entries = buildSearchEntries(getFiltered(), selectGroups, collapsedGroups);
      const hasSelectAll = selectAll && items.length > 0;
      const cursorOffset = hasSelectAll ? 1 : 0;
      const entry = entries[cursor - cursorOffset];

      if (key.name === 'return') {
        submit();
        return;
      }

      if (key.name === 'escape' || (key.ctrl && key.name === 'c')) {
        cancel();
        return;
      }

      if (key.name === 'up') {
        cursor = Math.max(0, cursor - 1);
        render();
        return;
      }

      if (key.name === 'down') {
        cursor = Math.min(entries.length + cursorOffset - 1, cursor + 1);
        render();
        return;
      }

      if (selectGroups && key.name === 'right') {
        if (entry?.type === 'group' && entry.collapsed) {
          collapsedGroups.delete(entry.group);
          render();
        }
        return;
      }

      if (selectGroups && key.name === 'left') {
        const group = entry?.type === 'group' ? entry.group : entry?.item.group;
        if (group) {
          collapsedGroups.add(group);
          const collapsedEntries = buildSearchEntries(getFiltered(), selectGroups, collapsedGroups);
          cursor =
            collapsedEntries.findIndex(
              (collapsedEntry) => collapsedEntry.type === 'group' && collapsedEntry.group === group
            ) + cursorOffset;
          render();
        }
        return;
      }

      if (key.name === 'space') {
        if (hasSelectAll && cursor === 0) {
          toggleAllItems(selected, items);
        } else {
          toggleSearchEntry(selected, entry);
        }
        render();
        return;
      }

      if (key.name === 'backspace') {
        query = query.slice(0, -1);
        cursor = 0;
        render();
        return;
      }

      // Regular character input
      if (searchable && key.sequence && !key.ctrl && !key.meta && key.sequence.length === 1) {
        query += key.sequence;
        cursor = 0;
        render();
        return;
      }
    };

    process.stdin.on('keypress', keypressHandler);

    // Initial render
    render();
  });
}
