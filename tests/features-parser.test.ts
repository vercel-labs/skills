import { describe, it, expect } from 'vitest';
import { parseFeatures } from '../src/features/parser.ts';

describe('parseFeatures', () => {
  it('returns null when no features field', () => {
    const { declaration, errors } = parseFeatures({ name: 'test' });
    expect(declaration).toBeNull();
    expect(errors).toHaveLength(0);
  });

  it('parses a valid features declaration', () => {
    const { declaration, errors } = parseFeatures({
      features: {
        default: ['app-router', 'typescript'],
        available: {
          'app-router': {
            description: 'Next.js App Router patterns',
            section: 'App Router',
          },
          'pages-router': {
            description: 'Next.js Pages Router patterns',
            section: 'Pages Router',
          },
          typescript: {
            description: 'TypeScript-specific guidance',
            section: 'TypeScript',
          },
          'server-actions': {
            description: 'Server Actions patterns',
            section: 'Server Actions',
            requires: ['app-router'],
          },
        },
        conflicts: [['app-router', 'pages-router']],
      },
    });

    expect(errors).toHaveLength(0);
    expect(declaration).not.toBeNull();
    expect(declaration!.default).toEqual(['app-router', 'typescript']);
    expect(Object.keys(declaration!.available)).toHaveLength(4);
    expect(declaration!.available['server-actions']!.requires).toEqual(['app-router']);
    expect(declaration!.conflicts).toEqual([['app-router', 'pages-router']]);
  });

  it('supports shorthand section notation', () => {
    const { declaration } = parseFeatures({
      features: {
        default: ['basics'],
        available: {
          basics: 'Getting Started',
        },
      },
    });

    expect(declaration!.available['basics']!.section).toBe('Getting Started');
  });

  it('supports "all" default', () => {
    const { declaration } = parseFeatures({
      features: {
        default: 'all',
        available: {
          a: { description: 'A', section: 'A' },
          b: { description: 'B', section: 'B' },
        },
      },
    });

    expect(declaration!.default).toEqual(['a', 'b']);
  });

  it('supports "none" default', () => {
    const { declaration } = parseFeatures({
      features: {
        default: 'none',
        available: {
          a: { description: 'A', section: 'A' },
        },
      },
    });

    expect(declaration!.default).toEqual([]);
  });

  it('errors when default references unknown feature', () => {
    const { errors } = parseFeatures({
      features: {
        default: ['nonexistent'],
        available: {
          real: { description: 'Real', section: 'Real' },
        },
      },
    });

    expect(errors.some((e) => e.message.includes('nonexistent'))).toBe(true);
  });

  it('errors when requires references unknown feature', () => {
    const { errors } = parseFeatures({
      features: {
        default: [],
        available: {
          a: { description: 'A', section: 'A', requires: ['nonexistent'] },
        },
      },
    });

    expect(errors.some((e) => e.message.includes('nonexistent'))).toBe(true);
  });

  it('errors when conflicts references unknown feature', () => {
    const { errors } = parseFeatures({
      features: {
        default: [],
        available: {
          a: { description: 'A', section: 'A' },
        },
        conflicts: [['a', 'nonexistent']],
      },
    });

    expect(errors.some((e) => e.message.includes('nonexistent'))).toBe(true);
  });

  it('returns error for non-object features', () => {
    const { declaration, errors } = parseFeatures({ features: 'invalid' });
    expect(declaration).toBeNull();
    expect(errors).toHaveLength(1);
  });
});
