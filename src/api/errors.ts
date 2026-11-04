import type { SkillsErrorCode } from './types.ts';

/** Thrown when a whole operation fails. Per-skill failures are returned instead. */
export class SkillsError extends Error {
  readonly code: SkillsErrorCode;

  constructor(code: SkillsErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'SkillsError';
    this.code = code;
  }
}

export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new SkillsError('ABORTED', 'The operation was aborted', { cause: signal.reason });
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
