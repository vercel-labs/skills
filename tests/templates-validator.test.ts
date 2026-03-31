import { describe, it, expect } from 'vitest';
import { validateParams } from '../src/templates/validator.ts';
import type { TemplateConfig } from '../src/templates/parser.ts';

const config: TemplateConfig = {
  parameters: {
    dir: { description: 'Dir', type: 'string' },
    framework: {
      description: 'Framework',
      type: 'enum',
      options: ['react', 'vue', 'svelte'],
    },
    debug: { description: 'Debug', type: 'boolean', default: false },
    count: { description: 'Count', type: 'number', default: 3 },
    extra: { description: 'Extra', type: 'string', optional: true },
  },
};

describe('validateParams', () => {
  it('returns no errors for valid params', () => {
    const errors = validateParams(
      { dir: 'src', framework: 'react', debug: true, count: 5 },
      config
    );
    expect(errors).toEqual([]);
  });

  it('errors on missing required param', () => {
    const errors = validateParams({ framework: 'react' }, config);
    const dirError = errors.find((e) => e.param === 'dir');
    expect(dirError).toBeDefined();
    expect(dirError!.message).toContain('required');
  });

  it('does not error on missing param with default', () => {
    const errors = validateParams({ dir: 'src', framework: 'react' }, config);
    // debug and count have defaults, so no error
    const debugError = errors.find((e) => e.param === 'debug');
    expect(debugError).toBeUndefined();
  });

  it('does not error on missing optional param', () => {
    const errors = validateParams({ dir: 'src', framework: 'react' }, config);
    const extraError = errors.find((e) => e.param === 'extra');
    expect(extraError).toBeUndefined();
  });

  it('errors on wrong type for string', () => {
    const errors = validateParams({ dir: 42 as any, framework: 'react' }, config);
    const dirError = errors.find((e) => e.param === 'dir');
    expect(dirError).toBeDefined();
    expect(dirError!.message).toContain('expected string');
  });

  it('errors on wrong type for boolean', () => {
    const errors = validateParams({ dir: 'src', framework: 'react', debug: 'yes' as any }, config);
    const debugError = errors.find((e) => e.param === 'debug');
    expect(debugError).toBeDefined();
  });

  it('errors on invalid enum value', () => {
    const errors = validateParams({ dir: 'src', framework: 'angular' }, config);
    const fwError = errors.find((e) => e.param === 'framework');
    expect(fwError).toBeDefined();
    expect(fwError!.message).toContain('not a valid option');
  });

  it('errors on unknown parameter', () => {
    const errors = validateParams({ dir: 'src', framework: 'react', unknown: 'val' }, config);
    const unknownError = errors.find((e) => e.param === 'unknown');
    expect(unknownError).toBeDefined();
    expect(unknownError!.message).toContain('unknown parameter');
  });

  it('errors on wrong type for number', () => {
    const errors = validateParams(
      { dir: 'src', framework: 'react', count: 'three' as any },
      config
    );
    const countError = errors.find((e) => e.param === 'count');
    expect(countError).toBeDefined();
  });
});
