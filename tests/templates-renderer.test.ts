import { describe, it, expect } from 'vitest';
import { renderTemplate, stripParametersFromFrontmatter } from '../src/templates/renderer.ts';
import type { TemplateConfig } from '../src/templates/parser.ts';

const config: TemplateConfig = {
  parameters: {
    component_dir: { description: 'Dir', type: 'string', default: 'src/components' },
    state_management: {
      description: 'State lib',
      type: 'enum',
      options: ['zustand', 'jotai', 'redux-toolkit', 'none'],
      default: 'zustand',
    },
    use_typescript: { description: 'TS', type: 'boolean', default: true },
    max_retries: { description: 'Retries', type: 'number', default: 3 },
  },
};

describe('renderTemplate', () => {
  it('substitutes simple parameters', () => {
    const result = renderTemplate(
      'Place components in `{{component_dir}}/`.',
      { component_dir: 'app/ui' },
      config
    );
    expect(result).toBe('Place components in `app/ui/`.');
  });

  it('uses defaults when param not provided', () => {
    const result = renderTemplate('Dir: {{component_dir}}', {}, config);
    expect(result).toBe('Dir: src/components');
  });

  it('handles boolean conditional (truthy)', () => {
    const result = renderTemplate(
      '{{#if use_typescript}}Use .tsx files{{/if}}',
      { use_typescript: true },
      config
    );
    expect(result).toBe('Use .tsx files');
  });

  it('handles boolean conditional (falsy)', () => {
    const result = renderTemplate(
      '{{#if use_typescript}}Use .tsx files{{/if}}',
      { use_typescript: false },
      config
    );
    expect(result).toBe('');
  });

  it('handles enum equality comparison', () => {
    const result = renderTemplate(
      '{{#if state_management == "zustand"}}Use zustand stores{{/if}}',
      { state_management: 'zustand' },
      config
    );
    expect(result).toBe('Use zustand stores');
  });

  it('handles enum equality comparison (no match)', () => {
    const result = renderTemplate(
      '{{#if state_management == "zustand"}}Use zustand{{/if}}',
      { state_management: 'jotai' },
      config
    );
    expect(result).toBe('');
  });

  it('handles unless conditional', () => {
    const result = renderTemplate(
      '{{#unless use_typescript}}Use .jsx files{{/unless}}',
      { use_typescript: false },
      config
    );
    expect(result).toBe('Use .jsx files');
  });

  it('handles unless conditional (truthy = hidden)', () => {
    const result = renderTemplate(
      '{{#unless use_typescript}}Use .jsx files{{/unless}}',
      { use_typescript: true },
      config
    );
    expect(result).toBe('');
  });

  it('handles multiple conditionals in same content', () => {
    const template = [
      '# Setup',
      '{{#if use_typescript}}Use TypeScript{{/if}}',
      '{{#if state_management == "zustand"}}Use zustand{{/if}}',
      '{{#if state_management == "jotai"}}Use jotai{{/if}}',
      'Dir: {{component_dir}}',
    ].join('\n');

    const result = renderTemplate(
      template,
      { use_typescript: true, state_management: 'jotai', component_dir: 'app/ui' },
      config
    );
    expect(result).toContain('Use TypeScript');
    expect(result).not.toContain('Use zustand');
    expect(result).toContain('Use jotai');
    expect(result).toContain('Dir: app/ui');
  });

  it('substitutes number parameters', () => {
    const result = renderTemplate('Retry up to {{max_retries}} times.', { max_retries: 5 }, config);
    expect(result).toBe('Retry up to 5 times.');
  });

  it('replaces undefined params with empty string', () => {
    const sparseConfig: TemplateConfig = {
      parameters: {
        missing: { description: 'Missing', type: 'string', optional: true },
      },
    };
    const result = renderTemplate('Value: {{missing}}', {}, sparseConfig);
    expect(result).toBe('Value: ');
  });
});

describe('stripParametersFromFrontmatter', () => {
  it('removes parameters block from frontmatter', () => {
    const content = `---
name: test
parameters:
  dir:
    type: string
    default: src
description: A skill
---

# Content`;

    const result = stripParametersFromFrontmatter(content);
    expect(result).toContain('name: test');
    expect(result).toContain('description: A skill');
    expect(result).not.toContain('parameters');
    expect(result).toContain('# Content');
  });

  it('returns content unchanged when no frontmatter', () => {
    const content = '# Just content\nNo frontmatter here.';
    const result = stripParametersFromFrontmatter(content);
    expect(result).toBe(content);
  });

  it('removes frontmatter delimiters when only parameters present', () => {
    const content = `---
parameters:
  dir:
    type: string
---

# Content`;

    const result = stripParametersFromFrontmatter(content);
    expect(result).not.toContain('---');
    expect(result).toContain('# Content');
  });

  it('preserves other frontmatter fields', () => {
    const content = `---
name: my-skill
parameters:
  dir:
    type: string
version: 1.0
---

Body`;

    const result = stripParametersFromFrontmatter(content);
    expect(result).toContain('name: my-skill');
    expect(result).toContain('version: 1.0');
    expect(result).not.toContain('parameters');
  });
});
