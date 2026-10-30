/**
 * Normalizes CLI arguments by splitting `--flag=value` and `-f=value` syntax
 * into `['--flag', 'value']` pairs.
 *
 * ponytail: Entry-point argument splitting cannot distinguish value-taking flags
 * from boolean flags without maintaining a full flag schema. Boolean flags passed
 * with `=value` (e.g. `--global=true`) expand to two tokens, leaving the trailing
 * value as a positional argument. Upgrade path: schema-driven flag definitions if
 * flags grow significantly.
 */
export function normalizeArgs(args: string[]): string[] {
  return args.flatMap((arg) => {
    const i = arg.indexOf('=');
    return arg.startsWith('-') && i !== -1 ? [arg.slice(0, i), arg.slice(i + 1)] : arg;
  });
}
