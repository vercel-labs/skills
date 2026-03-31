import type { TemplateConfig, ParamValue } from './parser.ts';

export interface ValidationError {
  param: string;
  message: string;
}

/**
 * Validate parameter values against a template config.
 * Returns an empty array if all values are valid.
 */
export function validateParams(
  values: Record<string, ParamValue>,
  config: TemplateConfig
): ValidationError[] {
  const errors: ValidationError[] = [];

  for (const [name, decl] of Object.entries(config.parameters)) {
    const value = values[name];

    // Check required params
    if (value === undefined) {
      if (!decl.optional && decl.default === undefined) {
        errors.push({ param: name, message: 'is required' });
      }
      continue;
    }

    // Type checking
    switch (decl.type) {
      case 'string':
        if (typeof value !== 'string') {
          errors.push({ param: name, message: `expected string, got ${typeof value}` });
        }
        break;
      case 'number':
        if (typeof value !== 'number') {
          errors.push({ param: name, message: `expected number, got ${typeof value}` });
        }
        break;
      case 'boolean':
        if (typeof value !== 'boolean') {
          errors.push({ param: name, message: `expected boolean, got ${typeof value}` });
        }
        break;
      case 'enum':
        if (typeof value !== 'string') {
          errors.push({ param: name, message: `expected string, got ${typeof value}` });
        } else if (decl.options && !decl.options.includes(value)) {
          errors.push({
            param: name,
            message: `"${value}" is not a valid option. Valid: ${decl.options.join(', ')}`,
          });
        }
        break;
    }
  }

  // Warn about unknown params
  for (const name of Object.keys(values)) {
    if (!config.parameters[name]) {
      errors.push({ param: name, message: 'unknown parameter' });
    }
  }

  return errors;
}
