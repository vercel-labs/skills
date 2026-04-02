import type { FeatureDeclaration } from './parser.ts';

export interface ResolvedFeatures {
  requested: string[];
  resolved: string[];
}

/**
 * Resolve a set of requested features by expanding dependencies
 * and checking for conflicts.
 *
 * Throws an error if:
 * - A requested feature doesn't exist in the declaration
 * - Conflicting features are both activated
 * - A circular dependency is detected
 */
export function resolveFeatures(
  requested: string[],
  declaration: FeatureDeclaration
): ResolvedFeatures {
  const { available, conflicts } = declaration;

  // Validate all requested features exist
  for (const name of requested) {
    if (!available[name]) {
      throw new Error(
        `Unknown feature: "${name}". Available: ${Object.keys(available).join(', ')}`
      );
    }
  }

  // Expand dependencies
  const resolved = new Set<string>();
  const visiting = new Set<string>();

  function expand(name: string): void {
    if (resolved.has(name)) return;
    if (visiting.has(name)) {
      throw new Error(`Circular dependency detected involving feature "${name}"`);
    }

    visiting.add(name);
    const info = available[name];
    if (info?.requires) {
      for (const req of info.requires) {
        expand(req);
      }
    }
    visiting.delete(name);
    resolved.add(name);
  }

  for (const name of requested) {
    expand(name);
  }

  // Check conflicts
  if (conflicts) {
    for (const pair of conflicts) {
      const active = pair.filter((name) => resolved.has(name));
      if (active.length > 1) {
        throw new Error(`Conflicting features: ${active.join(' and ')} cannot be used together`);
      }
    }
  }

  return {
    requested,
    resolved: Array.from(resolved),
  };
}
