import { describe, it, expect } from 'vitest';
import { parseTemplateConfig } from '../src/templates/parser.ts';

describe('parseTemplateConfig', () => {
  it('returns null config when no parameters field', () => {
    const result = parseTemplateConfig({ name: 'test' });
    expect(result.config).toBeNull();
    expect(result.errors).toEqual([]);
  });

  it('returns error when parameters is not an object', () => {
    const result = parseTemplateConfig({ parameters: 'invalid' });
    expect(result.config).toBeNull();
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.message).toContain('must be an object');
  });

  it('parses a string parameter', () => {
    const result = parseTemplateConfig({
      parameters: {
        component_dir: {
          description: 'Component directory',
          type: 'string',
          default: 'src/components',
        },
      },
    });
    expect(result.errors).toEqual([]);
    expect(result.config?.parameters.component_dir).toEqual({
      description: 'Component directory',
      type: 'string',
      default: 'src/components',
    });
  });

  it('parses an enum parameter with options', () => {
    const result = parseTemplateConfig({
      parameters: {
        framework: {
          description: 'Framework',
          type: 'enum',
          options: ['react', 'vue', 'svelte'],
          default: 'react',
        },
      },
    });
    expect(result.errors).toEqual([]);
    expect(result.config?.parameters.framework?.options).toEqual(['react', 'vue', 'svelte']);
    expect(result.config?.parameters.framework?.default).toBe('react');
  });

  it('errors when enum has no options', () => {
    const result = parseTemplateConfig({
      parameters: {
        framework: { description: 'Framework', type: 'enum' },
      },
    });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.message).toContain('options');
  });

  it('errors on invalid type', () => {
    const result = parseTemplateConfig({
      parameters: {
        foo: { description: 'test', type: 'object' },
      },
    });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.message).toContain('invalid type');
  });

  it('parses boolean parameter', () => {
    const result = parseTemplateConfig({
      parameters: {
        use_typescript: { description: 'Use TS', type: 'boolean', default: true },
      },
    });
    expect(result.errors).toEqual([]);
    expect(result.config?.parameters.use_typescript?.default).toBe(true);
  });

  it('parses number parameter', () => {
    const result = parseTemplateConfig({
      parameters: {
        max_retries: { description: 'Max retries', type: 'number', default: 3 },
      },
    });
    expect(result.errors).toEqual([]);
    expect(result.config?.parameters.max_retries?.default).toBe(3);
  });

  it('errors on wrong default type', () => {
    const result = parseTemplateConfig({
      parameters: {
        count: { description: 'Count', type: 'number', default: 'not-a-number' },
      },
    });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.message).toContain('must be a number');
  });

  it('errors on enum default not in options', () => {
    const result = parseTemplateConfig({
      parameters: {
        framework: {
          description: 'Framework',
          type: 'enum',
          options: ['react', 'vue'],
          default: 'angular',
        },
      },
    });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.message).toContain('not in options');
  });

  it('parses optional parameter', () => {
    const result = parseTemplateConfig({
      parameters: {
        extra: { description: 'Extra', type: 'string', optional: true },
      },
    });
    expect(result.errors).toEqual([]);
    expect(result.config?.parameters.extra?.optional).toBe(true);
  });

  it('parses multiple parameters', () => {
    const result = parseTemplateConfig({
      parameters: {
        dir: { description: 'Dir', type: 'string', default: 'src' },
        framework: { description: 'FW', type: 'enum', options: ['a', 'b'], default: 'a' },
        debug: { description: 'Debug', type: 'boolean', default: false },
      },
    });
    expect(result.errors).toEqual([]);
    expect(Object.keys(result.config!.parameters)).toHaveLength(3);
  });
});
