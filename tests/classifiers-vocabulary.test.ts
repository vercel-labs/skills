import { describe, it, expect } from 'vitest';
import {
  parseClassifier,
  validateClassifier,
  getAgentDisplayNames,
  getCategories,
  CLASSIFIER_VOCABULARY,
} from '../src/classifiers/vocabulary.ts';

describe('parseClassifier', () => {
  it('parses a simple classifier', () => {
    const result = parseClassifier('Domain :: Frontend');
    expect(result).toEqual({ category: 'Domain', value: 'Frontend', subvalue: undefined });
  });

  it('parses a classifier with subvalue', () => {
    const result = parseClassifier('Product :: Next.js :: 15');
    expect(result).toEqual({ category: 'Product', value: 'Next.js', subvalue: '15' });
  });

  it('returns null for invalid format', () => {
    expect(parseClassifier('just-a-string')).toBeNull();
    expect(parseClassifier('')).toBeNull();
  });

  it('trims whitespace', () => {
    const result = parseClassifier('  Domain  ::  Frontend  ');
    expect(result).toEqual({ category: 'Domain', value: 'Frontend', subvalue: undefined });
  });
});

describe('validateClassifier', () => {
  it('validates a known classifier', () => {
    expect(validateClassifier('Domain :: Frontend')).toBeNull();
    expect(validateClassifier('Type :: Patterns')).toBeNull();
    expect(validateClassifier('Complexity :: Intermediate')).toBeNull();
  });

  it('validates Agent :: Universal', () => {
    expect(validateClassifier('Agent :: Universal')).toBeNull();
  });

  it('validates Agent :: Claude Code', () => {
    expect(validateClassifier('Agent :: Claude Code')).toBeNull();
  });

  it('validates open-ended categories', () => {
    expect(validateClassifier('Product :: React :: 19')).toBeNull();
    expect(validateClassifier('License :: MIT')).toBeNull();
    expect(validateClassifier('Product :: Anything')).toBeNull();
  });

  it('warns on unknown category', () => {
    const warning = validateClassifier('Unknown :: Value');
    expect(warning).toContain('Unknown classifier category');
  });

  it('warns on unknown domain value', () => {
    const warning = validateClassifier('Domain :: Quantum');
    expect(warning).toContain('Unknown Domain value');
  });

  it('warns on unknown agent', () => {
    const warning = validateClassifier('Agent :: NonExistentAgent');
    expect(warning).toContain('Unknown agent');
  });

  it('warns on invalid format', () => {
    const warning = validateClassifier('no-separator');
    expect(warning).toContain('Invalid classifier format');
  });
});

describe('getAgentDisplayNames', () => {
  it('returns an array of agent names', () => {
    const names = getAgentDisplayNames();
    expect(names.length).toBeGreaterThan(0);
    expect(names).toContain('Claude Code');
    expect(names).toContain('Cursor');
  });
});

describe('getCategories', () => {
  it('returns all category names', () => {
    const cats = getCategories();
    expect(cats).toContain('Agent');
    expect(cats).toContain('Domain');
    expect(cats).toContain('Product');
    expect(cats).toContain('Type');
    expect(cats).toContain('Complexity');
    expect(cats).toContain('License');
  });
});

describe('CLASSIFIER_VOCABULARY', () => {
  it('has expected structure', () => {
    expect(CLASSIFIER_VOCABULARY.Domain.values).toContain('Frontend');
    expect(CLASSIFIER_VOCABULARY.Type.values).toContain('Patterns');
    expect(CLASSIFIER_VOCABULARY.Product.openEnded).toBe(true);
    expect(CLASSIFIER_VOCABULARY.License.openEnded).toBe(true);
  });
});
