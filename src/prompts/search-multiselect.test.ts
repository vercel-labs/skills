import { describe, it, expect } from 'vitest';
import { toggleSelectAll } from './search-multiselect.ts';

describe('toggleSelectAll', () => {
  it('selects every filtered item when none are selected', () => {
    const selected = new Set<string>();
    const filtered = [
      { value: 'a', label: 'A' },
      { value: 'b', label: 'B' },
      { value: 'c', label: 'C' },
    ];
    toggleSelectAll(selected, filtered);
    expect([...selected]).toEqual(['a', 'b', 'c']);
  });

  it('deselects everything when all filtered items are already selected', () => {
    const selected = new Set(['a', 'b', 'c']);
    const filtered = [
      { value: 'a', label: 'A' },
      { value: 'b', label: 'B' },
      { value: 'c', label: 'C' },
    ];
    toggleSelectAll(selected, filtered);
    expect(selected.size).toBe(0);
  });

  it('selects only the filtered subset, ignoring items filtered out by search', () => {
    const selected = new Set(['x']);
    const filtered = [
      { value: 'a', label: 'A' },
      { value: 'b', label: 'B' },
    ];
    toggleSelectAll(selected, filtered);
    expect([...selected].sort()).toEqual(['a', 'b', 'x']);
  });
});
