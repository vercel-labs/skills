import { AsyncLocalStorage } from 'node:async_hooks';

export type WarningCode = 'SKILL_SKIPPED' | 'SYMLINK_SKIPPED';

export interface Warning {
  code: WarningCode;
  message: string;
  /** Absolute path of the file the warning is about. */
  path?: string;
}

type WarningHandler = (warning: Warning) => void;

const handlers = new AsyncLocalStorage<WarningHandler>();

/**
 * Report a non-fatal problem. Inside withWarnings() it goes to that handler;
 * otherwise (the CLI) it is printed with console.warn as before.
 */
export function warn(warning: Warning, consoleMessage: string = warning.message): void {
  const handler = handlers.getStore();
  if (handler) handler(warning);
  else console.warn(consoleMessage);
}

/** Run `fn` with warnings routed to `handler` instead of the console. */
export function withWarnings<T>(handler: WarningHandler, fn: () => Promise<T>): Promise<T> {
  return handlers.run(handler, fn);
}
