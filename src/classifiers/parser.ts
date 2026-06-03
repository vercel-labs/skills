import { parseClassifier, validateClassifier } from './vocabulary.ts';

export interface ParsedClassifiers {
  raw: string[];
  byCategory: Record<string, string[]>;
  agents: string[];
  warnings: string[];
}

/**
 * Parse classifiers from SKILL.md frontmatter.
 * Returns null if no classifiers field is present.
 */
export function parseClassifiers(frontmatter: Record<string, unknown>): ParsedClassifiers | null {
  if (!frontmatter.classifiers) return null;

  if (!Array.isArray(frontmatter.classifiers)) {
    return {
      raw: [],
      byCategory: {},
      agents: [],
      warnings: ['classifiers must be an array of strings'],
    };
  }

  const raw = frontmatter.classifiers.filter((c): c is string => typeof c === 'string');
  const byCategory: Record<string, string[]> = {};
  const agents: string[] = [];
  const warnings: string[] = [];

  for (const classifier of raw) {
    const warning = validateClassifier(classifier);
    if (warning) {
      warnings.push(warning);
    }

    const parsed = parseClassifier(classifier);
    if (!parsed) continue;

    if (!byCategory[parsed.category]) {
      byCategory[parsed.category] = [];
    }
    const fullValue = parsed.subvalue ? `${parsed.value} :: ${parsed.subvalue}` : parsed.value;
    byCategory[parsed.category].push(fullValue);

    if (parsed.category === 'Agent') {
      agents.push(parsed.value);
    }
  }

  return { raw, byCategory, agents, warnings };
}

/**
 * Format classifiers for compact display.
 * Returns a string like "Domain: Frontend | Type: Patterns | Complexity: Intermediate"
 */
export function formatClassifiers(classifiers: ParsedClassifiers): string {
  const parts: string[] = [];

  for (const [category, values] of Object.entries(classifiers.byCategory)) {
    if (category === 'Agent') continue; // Agents shown separately
    parts.push(`${category}: ${values.join(', ')}`);
  }

  return parts.join(' | ');
}
