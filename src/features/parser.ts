export interface FeatureInfo {
  description: string;
  section: string;
  requires?: string[];
}

export interface FeatureDeclaration {
  default: string[];
  available: Record<string, FeatureInfo>;
  conflicts?: string[][];
}

export interface ParseError {
  field: string;
  message: string;
}

export interface ParseResult {
  declaration: FeatureDeclaration | null;
  errors: ParseError[];
}

/**
 * Parse a features declaration from SKILL.md frontmatter.
 * Returns null if no features field is present (skill has no feature flags).
 */
export function parseFeatures(frontmatter: Record<string, unknown>): ParseResult {
  if (!frontmatter.features) {
    return { declaration: null, errors: [] };
  }

  const features = frontmatter.features;
  if (typeof features !== 'object' || features === null) {
    return { declaration: null, errors: [{ field: 'features', message: 'must be an object' }] };
  }

  const obj = features as Record<string, unknown>;
  const errors: ParseError[] = [];

  // Parse available
  const available: Record<string, FeatureInfo> = {};
  if (obj.available && typeof obj.available === 'object' && obj.available !== null) {
    const avail = obj.available as Record<string, unknown>;
    for (const [key, value] of Object.entries(avail)) {
      if (typeof value === 'object' && value !== null) {
        const feat = value as Record<string, unknown>;
        const description = typeof feat.description === 'string' ? feat.description : '';
        const section = typeof feat.section === 'string' ? feat.section : key;
        const requires = Array.isArray(feat.requires)
          ? feat.requires.filter((r): r is string => typeof r === 'string')
          : undefined;
        available[key] = { description, section, requires };
      } else if (typeof value === 'string') {
        // Shorthand: feature-name: "Section Heading"
        available[key] = { description: '', section: value };
      }
    }
  } else {
    errors.push({ field: 'features.available', message: 'must be an object' });
  }

  // Parse defaults
  let defaults: string[] = [];
  if (Array.isArray(obj.default)) {
    defaults = obj.default.filter((d): d is string => typeof d === 'string');
  } else if (obj.default === 'all') {
    defaults = Object.keys(available);
  } else if (obj.default === 'none') {
    defaults = [];
  }

  // Validate defaults reference available features
  for (const d of defaults) {
    if (!available[d]) {
      errors.push({ field: 'features.default', message: `references unknown feature "${d}"` });
    }
  }

  // Parse conflicts
  let conflicts: string[][] | undefined;
  if (Array.isArray(obj.conflicts)) {
    conflicts = obj.conflicts
      .filter((c): c is unknown[] => Array.isArray(c))
      .map((c) => c.filter((item): item is string => typeof item === 'string'));

    // Validate conflict references
    for (const pair of conflicts) {
      for (const name of pair) {
        if (!available[name]) {
          errors.push({
            field: 'features.conflicts',
            message: `references unknown feature "${name}"`,
          });
        }
      }
    }
  }

  // Validate requires references
  for (const [name, info] of Object.entries(available)) {
    if (info.requires) {
      for (const req of info.requires) {
        if (!available[req]) {
          errors.push({
            field: `features.available.${name}.requires`,
            message: `references unknown feature "${req}"`,
          });
        }
      }
    }
  }

  return {
    declaration: { default: defaults, available, conflicts },
    errors,
  };
}
