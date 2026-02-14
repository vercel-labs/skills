import * as readline from 'readline';
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
  group?: string;
}

export interface LockedSection<T> {
  title: string;
  items: SearchItem<T>[];
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
}

const S_STEP_ACTIVE = pc.green('◆');
const S_STEP_CANCEL = pc.red('■');
const S_STEP_SUBMIT = pc.green('◇');
const S_RADIO_ACTIVE = pc.green('●');
const S_RADIO_INACTIVE = pc.dim('○');
const S_CHECKBOX_LOCKED = pc.green('✓');
const S_BAR = pc.dim('│');
const S_BAR_H = pc.dim('─');

export const cancelSymbol = Symbol('cancel');

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

    const clearRender = (): void => {
      if (lastRenderHeight > 0) {
        // Move up and clear each line
        process.stdout.write(`\x1b[${lastRenderHeight}A`);
        for (let i = 0; i < lastRenderHeight; i++) {
          process.stdout.write('\x1b[2K\x1b[1B');
        }
        process.stdout.write(`\x1b[${lastRenderHeight}A`);
      }
    };

    const render = (state: 'active' | 'submit' | 'cancel' = 'active'): void => {
      clearRender();

      const lines: string[] = [];
      const filtered = getFiltered();

      // Header
      const icon =
        state === 'active' ? S_STEP_ACTIVE : state === 'cancel' ? S_STEP_CANCEL : S_STEP_SUBMIT;
      lines.push(`${icon}  ${pc.bold(message)}`);

      if (state === 'active') {
        // Locked section (universal agents)
        if (lockedSection && lockedSection.items.length > 0) {
          lines.push(`${S_BAR}`);
          lines.push(
            `${S_BAR}  ${S_BAR_H}${S_BAR_H} ${pc.bold(lockedSection.title)} ${S_BAR_H.repeat(30)}`
          );
          for (const item of lockedSection.items) {
            lines.push(`${S_BAR}    ${S_CHECKBOX_LOCKED} ${item.label}`);
          }
          lines.push(`${S_BAR}`);
          lines.push(
            `${S_BAR}  ${S_BAR_H}${S_BAR_H} ${pc.bold('Other agents')} ${S_BAR_H.repeat(34)}`
          );
        }

        // Search input
        const searchLine = `${S_BAR}  ${pc.dim('Search:')} ${query}${pc.inverse(' ')}`;
        lines.push(searchLine);

        // Hint
        lines.push(`${S_BAR}  ${pc.dim('↑↓ move, space select, enter confirm')}`);
        lines.push(`${S_BAR}`);

        // Items
        const visibleStart = Math.max(
          0,
          Math.min(cursor - Math.floor(maxVisible / 2), filtered.length - maxVisible)
        );
        const visibleEnd = Math.min(filtered.length, visibleStart + maxVisible);
        const visibleItems = filtered.slice(visibleStart, visibleEnd);

        if (filtered.length === 0) {
          lines.push(`${S_BAR}  ${pc.dim('No matches found')}`);
        } else {
          let lastGroup: string | undefined;

          for (let i = 0; i < visibleItems.length; i++) {
            const item = visibleItems[i]!;

            // Render group header if group changed
            if (item.group && item.group !== lastGroup) {
              lines.push(`${S_BAR}  ${pc.bold(pc.cyan(item.group))}`);
              lastGroup = item.group;
            } else if (!item.group && lastGroup) {
              // Reset group if we moved from grouped to ungrouped
              lastGroup = undefined;
            }

            const actualIndex = visibleStart + i;
            const isSelected = selected.has(item.value);
            const isCursor = actualIndex === cursor;

            const radio = isSelected ? S_RADIO_ACTIVE : S_RADIO_INACTIVE;
            const label = isCursor ? pc.underline(item.label) : item.label;
            const hint = item.hint ? pc.dim(` (${item.hint})`) : '';

            const prefix = isCursor ? pc.cyan('❯') : ' ';
            lines.push(`${S_BAR} ${prefix} ${radio} ${label}${hint}`);
          }

          // Show count if more items
          const hiddenBefore = visibleStart;
          const hiddenAfter = filtered.length - visibleEnd;
          if (hiddenBefore > 0 || hiddenAfter > 0) {
            const parts: string[] = [];
            if (hiddenBefore > 0) parts.push(`↑ ${hiddenBefore} more`);
            if (hiddenAfter > 0) parts.push(`↓ ${hiddenAfter} more`);
            lines.push(`${S_BAR}  ${pc.dim(parts.join('  '))}`);
          }
        }

        // Selected summary (include locked items)
        lines.push(`${S_BAR}`);
        const allSelectedLabels = [
          ...(lockedSection ? lockedSection.items.map((i) => i.label) : []),
          ...items.filter((item) => selected.has(item.value)).map((item) => item.label),
        ];
        if (allSelectedLabels.length === 0) {
          lines.push(`${S_BAR}  ${pc.dim('Selected: (none)')}`);
        } else {
          const summary =
            allSelectedLabels.length <= 3
              ? allSelectedLabels.join(', ')
              : `${allSelectedLabels.slice(0, 3).join(', ')} +${allSelectedLabels.length - 3} more`;
          lines.push(`${S_BAR}  ${pc.green('Selected:')} ${summary}`);
        }

        lines.push(`${pc.dim('└')}`);
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

      process.stdout.write(lines.join('\n') + '\n');
      lastRenderHeight = lines.length;
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

      const filtered = getFiltered();

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
        cursor = Math.min(filtered.length - 1, cursor + 1);
        render();
        return;
      }

      if (key.name === 'space') {
        const item = filtered[cursor];
        if (item) {
          if (selected.has(item.value)) {
            selected.delete(item.value);
          } else {
            selected.add(item.value);
          }
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
      if (key.sequence && !key.ctrl && !key.meta && key.sequence.length === 1) {
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
