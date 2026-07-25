/**
 * Unit tests for resolveSkillsToRemove in remove.ts
 *
 * Regression coverage for the "No matching skills found" bug during
 * `skills update`: lock keys can contain characters that sanitizeName()
 * rewrites (e.g. the ':' in plugin skills like "ce:review", whose on-disk
 * folder is "ce-review"). Matching only against on-disk folder names then
 * fails, and stale lock entries whose folder is already gone can never be
 * cleaned — so the deletion warning reappears on every update.
 */

import { describe, it, expect } from 'vitest';
import { buildRemoveChoices, resolveRemoveTargets, resolveSkillsToRemove } from '../src/remove.ts';

describe('resolveSkillsToRemove', () => {
  it('matches a plugin lock key against its sanitized on-disk folder', () => {
    // Requested by the lock key (colon); folder on disk is the sanitized form.
    expect(resolveSkillsToRemove(['ce:review'], ['ce-review'], ['ce:review'])).toEqual([
      'ce:review',
    ]);
  });

  it('matches when the request uses the sanitized folder name', () => {
    // Requested with a hyphen; still resolves to the lock key so lock removal
    // keys off the real entry.
    expect(resolveSkillsToRemove(['ce-review'], ['ce-review'], ['ce:review'])).toEqual([
      'ce:review',
    ]);
  });

  it('resolves stale lock-only entries whose folder is already gone', () => {
    // The on-disk folder was already removed but the lock still tracks it.
    expect(resolveSkillsToRemove(['ce:review'], [], ['ce:review'])).toEqual(['ce:review']);
  });

  it('prefers the lock key over the on-disk folder identity', () => {
    // Both present: the returned identity must be the lock key so that
    // downstream lock removal succeeds (disk cleanup re-sanitizes anyway).
    expect(resolveSkillsToRemove(['ce:review'], ['ce-review'], ['ce:review'])).not.toContain(
      'ce-review'
    );
  });

  it('handles ordinary skills where folder name equals lock key', () => {
    expect(resolveSkillsToRemove(['my-skill'], ['my-skill'], ['my-skill'])).toEqual(['my-skill']);
  });

  it('falls back to folder matching when no lock keys are supplied', () => {
    // Untracked skills still resolve from their on-disk folder identity.
    expect(resolveSkillsToRemove(['ce:review'], ['ce-review'])).toEqual(['ce-review']);
  });

  it('matches case-insensitively', () => {
    expect(resolveSkillsToRemove(['CE:Review'], ['ce-review'], ['ce:review'])).toEqual([
      'ce:review',
    ]);
  });

  it('returns an empty array when nothing matches', () => {
    expect(resolveSkillsToRemove(['does-not-exist'], ['ce-review'], ['ce:review'])).toEqual([]);
  });

  it('deduplicates when multiple requests resolve to the same identity', () => {
    expect(resolveSkillsToRemove(['ce:review', 'ce-review'], ['ce-review'], ['ce:review'])).toEqual(
      ['ce:review']
    );
  });

  it('resolves every candidate for a bulk (--all style) request', () => {
    const installed = ['ce-review', 'my-skill'];
    const lockKeys = ['ce:review', 'my-skill'];
    const result = resolveSkillsToRemove([...installed, ...lockKeys], installed, lockKeys);
    expect(new Set(result)).toEqual(new Set(['ce:review', 'my-skill']));
  });

  it('groups installed and stale skills by their exact lock source', () => {
    expect(
      buildRemoveChoices(['beta', 'untracked'], {
        alpha: { source: 'mattpocock/skills', ref: 'main' },
        beta: { source: 'mattpocock/skills', ref: 'other-ref' },
        stale: { source: 'https://github.com/mattpocock/skills' },
      })
    ).toEqual([
      { value: 'alpha', label: 'alpha', group: 'mattpocock/skills' },
      { value: 'beta', label: 'beta', group: 'mattpocock/skills' },
      { value: 'stale', label: 'stale', group: 'https://github.com/mattpocock/skills' },
      { value: 'untracked', label: 'untracked', group: 'Unknown source' },
    ]);
  });

  it('expands an exact source argument to every matching lock entry', () => {
    expect(
      resolveRemoveTargets(['mattpocock/skills'], ['review', 'design'], {
        review: { source: 'mattpocock/skills' },
        design: { source: 'mattpocock/skills', ref: 'dev' },
        other: { source: 'MATTPOCOCK/SKILLS' },
      })
    ).toEqual(['design', 'review']);
  });

  it('preserves lock entries whose names sanitize to the same folder', () => {
    const lockEntries = {
      'foo:bar': { source: 'one' },
      'foo-bar': { source: 'two' },
    };
    const choices = buildRemoveChoices(['foo-bar'], lockEntries);

    expect(choices).toHaveLength(2);
    expect(choices).toEqual(
      expect.arrayContaining([
        { value: 'foo:bar', label: 'foo:bar', group: 'one' },
        { value: 'foo-bar', label: 'foo-bar', group: 'two' },
      ])
    );
    expect(resolveRemoveTargets(['one'], ['foo-bar'], lockEntries)).toEqual(['foo:bar']);
    expect(resolveRemoveTargets(['foo-bar'], ['foo-bar'], lockEntries)).toEqual(['foo-bar']);
  });

  it('gives an exact case-insensitive skill name precedence over a source', () => {
    expect(
      resolveRemoveTargets(['review'], ['review', 'other'], {
        review: { source: 'review' },
        other: { source: 'review' },
      })
    ).toEqual(['review']);
  });

  it('matches an exact source without normalizing shorthand or URL forms', () => {
    expect(
      resolveRemoveTargets(['https://github.com/mattpocock/skills'], [], {
        shorthand: { source: 'mattpocock/skills' },
        https: { source: 'https://github.com/mattpocock/skills' },
      })
    ).toEqual(['https']);
  });

  it('does not normalize a source that resembles a skill name', () => {
    expect(
      resolveRemoveTargets(['owner/repo'], ['owner-repo'], {
        'owner-repo': { source: 'other/source' },
        fromRepo: { source: 'owner/repo' },
      })
    ).toEqual(['fromRepo']);
  });

  it('assigns lock entries without a source to Unknown source', () => {
    expect(buildRemoveChoices([], { unattributed: {} })).toEqual([
      { value: 'unattributed', label: 'unattributed', group: 'Unknown source' },
    ]);
  });
});
