import { describe, it, expect } from 'vitest';
import { resolveFeatures } from '../src/features/resolver.ts';
import type { FeatureDeclaration } from '../src/features/parser.ts';

const sampleDeclaration: FeatureDeclaration = {
  default: ['app-router'],
  available: {
    'app-router': { description: 'App Router', section: 'App Router' },
    'pages-router': { description: 'Pages Router', section: 'Pages Router' },
    typescript: { description: 'TypeScript', section: 'TypeScript' },
    'server-actions': {
      description: 'Server Actions',
      section: 'Server Actions',
      requires: ['app-router'],
    },
    advanced: {
      description: 'Advanced',
      section: 'Advanced',
      requires: ['typescript'],
    },
  },
  conflicts: [['app-router', 'pages-router']],
};

describe('resolveFeatures', () => {
  it('resolves simple features without dependencies', () => {
    const result = resolveFeatures(['typescript'], sampleDeclaration);
    expect(result.requested).toEqual(['typescript']);
    expect(result.resolved).toEqual(['typescript']);
  });

  it('expands dependencies', () => {
    const result = resolveFeatures(['server-actions'], sampleDeclaration);
    expect(result.resolved).toContain('server-actions');
    expect(result.resolved).toContain('app-router');
  });

  it('expands transitive dependencies', () => {
    const result = resolveFeatures(['advanced'], sampleDeclaration);
    expect(result.resolved).toContain('advanced');
    expect(result.resolved).toContain('typescript');
  });

  it('deduplicates resolved features', () => {
    const result = resolveFeatures(['app-router', 'server-actions'], sampleDeclaration);
    const appRouterCount = result.resolved.filter((f) => f === 'app-router').length;
    expect(appRouterCount).toBe(1);
  });

  it('throws on unknown feature', () => {
    expect(() => resolveFeatures(['nonexistent'], sampleDeclaration)).toThrow('Unknown feature');
  });

  it('throws on conflicting features', () => {
    expect(() => resolveFeatures(['app-router', 'pages-router'], sampleDeclaration)).toThrow(
      'Conflicting features'
    );
  });

  it('throws on conflict from dependency expansion', () => {
    expect(() => resolveFeatures(['server-actions', 'pages-router'], sampleDeclaration)).toThrow(
      'Conflicting features'
    );
  });

  it('detects circular dependencies', () => {
    const circular: FeatureDeclaration = {
      default: [],
      available: {
        a: { description: 'A', section: 'A', requires: ['b'] },
        b: { description: 'B', section: 'B', requires: ['a'] },
      },
    };

    expect(() => resolveFeatures(['a'], circular)).toThrow('Circular dependency');
  });

  it('resolves empty feature list', () => {
    const result = resolveFeatures([], sampleDeclaration);
    expect(result.resolved).toEqual([]);
  });
});
