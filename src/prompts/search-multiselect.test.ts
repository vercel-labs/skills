import { describe, expect, it } from 'vitest';
import {
  activeCollapsedGroups,
  buildSearchEntries,
  collapseKeysActive,
  filterSearchItems,
  toggleSearchEntry,
  type SearchItem,
} from './search-multiselect';

const items: SearchItem<string>[] = [
  { value: 'ask-matt', label: 'ask-matt', group: 'Engineering' },
  { value: 'tdd', label: 'tdd', group: 'Engineering' },
  { value: 'kmp-module-setup', label: 'kmp-module-setup', group: 'Team Mobile' },
  { value: 'kmp-test-seams', label: 'kmp-test-seams', group: 'Team Mobile' },
  { value: 'loose-skill', label: 'loose-skill' },
];

/** The prompt's own filter, imported rather than reimplemented so it cannot drift. */
const filterBy = (query: string): SearchItem<string>[] => filterSearchItems(items, query);

const groupNames = (entries: ReturnType<typeof buildSearchEntries<string>>) =>
  entries.filter((e) => e.type === 'group').map((e) => (e.type === 'group' ? e.group : ''));

const itemValues = (entries: ReturnType<typeof buildSearchEntries<string>>) =>
  entries.filter((e) => e.type === 'item').map((e) => (e.type === 'item' ? e.item.value : ''));

describe('buildSearchEntries with groups', () => {
  it('groups items and keeps ungrouped items as plain rows', () => {
    const entries = buildSearchEntries(items, true);
    expect(groupNames(entries)).toEqual(['Engineering', 'Team Mobile']);
    expect(itemValues(entries)).toContain('loose-skill');
  });

  it('filters within groups and drops groups with no matches', () => {
    const entries = buildSearchEntries(filterBy('kmp'), true);
    expect(groupNames(entries)).toEqual(['Team Mobile']);
    expect(itemValues(entries)).toEqual(['kmp-module-setup', 'kmp-test-seams']);
  });

  it('hides a collapsed group’s items but keeps its heading', () => {
    const entries = buildSearchEntries(items, true, new Set(['Engineering']));
    expect(groupNames(entries)).toEqual(['Engineering', 'Team Mobile']);
    expect(itemValues(entries)).not.toContain('tdd');
    expect(itemValues(entries)).toContain('kmp-module-setup');
  });

  it('reveals matches inside a manually-collapsed group while a query is active', () => {
    // The regression this PR fixes, wired the way the prompt wires it: the
    // collapse set goes through activeCollapsedGroups rather than being blanked
    // by hand. Without it, typing a skill's exact name reports nothing because
    // its group was collapsed earlier.
    const collapsed = new Set(['Engineering']);

    const idle = buildSearchEntries(filterBy(''), true, activeCollapsedGroups('', collapsed));
    expect(itemValues(idle)).not.toContain('tdd');

    const searching = buildSearchEntries(
      filterBy('tdd'),
      true,
      activeCollapsedGroups('tdd', collapsed)
    );
    expect(itemValues(searching)).toEqual(['tdd']);

    // The preference itself is untouched — it is read, never cleared.
    expect(collapsed.has('Engineering')).toBe(true);
    expect(
      itemValues(buildSearchEntries(items, true, activeCollapsedGroups('', collapsed)))
    ).not.toContain('tdd');
  });
});

describe('activeCollapsedGroups', () => {
  it('honours the collapse preference when no query is active', () => {
    const collapsed = new Set(['Engineering']);
    expect(activeCollapsedGroups('', collapsed)).toBe(collapsed);
  });

  it('ignores the collapse preference while a query is active, without clearing it', () => {
    const collapsed = new Set(['Engineering']);
    expect([...activeCollapsedGroups('kmp', collapsed)]).toEqual([]);
    expect([...collapsed]).toEqual(['Engineering']);
  });
});

describe('collapseKeysActive', () => {
  it('enables ←/→ only when grouping is on and no query is active', () => {
    expect(collapseKeysActive(true, '')).toBe(true);
  });

  it('makes both ←/→ no-ops while a query is active', () => {
    // Read-only during search. Previously ← still wrote to the collapse set
    // while → was guarded by entry.collapsed — always false while filtering —
    // so collapse state accumulated with no way to undo it until the query
    // cleared. Neither key may act unless this predicate is true.
    expect(collapseKeysActive(true, 'kmp')).toBe(false);
  });

  it('stays off when grouping is disabled', () => {
    expect(collapseKeysActive(false, '')).toBe(false);
    expect(collapseKeysActive(false, 'kmp')).toBe(false);
  });
});

describe('toggleSearchEntry on a group heading', () => {
  it('selects every item the group currently shows', () => {
    const entries = buildSearchEntries(items, true);
    const selected = new Set<string>();
    toggleSearchEntry(
      selected,
      entries.find((e) => e.type === 'group')
    );
    expect([...selected].sort()).toEqual(['ask-matt', 'tdd']);
  });

  it('selects only the visible matches while filtered, never the hidden ones', () => {
    const entries = buildSearchEntries(filterBy('kmp-test'), true);
    const selected = new Set<string>();
    toggleSearchEntry(
      selected,
      entries.find((e) => e.type === 'group')
    );
    // kmp-module-setup shares the group but does not match the query, so a
    // single keystroke must not install something the user cannot see.
    expect([...selected]).toEqual(['kmp-test-seams']);
  });

  it('deselects a group only when every shown item is already selected', () => {
    const entries = buildSearchEntries(items, true);
    const group = entries.find((e) => e.type === 'group');
    const selected = new Set<string>(['ask-matt']);
    toggleSearchEntry(selected, group);
    expect([...selected].sort()).toEqual(['ask-matt', 'tdd']);
    toggleSearchEntry(selected, group);
    expect([...selected]).toEqual([]);
  });
});
