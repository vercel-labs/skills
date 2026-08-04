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
import { resolveSkillsToRemove } from '../src/remove.ts';

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
});
