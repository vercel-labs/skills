import { sanitizeName } from './installer.ts';

/**
 * Resolve the actual key stored in a lock for a given skill name.
 *
 * Lock entries are keyed by the raw skill name (e.g. from SKILL.md frontmatter),
 * but callers such as the remove command derive the name from on-disk directory
 * names, which are sanitized (lowercased, special chars hyphenated). When the raw
 * name differs from its sanitized form, an exact lookup misses and the entry is
 * orphaned (#577, #808).
 *
 * Resolves to the exact key if present, otherwise the first key whose sanitized
 * form matches the requested name. Works for both the global and local locks.
 *
 * @returns The matching stored key, or null if no entry matches.
 */
export function resolveLockKey<T>(skills: Record<string, T>, skillName: string): string | null {
  if (skillName in skills) {
    return skillName;
  }

  const target = sanitizeName(skillName);
  for (const key of Object.keys(skills)) {
    if (sanitizeName(key) === target) {
      return key;
    }
  }

  return null;
}
