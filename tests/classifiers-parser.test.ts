import { describe, it, expect } from 'vitest';
import { parseClassifiers, formatClassifiers } from '../src/classifiers/parser.ts';

describe('parseClassifiers', () => {
  it('returns null when no classifiers field', () => {
    expect(parseClassifiers({ name: 'test' })).toBeNull();
  });

  it('returns warnings when classifiers is not an array', () => {
    const result = parseClassifiers({ classifiers: 'invalid' });
    expect(result).not.toBeNull();
    expect(result!.warnings).toHaveLength(1);
    expect(result!.raw).toEqual([]);
  });

  it('parses valid classifiers', () => {
    const result = parseClassifiers({
      classifiers: [
        'Agent :: Claude Code',
        'Domain :: Frontend',
        'Type :: Patterns',
        'Product :: Next.js :: 15',
      ],
    });
    expect(result).not.toBeNull();
    expect(result!.raw).toHaveLength(4);
    expect(result!.byCategory.Agent).toEqual(['Claude Code']);
    expect(result!.byCategory.Domain).toEqual(['Frontend']);
    expect(result!.byCategory.Type).toEqual(['Patterns']);
    expect(result!.byCategory.Product).toEqual(['Next.js :: 15']);
  });

  it('extracts agent names', () => {
    const result = parseClassifiers({
      classifiers: ['Agent :: Claude Code', 'Agent :: Cursor'],
    });
    expect(result!.agents).toEqual(['Claude Code', 'Cursor']);
  });

  it('handles Universal agent', () => {
    const result = parseClassifiers({
      classifiers: ['Agent :: Universal'],
    });
    expect(result!.agents).toEqual(['Universal']);
  });

  it('collects warnings for invalid classifiers', () => {
    const result = parseClassifiers({
      classifiers: ['Domain :: Frontend', 'Unknown :: Thing'],
    });
    expect(result!.warnings.length).toBeGreaterThan(0);
    expect(result!.warnings[0]).toContain('Unknown classifier category');
  });

  it('filters non-string values', () => {
    const result = parseClassifiers({
      classifiers: ['Domain :: Frontend', 42, null, 'Type :: Patterns'],
    });
    expect(result!.raw).toEqual(['Domain :: Frontend', 'Type :: Patterns']);
  });

  it('groups multiple values in same category', () => {
    const result = parseClassifiers({
      classifiers: ['Domain :: Frontend', 'Domain :: Backend'],
    });
    expect(result!.byCategory.Domain).toEqual(['Frontend', 'Backend']);
  });
});

describe('formatClassifiers', () => {
  it('formats classifiers for display (excluding Agent)', () => {
    const result = parseClassifiers({
      classifiers: [
        'Agent :: Claude Code',
        'Domain :: Frontend',
        'Type :: Patterns',
        'Complexity :: Intermediate',
      ],
    })!;
    const formatted = formatClassifiers(result);
    expect(formatted).toBe('Domain: Frontend | Type: Patterns | Complexity: Intermediate');
    expect(formatted).not.toContain('Agent');
  });

  it('handles multiple values in a category', () => {
    const result = parseClassifiers({
      classifiers: ['Domain :: Frontend', 'Domain :: Backend'],
    })!;
    const formatted = formatClassifiers(result);
    expect(formatted).toBe('Domain: Frontend, Backend');
  });

  it('returns empty string when only Agent classifiers', () => {
    const result = parseClassifiers({
      classifiers: ['Agent :: Universal'],
    })!;
    expect(formatClassifiers(result)).toBe('');
  });
});
