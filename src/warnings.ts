import { AsyncLocalStorage } from 'node:async_hooks';
import type { Diagnostic } from 'nostics';
import { formatError } from './diagnostics.ts';

type WarningHandler = (warning: Diagnostic<unknown>) => void;

const handlers = new AsyncLocalStorage<WarningHandler>();

/**
 * Report a non-fatal problem. Inside withWarnings() it goes to that handler;
 * otherwise (the CLI) it is printed with console.warn.
 */
export function warn(warning: Diagnostic<unknown>): void {
  const handler = handlers.getStore();
  if (handler) handler(warning);
  else console.warn(formatError(warning));
}

/** Run `fn` with warnings routed to `handler` (or dropped) instead of the console. */
export function withWarnings<T>(
  handler: WarningHandler | undefined,
  fn: () => Promise<T>
): Promise<T> {
  return handlers.run(handler ?? (() => {}), fn);
}
