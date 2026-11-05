import { withWarnings } from '../warnings.ts';
import type { BaseOptions } from './types.ts';

/**
 * Run an API call with internal warnings routed to `onWarning` (or dropped),
 * so nothing reaches the console. A throwing handler cannot break the call.
 */
export function runWithWarnings<T>(
  options: Pick<BaseOptions, 'onWarning'>,
  fn: () => Promise<T>
): Promise<T> {
  return withWarnings((warning) => {
    try {
      options.onWarning?.(Object.freeze({ ...warning }));
    } catch {
      // The caller's handler failing must not fail the operation.
    }
  }, fn);
}
