import { describe, expect, it } from 'vitest';
import { buildSearchEntries, toggleSearchEntry, type SearchItem } from './search-multiselect';

const items: SearchItem<string>[] = [
  { value: 'ask-matt', label: 'ask-matt', group: 'Engineering' },
  { value: 'tdd', label: 'tdd', group: 'Engineering' },
  { value: 'kmp-module-setup', label: 'kmp-module-setup', group: 'Team Mobile' },
  { value: 'kmp-test-seams', label: 'kmp-test-seams', group: 'Team Mobile' },
  { value: 'loose-skill', label: 'loose-skill' },
];

/** The prompt's own filter: substring match on label or value, case-insensitive. */
const filterBy = (query: string): SearchItem<string>[] =>
  items.filter(
    (item) =>
      item.label.toLowerCase().includes(query.toLowerCase()) ||
      String(item.value).toLowerCase().includes(query.toLowerCase())
  );

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

  it('reveals matches inside a collapsed group when the collapse set is ignored', () => {
    // What the prompt does while a query is active: a filter is a temporary
    // view, so it wins over the persistent collapse preference. Without this,
    // typing a skill's exact name reports nothing when its group is collapsed.
    const collapsed = new Set(['Engineering']);
    expect(itemValues(buildSearchEntries(filterBy('tdd'), true, collapsed))).toEqual([]);
    expect(itemValues(buildSearchEntries(filterBy('tdd'), true, new Set()))).toEqual(['tdd']);
    // The preference itself is untouched — it is read, never cleared.
    expect(collapsed.has('Engineering')).toBe(true);
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
