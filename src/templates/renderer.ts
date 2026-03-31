import type { TemplateConfig, ParamValue } from './parser.ts';

/**
 * Render a template by substituting parameters and evaluating conditionals.
 *
 * Supported syntax:
 * - {{param_name}} — simple substitution
 * - {{#if param_name}}...{{/if}} — conditional (truthy check)
 * - {{#if param_name == "value"}}...{{/if}} — equality comparison
 * - {{#unless param_name}}...{{/unless}} — inverse conditional
 */
export function renderTemplate(
  content: string,
  params: Record<string, ParamValue>,
  config: TemplateConfig
): string {
  // Merge defaults with provided values
  const resolved: Record<string, ParamValue> = {};
  for (const [name, decl] of Object.entries(config.parameters)) {
    if (params[name] !== undefined) {
      resolved[name] = params[name];
    } else if (decl.default !== undefined) {
      resolved[name] = decl.default;
    }
  }

  // Process conditionals first (supports nesting via recursive processing)
  let result = processConditionals(content, resolved);

  // Substitute simple {{param}} values
  result = result.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => {
    const val = resolved[name];
    return val !== undefined ? String(val) : '';
  });

  return result;
}

/**
 * Strip the `parameters` block from rendered YAML frontmatter.
 */
export function stripParametersFromFrontmatter(content: string): string {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) return content;

  const frontmatter = fmMatch[1]!;
  // Remove the parameters block (YAML key and all indented children)
  const lines = frontmatter.split('\n');
  const filtered: string[] = [];
  let inParams = false;

  for (const line of lines) {
    if (/^parameters\s*:/.test(line)) {
      inParams = true;
      continue;
    }
    if (inParams) {
      // If line is indented or empty, it's part of the parameters block
      if (/^\s+/.test(line) || line.trim() === '') {
        continue;
      }
      inParams = false;
    }
    filtered.push(line);
  }

  const newFrontmatter = filtered.join('\n').trim();
  if (!newFrontmatter) {
    // No frontmatter left, remove the delimiters entirely
    return content.slice(fmMatch[0].length).replace(/^\n/, '');
  }

  return content.replace(fmMatch[0], `---\n${newFrontmatter}\n---`);
}

function processConditionals(content: string, params: Record<string, ParamValue>): string {
  // Process {{#unless ...}}...{{/unless}}
  content = content.replace(
    /\{\{#unless\s+(\w+)\}\}([\s\S]*?)\{\{\/unless\}\}/g,
    (_match, name: string, body: string) => {
      const val = params[name];
      const truthy = isTruthy(val);
      return truthy ? '' : processConditionals(body, params);
    }
  );

  // Process {{#if param == "value"}}...{{/if}}
  content = content.replace(
    /\{\{#if\s+(\w+)\s*==\s*"([^"]*)"\}\}([\s\S]*?)\{\{\/if\}\}/g,
    (_match, name: string, expected: string, body: string) => {
      const val = params[name];
      return String(val) === expected ? processConditionals(body, params) : '';
    }
  );

  // Process {{#if param}}...{{/if}} (simple truthy)
  content = content.replace(
    /\{\{#if\s+(\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g,
    (_match, name: string, body: string) => {
      const val = params[name];
      return isTruthy(val) ? processConditionals(body, params) : '';
    }
  );

  return content;
}

function isTruthy(val: ParamValue | undefined): boolean {
  if (val === undefined || val === false || val === '' || val === 0) return false;
  if (typeof val === 'string' && (val === 'false' || val === 'none')) return false;
  return true;
}
