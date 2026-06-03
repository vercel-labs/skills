import { agents } from '../agents.ts';

export interface ClassifierCategory {
  name: string;
  description: string;
  values: string[];
  openEnded?: boolean;
}

/**
 * Controlled vocabulary for skill classifiers.
 * Product and License categories are open-ended (any value accepted).
 */
export const CLASSIFIER_VOCABULARY: Record<string, ClassifierCategory> = {
  Agent: {
    name: 'Agent',
    description: 'Compatible coding agents',
    values: ['Universal'],
  },
  Domain: {
    name: 'Domain',
    description: 'Application domain',
    values: [
      'Frontend',
      'Backend',
      'DevOps',
      'Mobile',
      'Data',
      'Security',
      'Testing',
      'Documentation',
    ],
  },
  Product: {
    name: 'Product',
    description: 'Specific product or framework',
    values: [],
    openEnded: true,
  },
  Type: {
    name: 'Type',
    description: 'Skill type',
    values: ['Patterns', 'Setup', 'Debugging', 'Migration', 'Review', 'Testing', 'Workflow'],
  },
  Complexity: {
    name: 'Complexity',
    description: 'Target expertise level',
    values: ['Beginner', 'Intermediate', 'Advanced'],
  },
  License: {
    name: 'License',
    description: 'License type',
    values: [],
    openEnded: true,
  },
};

export interface ParsedClassifier {
  category: string;
  value: string;
  subvalue?: string;
}

/**
 * Parse a classifier string like "Domain :: Frontend" into parts.
 */
export function parseClassifier(classifier: string): ParsedClassifier | null {
  const parts = classifier.split('::').map((p) => p.trim());
  if (parts.length < 2 || !parts[0] || !parts[1]) return null;
  return {
    category: parts[0],
    value: parts[1],
    subvalue: parts[2] || undefined,
  };
}

/**
 * Get all valid agent display names for use as Agent classifiers.
 */
export function getAgentDisplayNames(): string[] {
  return Object.values(agents).map((a) => a.displayName);
}

/**
 * Check if a classifier string is valid against the vocabulary.
 * Returns a warning message if invalid, or null if valid.
 */
export function validateClassifier(classifier: string): string | null {
  const parsed = parseClassifier(classifier);
  if (!parsed) {
    return `Invalid classifier format: "${classifier}". Expected "Category :: Value"`;
  }

  const category = CLASSIFIER_VOCABULARY[parsed.category];
  if (!category) {
    return `Unknown classifier category: "${parsed.category}"`;
  }

  // Open-ended categories accept any value
  if (category.openEnded) return null;

  // Agent category: check against display names + "Universal"
  if (parsed.category === 'Agent') {
    const validAgents = ['Universal', ...getAgentDisplayNames()];
    if (!validAgents.includes(parsed.value)) {
      return `Unknown agent: "${parsed.value}"`;
    }
    return null;
  }

  // Check value against vocabulary
  if (category.values.length > 0 && !category.values.includes(parsed.value)) {
    return `Unknown ${parsed.category} value: "${parsed.value}". Valid: ${category.values.join(', ')}`;
  }

  return null;
}

/**
 * Get all valid classifier categories.
 */
export function getCategories(): string[] {
  return Object.keys(CLASSIFIER_VOCABULARY);
}
