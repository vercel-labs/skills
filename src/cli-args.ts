import { parseArgs } from 'node:util';
import type { Diagnostic } from 'nostics';
import { diagnostics } from './diagnostics.ts';

/**
 * - `boolean`: a switch; `--flag=value` is an error.
 * - `string`: one value per occurrence (`--flag value` or `--flag=value`).
 * - `list`: like `string`, but the space form also takes the arguments that
 *   follow, up to the next option (`--agent a b`). The `=` form takes exactly
 *   one value, so `--agent=a source` keeps `source` positional.
 */
export type OptionSpec =
  | { type: 'boolean'; short?: string }
  | { type: 'string' | 'list'; short?: string; /** e.g. 'an agent name' */ value?: string };

type OptionValues<S extends Record<string, OptionSpec>> = {
  [K in keyof S]?: S[K] extends { type: 'boolean' } ? true : string[];
};

export interface ParsedCliArgs<S extends Record<string, OptionSpec>> {
  values: OptionValues<S>;
  positionals: string[];
  /** Options not in the spec, as typed (`--foo`); each command decides whether to reject them. */
  unknown: string[];
  errors: Diagnostic[];
}

/**
 * Parse subcommand arguments with `util.parseArgs`, which handles `--flag=value`,
 * short aliases, grouped short switches (`-gy`) and the `--` terminator.
 *
 * Runs `parseArgs` in non-strict mode and validates the tokens here, so one
 * call reports every problem and commands can choose to ignore unknown options.
 */
export function parseCliArgs<const S extends Record<string, OptionSpec>>(
  args: string[],
  spec: S
): ParsedCliArgs<S> {
  const { tokens } = parseArgs({
    args,
    options: Object.fromEntries(
      Object.entries(spec).map(([name, { type, short }]) => [
        name,
        { type: type === 'boolean' ? 'boolean' : 'string', ...(short ? { short } : {}) },
      ])
    ),
    strict: false,
    allowPositionals: true,
    tokens: true,
  });

  const values: Record<string, true | string[]> = {};
  const positionals: string[] = [];
  const unknown: string[] = [];
  const errors: Diagnostic[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    if (token.kind === 'option-terminator') continue;
    if (token.kind === 'positional') {
      if (token.value) positionals.push(token.value);
      continue;
    }

    const def = Object.hasOwn(spec, token.name) ? spec[token.name] : undefined;
    if (!def) {
      unknown.push(token.rawName);
      continue;
    }
    if (def.type === 'boolean') {
      if (token.value === undefined) values[token.name] = true;
      else errors.push(diagnostics.SKILLS_OPTION_TAKES_NO_VALUE({ option: token.rawName }));
      continue;
    }

    let value = token.value;
    // parseArgs reads `-s=foo` as `-s` with value `=foo`, like getopt.
    if (token.inlineValue && !token.rawName.startsWith('--') && value?.startsWith('=')) {
      value = value.slice(1);
    }
    // In non-strict mode parseArgs takes the next argument as the value even
    // when it is another option (`--agent -y`).
    if (!value || (!token.inlineValue && value.startsWith('-'))) {
      errors.push(
        diagnostics.SKILLS_OPTION_REQUIRES_VALUE({
          option: token.rawName,
          value: def.value ?? 'a value',
        })
      );
      continue;
    }

    const list = (values[token.name] ??= []) as string[];
    list.push(value);
    if (def.type === 'list' && !token.inlineValue) {
      for (let next = tokens[i + 1]; next?.kind === 'positional'; next = tokens[i + 1]) {
        if (next.value) list.push(next.value);
        i++;
      }
    }
  }

  return { values: values as OptionValues<S>, positionals, unknown, errors };
}

/** For commands without an error channel: `main()` reports thrown option diagnostics. */
export function throwFirstError(errors: Diagnostic[]): void {
  if (errors[0]) throw errors[0];
}
