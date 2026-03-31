export type ParamType = 'string' | 'enum' | 'boolean' | 'number';
export type ParamValue = string | boolean | number;

export interface ParameterDeclaration {
  description: string;
  type: ParamType;
  default?: ParamValue;
  options?: string[];
  optional?: boolean;
}

export interface TemplateConfig {
  parameters: Record<string, ParameterDeclaration>;
}

export interface ParseError {
  param: string;
  message: string;
}

export interface ParseResult {
  config: TemplateConfig | null;
  errors: ParseError[];
}

/**
 * Parse template parameter declarations from SKILL.md frontmatter.
 * Returns null config if no `parameters` field is present.
 */
export function parseTemplateConfig(frontmatter: Record<string, unknown>): ParseResult {
  if (!frontmatter.parameters) {
    return { config: null, errors: [] };
  }

  const raw = frontmatter.parameters;
  if (typeof raw !== 'object' || raw === null) {
    return { config: null, errors: [{ param: 'parameters', message: 'must be an object' }] };
  }

  const obj = raw as Record<string, unknown>;
  const errors: ParseError[] = [];
  const parameters: Record<string, ParameterDeclaration> = {};

  for (const [key, value] of Object.entries(obj)) {
    if (typeof value !== 'object' || value === null) {
      errors.push({ param: key, message: 'must be an object' });
      continue;
    }

    const decl = value as Record<string, unknown>;
    const description = typeof decl.description === 'string' ? decl.description : '';
    const type = parseParamType(decl.type);
    if (!type) {
      errors.push({
        param: key,
        message: `invalid type "${decl.type}". Must be string, enum, boolean, or number`,
      });
      continue;
    }

    const param: ParameterDeclaration = { description, type };

    if (type === 'enum') {
      if (!Array.isArray(decl.options) || decl.options.length === 0) {
        errors.push({ param: key, message: 'enum type requires a non-empty "options" array' });
        continue;
      }
      param.options = decl.options.filter((o): o is string => typeof o === 'string');
    }

    if (decl.default !== undefined) {
      const validated = validateDefault(decl.default, type, param.options);
      if (validated.error) {
        errors.push({ param: key, message: validated.error });
      } else {
        param.default = validated.value;
      }
    }

    if (typeof decl.optional === 'boolean') {
      param.optional = decl.optional;
    }

    parameters[key] = param;
  }

  return {
    config: { parameters },
    errors,
  };
}

function parseParamType(raw: unknown): ParamType | null {
  if (typeof raw !== 'string') return null;
  const valid: ParamType[] = ['string', 'enum', 'boolean', 'number'];
  return valid.includes(raw as ParamType) ? (raw as ParamType) : null;
}

function validateDefault(
  value: unknown,
  type: ParamType,
  options?: string[]
): { value?: ParamValue; error?: string } {
  switch (type) {
    case 'string':
      if (typeof value !== 'string') return { error: 'default must be a string' };
      return { value };
    case 'number':
      if (typeof value !== 'number') return { error: 'default must be a number' };
      return { value };
    case 'boolean':
      if (typeof value !== 'boolean') return { error: 'default must be a boolean' };
      return { value };
    case 'enum':
      if (typeof value !== 'string') return { error: 'default must be a string' };
      if (options && !options.includes(value)) {
        return { error: `default "${value}" is not in options: ${options.join(', ')}` };
      }
      return { value };
  }
}
